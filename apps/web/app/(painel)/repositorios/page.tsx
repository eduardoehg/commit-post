/**
 * Repositórios.
 *
 * A tela que responde "o que é LIDO". A confusão com a lista de palavras
 * bloqueadas já aconteceu de verdade, então as duas telas dizem em voz alta o
 * que cada uma decide.
 */

import type { Metadata } from "next";
import { Cartao, Recado, TituloPagina } from "@/components/ui";
import { SecaoRepositorios } from "@/components/secoes/Listas";
import { reposDe } from "@/lib/dados";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Repositórios" };

export default async function PaginaRepositorios({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await carregarContexto();
  const repos = await reposDe(user.id);
  const erro = primeiroParam((await searchParams)["erro"]);

  const ativos = repos.filter((r) => r.active).length;

  return (
    <>
      <TituloPagina
        titulo="Repositórios"
        descricao="Quais repositórios o sistema lê. Esta lista decide o que ENTRA na coleta — o que nunca sai escrito é a lista de palavras bloqueadas."
      />

      {erro !== undefined && <Recado tom="erro">{erro}</Recado>}

      <Cartao
        titulo={`${String(ativos)} de ${String(repos.length)} na coleta`}
        descricao="Aparecem sozinhos quando você conecta uma conta do GitHub ou concede colaborações."
      >
        <SecaoRepositorios repos={repos} />
      </Cartao>
    </>
  );
}
