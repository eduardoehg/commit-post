/**
 * Painel de edição — Fase 6.
 *
 * Não há login. O link assinado É a autenticação: o token `t` na query é um
 * HMAC (PANEL_TOKEN_SECRET) sobre o id do post, com TTL curto e uso único.
 * Sem isso, esta rota é uma URL pública onde qualquer um lê e aprova posts.
 */

export const dynamic = "force-dynamic";

export default async function PostPanel({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { t } = await searchParams;

  if (typeof t !== "string" || t.length === 0) {
    return (
      <main>
        <h1>Link inválido</h1>
        <p>Este painel só abre por um link assinado enviado no Telegram.</p>
      </main>
    );
  }

  // TODO Fase 6: verificar HMAC + TTL + uso único, carregar o candidato,
  // renderizar o editor e permitir aprovar a partir daqui.

  return (
    <main>
      <h1>Editar post</h1>
      <p>Candidato: {id}</p>
      <p>Fase 6 — editor ainda não implementado.</p>
    </main>
  );
}
