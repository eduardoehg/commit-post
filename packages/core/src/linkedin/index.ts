/**
 * Publicação no LinkedIn — Fase 7.
 *
 * Escopos necessários: `w_member_social openid profile`. Os dois últimos não
 * são opcionais: o URN do autor, exigido para publicar, vem de
 * `/v2/userinfo`.
 *
 * Expiração: o access token de membro dura ~60 dias e refresh token de longa
 * duração não é concedido a todo app. Por isso o token mora no banco com
 * `expires_at`, e o pipeline avisa no Telegram ~7 dias antes do vencimento com
 * o link de reautenticação. Um token fixo em env var quebraria em silêncio.
 *
 * O LinkedIn também penaliza conteúdo duplicado — deduplicar antes de publicar.
 */

const NOT_IMPLEMENTED = "Fase 7 — ainda não implementado";

/** Antecedência do aviso de expiração de token, em dias. */
export const TOKEN_EXPIRY_WARNING_DAYS = 7;

export const REQUIRED_SCOPES = ["w_member_social", "openid", "profile"] as const;

export function publishPost(): Promise<never> {
  throw new Error(NOT_IMPLEMENTED);
}
