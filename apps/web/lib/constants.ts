/**
 * Nomes de cookie, num módulo que não importa nada.
 *
 * Existe para quebrar o ciclo entre `runtime.ts` (que precisa limpar o cookie
 * do OAuth ao redirecionar) e `oauth.ts` (que precisa de `env()` para decidir
 * se o cookie é `secure`).
 */

export const OAUTH_COOKIE = "commitpost_oauth";
