/**
 * Autenticação no GitHub — os dois caminhos, de propósito.
 *
 * 1. GITHUB APP (principal). Serve de login e, uma vez instalado, dá acesso
 *    aos repositórios da conta onde foi instalado. Os tokens de instalação
 *    saem da chave privada na hora e valem uma hora — por isso nenhuma
 *    credencial de dev é guardada, e `github_installations` não tem coluna de
 *    token.
 *
 * 2. OAUTH APP CLÁSSICO (opcional). Existe por uma limitação que não tem
 *    volta: a instalação de um App só enxerga repos da conta onde foi
 *    instalada, e o user access token dele continua preso às instalações.
 *    Repositório de outra pessoa, onde o dev é apenas colaborador, é
 *    inalcançável — e é onde mora boa parte do trabalho de muita gente.
 *
 *    O preço é real: `repo` é leitura E escrita, porque não existe escopo
 *    somente-leitura para repositório privado no OAuth clássico. Daí a
 *    concessão ser opt-in, o token ir cifrado para o banco, e o sistema nunca
 *    chamar endpoint de escrita.
 *
 * Os dois caminhos compartilham o mesmo endpoint de troca de código; o que
 * muda é qual par client_id/secret assina e quais escopos são pedidos.
 */

import { createSign } from "node:crypto";

const API = "https://api.github.com";
const OAUTH = "https://github.com/login/oauth";

const ACCEPT = "application/vnd.github+json";
const API_VERSION = "2022-11-28";

/**
 * Escopo pedido ao OAuth clássico.
 *
 * `repo` dá escrita junto. Não é descuido: `repo:read` não existe. A trava
 * contra isso não é técnica, é de projeto — o sistema não tem nenhuma chamada
 * de escrita ao GitHub, e acrescentar uma é decisão a ser tomada de novo.
 */
export const COLLABORATION_SCOPE = "repo";

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

export interface GitHubViewer {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface GitHubInstallationInfo {
  installationId: number;
  accountLogin: string;
  accountType: string;
  suspended: boolean;
}

export interface GitHubRepoInfo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  owner: string;
}

// ---------------------------------------------------------------------------
// GitHub App
// ---------------------------------------------------------------------------

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * JWT RS256 assinado com a chave privada do App, válido por 9 minutos.
 *
 * O `iat` recua um minuto de propósito: o GitHub rejeita token emitido no
 * futuro, e o relógio do runner não é o relógio deles.
 */
export function createAppJwt(
  appId: string,
  privateKeyPem: string,
  nowMs: number = Date.now(),
): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));

  try {
    const signature = createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .end()
      .sign(privateKeyPem);
    return `${header}.${payload}.${base64url(signature)}`;
  } catch {
    throw new GitHubAuthError(
      "Não foi possível assinar com GITHUB_APP_PRIVATE_KEY. " +
        "Esperado o .pem que o GitHub gerou, inteiro, ou o mesmo .pem em base64.",
    );
  }
}

async function githubJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });

  if (!response.ok) {
    // O corpo do erro do GitHub pode citar nome de repositório. Fica de fora
    // da mensagem por isso — só status e caminho, que já bastam para depurar.
    throw new GitHubAuthError(`GitHub respondeu ${String(response.status)} em ${path}.`);
  }

  return (await response.json()) as T;
}

/** Token de instalação: expira em uma hora e por isso nunca é guardado. */
export async function createInstallationToken(
  installationId: number,
  appJwt: string,
): Promise<{ token: string; expiresAt: Date }> {
  const response = await fetch(`${API}/app/installations/${String(installationId)}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: ACCEPT,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });

  if (!response.ok) {
    throw new GitHubAuthError(
      `Não foi possível gerar token para a instalação ${String(installationId)} ` +
        `(${String(response.status)}). Ela pode ter sido removida ou suspensa.`,
    );
  }

  const body = (await response.json()) as { token: string; expires_at: string };
  return { token: body.token, expiresAt: new Date(body.expires_at) };
}

// ---------------------------------------------------------------------------
// Fluxo de autorização (serve aos dois caminhos)
// ---------------------------------------------------------------------------

export interface AuthorizeUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Omitido no GitHub App: lá o alcance vem das permissões declaradas. */
  scope?: string;
}

export function authorizeUrl({ clientId, redirectUri, state, scope }: AuthorizeUrlOptions): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  if (scope !== undefined) params.set("scope", scope);
  return `${OAUTH}/authorize?${params.toString()}`;
}

/** URL de instalação do App. `state` volta no Setup URL, quando configurado. */
export function installUrl(appSlug: string, state?: string): string {
  const base = `https://github.com/apps/${appSlug}/installations/new`;
  return state === undefined ? base : `${base}?state=${encodeURIComponent(state)}`;
}

export interface TokenExchange {
  accessToken: string;
  scope: string | null;
  /** Só o App devolve prazo; o OAuth clássico dá token sem expiração. */
  expiresAt: Date | null;
  refreshToken: string | null;
}

export async function exchangeCodeForToken(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<TokenExchange> {
  const response = await fetch(`${OAUTH}/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new GitHubAuthError(`Troca de código falhou com status ${String(response.status)}.`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };

  // O GitHub devolve 200 com `error` no corpo quando o código expirou ou já
  // foi usado. Sem esta checagem, `access_token` viria undefined e o erro
  // apareceria três camadas adiante, longe da causa.
  if (body.access_token === undefined) {
    throw new GitHubAuthError(
      body.error === "bad_verification_code"
        ? "O código de autorização expirou ou já foi usado. Comece de novo."
        : `O GitHub recusou a autorização (${body.error ?? "motivo não informado"}).`,
    );
  }

  return {
    accessToken: body.access_token,
    scope: body.scope ?? null,
    expiresAt: body.expires_in === undefined ? null : new Date(Date.now() + body.expires_in * 1000),
    refreshToken: body.refresh_token ?? null,
  };
}

/**
 * Troca o refresh token por um par novo.
 *
 * Existe porque o token de colaboração expira — o GitHub devolveu oito horas,
 * não "nunca", que era o que eu esperava de um OAuth clássico. Sem renovação,
 * a coleta silenciosamente deixaria de enxergar os repositórios de colaboração
 * de um dia para o outro, e a única pista seria o número de repos varridos
 * caindo no log.
 *
 * O refresh token é de uso único: cada renovação devolve um novo, e o anterior
 * morre. Quem chama PRECISA gravar o novo — perder essa gravação transforma a
 * renovação num desligamento adiado.
 */
export async function refreshUserToken(options: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenExchange> {
  const response = await fetch(`${OAUTH}/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
      client_id: options.clientId,
      client_secret: options.clientSecret,
    }),
  });

  if (!response.ok) {
    throw new GitHubAuthError(`Renovação falhou com status ${String(response.status)}.`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };

  if (body.access_token === undefined) {
    throw new GitHubAuthError(
      body.error === "bad_refresh_token"
        ? "A renovação expirou. O dev precisa autorizar de novo."
        : `O GitHub recusou a renovação (${body.error ?? "motivo não informado"}).`,
    );
  }

  return {
    accessToken: body.access_token,
    scope: body.scope ?? null,
    expiresAt: body.expires_in === undefined ? null : new Date(Date.now() + body.expires_in * 1000),
    refreshToken: body.refresh_token ?? null,
  };
}

// ---------------------------------------------------------------------------
// Leituras com token de usuário
// ---------------------------------------------------------------------------

export async function fetchViewer(userToken: string): Promise<GitHubViewer> {
  const user = await githubJson<{
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
  }>("/user", userToken);

  return { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url };
}

/**
 * E-mails verificados da conta.
 *
 * Exige a permissão Account permissions → Email addresses: Read-only no App.
 * Sem ela o GitHub devolve 403; quem chama trata como lista vazia e a tela cai
 * no preenchimento manual, que continua funcionando.
 *
 * Só os verificados entram: um e-mail não verificado pode ser de outra pessoa,
 * e é por e-mail de autor que decidimos de quem é cada commit.
 */
export async function fetchVerifiedEmails(userToken: string): Promise<string[]> {
  const emails = await githubJson<{ email: string; verified: boolean }[]>(
    "/user/emails",
    userToken,
  );

  return emails.filter((e) => e.verified).map((e) => e.email.toLowerCase());
}

/**
 * O endereço `noreply` que o GitHub usa quando o dev marca "manter e-mail
 * privado". Commits feitos pela interface web saem com ele, e ele nunca
 * aparece em `/user/emails` — sem isto, esses commits ficariam órfãos.
 */
export function noreplyEmail(viewer: GitHubViewer): string {
  return `${String(viewer.id)}+${viewer.login.toLowerCase()}@users.noreply.github.com`;
}

/**
 * Instalações que ESTE dev enxerga.
 *
 * É o que dispensa configurar Setup URL no App: em vez de esperar o GitHub nos
 * avisar de uma instalação nova, perguntamos. Uma volta pelo login resolve.
 */
export async function fetchViewerInstallations(
  userToken: string,
): Promise<GitHubInstallationInfo[]> {
  const body = await githubJson<{
    installations: {
      id: number;
      account: { login: string; type: string } | null;
      suspended_at: string | null;
    }[];
  }>("/user/installations?per_page=100", userToken);

  return body.installations.map((i) => ({
    installationId: i.id,
    accountLogin: i.account?.login ?? "desconhecida",
    accountType: i.account?.type ?? "User",
    suspended: i.suspended_at !== null,
  }));
}

interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string } | null;
}

function toRepoInfo(r: RawRepo): GitHubRepoInfo {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    owner: r.owner?.login ?? "",
  };
}

/** Teto de páginas: 1000 repositórios é folgado e evita laço infinito. */
const MAX_PAGES = 10;

/** Repositórios que uma instalação expõe a este dev. */
export async function fetchInstallationRepos(
  installationId: number,
  userToken: string,
): Promise<GitHubRepoInfo[]> {
  const found: GitHubRepoInfo[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await githubJson<{ repositories: RawRepo[] }>(
      `/user/installations/${String(installationId)}/repositories?per_page=100&page=${String(page)}`,
      userToken,
    );

    for (const r of body.repositories) found.push(toRepoInfo(r));
    if (body.repositories.length < 100) break;
  }

  return found;
}

/**
 * Repositórios alcançáveis só pelo token do OAuth clássico.
 *
 * `affiliation=collaborator` é o motivo de este caminho existir: são os repos
 * de outras pessoas onde o dev trabalha, que nenhuma instalação alcança.
 */
export async function fetchCollaboratorRepos(oauthToken: string): Promise<GitHubRepoInfo[]> {
  const found: GitHubRepoInfo[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await githubJson<RawRepo[]>(
      `/user/repos?affiliation=collaborator&per_page=100&page=${String(page)}`,
      oauthToken,
    );

    for (const r of body) found.push(toRepoInfo(r));
    if (body.length < 100) break;
  }

  return found;
}
