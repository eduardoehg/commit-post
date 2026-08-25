/**
 * Publicação no LinkedIn — Fase 7.
 *
 * Escopos necessários: `w_member_social openid profile`. Os dois últimos não
 * são opcionais: o URN do autor, exigido para publicar, vem de
 * `/v2/userinfo`. Sem ele o sistema tem um token válido e não sabe em nome de
 * quem postar.
 *
 * Expiração: o access token de membro dura ~60 dias e refresh token de longa
 * duração não é concedido a todo app. Por isso o token mora no banco com
 * `expires_at`, e o pipeline avisa no Telegram antes do vencimento com o link
 * de reautenticação. Um token fixo em env var quebraria em silêncio a cada
 * dois meses, e o sintoma seria "os posts pararam" sem nada no log.
 */

const OAUTH = "https://www.linkedin.com/oauth/v2";
const API = "https://api.linkedin.com";

/** Antecedência do aviso de expiração de token, em dias. */
export const TOKEN_EXPIRY_WARNING_DAYS = 7;

export const REQUIRED_SCOPES = ["w_member_social", "openid", "profile"] as const;

export class LinkedInError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LinkedInError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

export function authorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    state: options.state,
    scope: REQUIRED_SCOPES.join(" "),
  });

  return `${OAUTH}/authorization?${params.toString()}`;
}

export interface LinkedInToken {
  accessToken: string;
  /** Absoluto, não "em quantos segundos" — é o que vai para o banco. */
  expiresAt: Date;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
}

/**
 * Troca o `code` pelo token.
 *
 * O LinkedIn exige `application/x-www-form-urlencoded` aqui — mandar JSON
 * devolve um 400 genérico que não diz qual é o problema.
 */
export async function exchangeCodeForToken(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<LinkedInToken> {
  const corpo = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    redirect_uri: options.redirectUri,
  });

  const response = await fetch(`${OAUTH}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo.toString(),
  });

  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || body.access_token === undefined) {
    throw new LinkedInError(
      `O LinkedIn recusou a autorização: ${body.error_description ?? body.error ?? "sem detalhe"}`,
      response.status,
    );
  }

  return {
    accessToken: body.access_token,
    // Sem `expires_in` o padrão é o prazo documentado do token de membro. É
    // melhor um prazo estimado do que nulo: nulo apagaria o aviso de
    // reautenticação, e o dev descobriria o vencimento pelo post que não saiu.
    expiresAt: new Date(Date.now() + (body.expires_in ?? 60 * 24 * 3600) * 1000),
    refreshToken: body.refresh_token ?? null,
    refreshTokenExpiresAt:
      body.refresh_token_expires_in === undefined
        ? null
        : new Date(Date.now() + body.refresh_token_expires_in * 1000),
    scope: body.scope ?? null,
  };
}

export interface LinkedInMember {
  /** `sub` do OpenID. É o que forma o URN do autor. */
  subject: string;
  name: string | null;
}

/**
 * Quem é o dono do token.
 *
 * `sub` vem do OpenID Connect e é o identificador estável do membro. O URN
 * completo é `urn:li:person:<sub>`, e é ele que vai no campo `author` do post.
 */
export async function fetchMember(accessToken: string): Promise<LinkedInMember> {
  const response = await fetch(`${API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new LinkedInError(
      `Não foi possível identificar o autor no LinkedIn (${String(response.status)}). ` +
        "Confira se o produto Sign In with LinkedIn using OpenID Connect está liberado.",
      response.status,
    );
  }

  const body = (await response.json()) as { sub?: string; name?: string };
  if (body.sub === undefined) {
    throw new LinkedInError("O LinkedIn não devolveu o identificador do membro.", 200);
  }

  return { subject: body.sub, name: body.name ?? null };
}

/** `urn:li:person:<sub>` — o formato que a API de posts espera em `author`. */
export function memberUrn(subject: string): string {
  return `urn:li:person:${subject}`;
}

// ---------------------------------------------------------------------------
// Expiração
// ---------------------------------------------------------------------------

const UM_DIA_MS = 86_400_000;

export interface EstadoExpiracao {
  /** Dias inteiros que faltam. Negativo quando já venceu. */
  diasRestantes: number;
  vencido: boolean;
  /** Verdadeiro quando o dev precisa saber disso agora. */
  precisaAvisar: boolean;
}

/**
 * Quanto falta para o acesso do LinkedIn morrer.
 *
 * Diferente do GitHub, aqui NÃO há renovação automática: o refresh token só é
 * concedido a parceiros aprovados, e o tier padrão não recebe nenhum. Então a
 * única defesa é avisar antes — sem isso, o sintoma seria um post aprovado que
 * não sai, dois meses depois de tudo ter funcionado.
 *
 * Pura de propósito: o dia em que isso passar a valer para outro provedor, ou
 * o prazo mudar, dá para testar sem token nenhum.
 */
export function avaliarExpiracao(
  expiresAt: Date | null,
  agora: Date = new Date(),
): EstadoExpiracao | null {
  // Sem prazo não há o que avisar. É o caso de um token que não expira — e
  // inventar um aviso ali seria ruído permanente.
  if (expiresAt === null) return null;

  const restanteMs = expiresAt.getTime() - agora.getTime();
  const vencido = restanteMs <= 0;

  return {
    diasRestantes: Math.floor(restanteMs / UM_DIA_MS),
    vencido,
    // Vencido também avisa: é o único momento em que o dev DEVE agir, e
    // silenciar aí seria silenciar justamente quando importa.
    precisaAvisar: vencido || restanteMs <= TOKEN_EXPIRY_WARNING_DAYS * UM_DIA_MS,
  };
}

/** A frase que o dev lê, no painel e no Telegram — uma fonte, um texto. */
export function textoExpiracao(estado: EstadoExpiracao): string {
  if (estado.vencido) {
    return "O acesso ao LinkedIn venceu. Reconecte em Conexões para voltar a publicar.";
  }

  if (estado.diasRestantes <= 0) {
    return "O acesso ao LinkedIn vence hoje. Reconecte em Conexões.";
  }

  return `O acesso ao LinkedIn vence em ${String(estado.diasRestantes)} dia(s). Reconecte em Conexões — ele não se renova sozinho.`;
}

// ---------------------------------------------------------------------------
// Publicação
// ---------------------------------------------------------------------------

/**
 * Versão da API do LinkedIn.
 *
 * O formato é `AAAAMM` e cada versão vale cerca de um ano. Ela vive numa
 * constante, e não numa variável de ambiente, porque trocá-la é uma decisão de
 * código — a forma do payload muda junto, e um número novo com o corpo antigo
 * falha de um jeito difícil de ler.
 *
 * Se o LinkedIn recusar com 426, é ESTE valor que precisa subir.
 */
export const API_VERSION = "202508";

export interface PostPublicado {
  /** URN devolvido pelo LinkedIn, ex.: `urn:li:share:7123...`. */
  urn: string;
  url: string;
}

/**
 * Publica no perfil do membro.
 *
 * `PUBLISHED` e `PUBLIC` são explícitos de propósito: o padrão de rascunho ou
 * de visibilidade restrita transformaria "aprovei" em "não saiu", e o dev só
 * descobriria olhando o próprio perfil.
 *
 * O texto vai como está. Nada de escapar ou reformatar aqui — ele já
 * atravessou as três barreiras, e mexer nele nesta altura significaria
 * publicar algo diferente do que a pessoa aprovou.
 */
export async function publishPost(options: {
  accessToken: string;
  /** `urn:li:person:<sub>` — ver `memberUrn`. */
  authorUrn: string;
  texto: string;
}): Promise<PostPublicado> {
  const response = await fetch(`${API}/rest/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: options.authorUrn,
      commentary: options.texto,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });

  if (!response.ok) {
    // O corpo da resposta vai na mensagem porque é onde o LinkedIn diz o que
    // está errado — versão, escopo, formato. Sem ele sobra um número de status
    // e uma tarde de tentativa e erro.
    const detalhe = (await response.text()).slice(0, 400);
    throw new LinkedInError(
      response.status === 426
        ? `O LinkedIn recusou a versão ${API_VERSION} da API. Atualize API_VERSION. ${detalhe}`
        : `O LinkedIn recusou a publicação (${String(response.status)}). ${detalhe}`,
      response.status,
    );
  }

  // O id vem no cabeçalho, não no corpo: a resposta de criação do LinkedIn é
  // vazia. Sem ele não há como montar o link nem registrar o que foi ao ar.
  const urn = response.headers.get("x-restli-id") ?? response.headers.get("x-linkedin-id");

  if (urn === null || urn === "") {
    throw new LinkedInError(
      "O LinkedIn aceitou o post mas não devolveu o identificador dele.",
      response.status,
    );
  }

  return { urn, url: postUrl(urn) };
}

export function postUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}
