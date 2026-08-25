/**
 * Palavras bloqueadas.
 *
 * A tela que responde "o que jamais é ESCRITO" — e que precisa deixar claro
 * que não é ela quem escolhe os repositórios lidos.
 *
 * Ela também não é a barreira contra vazamento: quem impede é o vocabulário
 * fechado do filtro, que nunca copia texto de commit para a saída. Esta lista
 * é a segunda camada, e é por isso que não segura o onboarding de ninguém.
 */

import type { Metadata } from "next";
import { Cartao, Recado, TituloPagina } from "@/components/ui";
import { SecaoPalavras } from "@/components/secoes/Listas";
import { termosDe } from "@/lib/dados";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Palavras bloqueadas" };

export default async function PaginaPalavras({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await carregarContexto();
  const termos = await termosDe(user.id);
  const erro = primeiroParam((await searchParams)["erro"]);

  return (
    <>
      <TituloPagina
        titulo="Palavras bloqueadas"
        descricao="Nomes que nunca podem aparecer num post. Preenchida sozinha com os nomes dos seus repositórios e das contas donas deles — acrescente clientes e produtos internos que não viraram repositório."
      />

      {erro !== undefined && <Recado tom="erro">{erro}</Recado>}

      <Recado tom="neutro">
        Esta lista <strong>não</strong> decide quais repositórios são lidos. Ela decide o
        que jamais é escrito.
      </Recado>

      <Cartao titulo={`${String(termos.length)} palavra(s)`}>
        <SecaoPalavras voltar="/palavras" termos={termos} />
      </Cartao>
    </>
  );
}
