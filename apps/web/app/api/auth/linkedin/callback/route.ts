/**
 * Callback do OAuth do LinkedIn — Fase 7.
 *
 * Troca o `code` por um access token e persiste em `oauth_tokens` COM
 * `expires_at`. O token de membro dura ~60 dias e refresh token de longa
 * duração não é concedido a todo app — por isso ele nunca vira env var.
 *
 * Escopos: w_member_social openid profile. Os dois últimos são obrigatórios
 * porque o URN do autor, exigido para publicar, vem de /v2/userinfo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const error = params.get("error");
  if (error !== null) {
    return new Response(`Autorização negada pelo LinkedIn: ${error}`, { status: 400 });
  }

  if (params.get("code") === null || params.get("state") === null) {
    return new Response("Faltam os parâmetros code/state.", { status: 400 });
  }

  // TODO Fase 7: validar `state` contra o valor emitido, trocar `code` por
  // token, buscar o URN em /v2/userinfo, gravar token + expires_at.

  return new Response("Fase 7 — integração com LinkedIn ainda não implementada.", {
    status: 501,
  });
}
