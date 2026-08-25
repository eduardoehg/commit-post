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

export function publishPost(): Promise<never> {
  // Fase 7, segunda metade: POST no endpoint de posts com o URN do autor.
  // Separado da conexão de propósito — conectar e publicar falham por motivos
  // diferentes, e misturar os dois esconde qual dos dois quebrou.
  throw new Error("Publicação ainda não implementada — a conexão já funciona.");
}
