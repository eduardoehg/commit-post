/**
 * A casca do painel: barra lateral fixa e a área de conteúdo.
 *
 * Duas decisões de produto vivem aqui.
 *
 * **A introdução some quando termina.** Enquanto falta uma conexão
 * obrigatória, ela é o primeiro item da lista e traz o distintivo com quantos
 * passos faltam. Cumprida, o item desaparece e o histórico assume o lugar dela
 * — a tela inicial de quem já configurou é o trabalho, não a configuração.
 *
 * **Mas ela sabe voltar.** Se o Telegram for desvinculado ou uma instalação
 * cair, a faixa no topo aparece em qualquer tela. Não a introdução inteira de
 * volta: só o que quebrou, e onde consertar. Um sistema que para de funcionar
 * em silêncio é pior do que um que nunca funcionou.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { AlternadorTema } from "@/components/AlternadorTema";
import { Marca } from "@/components/Marca";
import { Navegacao, type ItemNav } from "@/components/Navegacao";
import { carregarContexto } from "@/lib/painel";
import estilos from "./layout.module.css";

export default async function LayoutPainel({ children }: { children: ReactNode }) {
  const { user, ehDono, resumo } = await carregarContexto();

  const pendentes = resumo.steps.filter((s) => s.required && !s.done);

  const itens: ItemNav[] = [
    ...(resumo.ready
      ? []
      : [
          {
            href: "/onboarding",
            rotulo: "Introdução",
            icone: "introducao" as const,
            distintivo: String(pendentes.length),
          },
        ]),
    { href: "/inicio", rotulo: "Histórico", icone: "historico" },
    { href: "/conexoes", rotulo: "Conexões", icone: "conexoes" },
    { href: "/repositorios", rotulo: "Repositórios", icone: "repositorios" },
    { href: "/palavras", rotulo: "Palavras bloqueadas", icone: "palavras" },
    ...(ehDono ? [{ href: "/devs", rotulo: "Devs", icone: "devs" as const }] : []),
  ];

  return (
    <div className={estilos.casca}>
      <aside className={estilos.lateral}>
        <Link href="/inicio" className={estilos.marca}>
          <Marca tamanho={26} />
          <span>CommitPost</span>
        </Link>

        <Navegacao itens={itens} />

        <div className={estilos.rodape}>
          <div className={estilos.usuario}>
            <span className={estilos.nome}>{user.displayName ?? user.githubLogin}</span>
            <span className={estilos.papel}>{ehDono ? "dono" : "dev"}</span>
          </div>

          <div className={estilos.acoesRodape}>
            <AlternadorTema />
            <form action="/api/auth/logout" method="post">
              <button type="submit" className={estilos.sair}>
                Sair
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className={estilos.corpo}>
        {resumo.ready && pendentes.length === 0 ? null : (
          <FaixaPendencia quantos={pendentes.length} />
        )}
        <main className={estilos.conteudo}>{children}</main>
      </div>
    </div>
  );
}

/**
 * A faixa que reaparece quando algo obrigatório quebra.
 *
 * Fica fora do `<main>` de propósito: ela vale para a aplicação inteira, não
 * para a tela que está aberta.
 */
function FaixaPendencia({ quantos }: { quantos: number }) {
  if (quantos === 0) return null;

  return (
    <div className={estilos.faixa} role="status">
      <span>
        {quantos === 1
          ? "Falta uma conexão obrigatória — o sistema não gera posts sem ela."
          : `Faltam ${String(quantos)} conexões obrigatórias — o sistema não gera posts sem elas.`}
      </span>
      <Link href="/onboarding" className={estilos.faixaLink}>
        Resolver
      </Link>
    </div>
  );
}
