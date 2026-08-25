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
import { BotaoLateral } from "@/components/BotaoLateral";
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
        <div className={estilos.topo}>
          <Link href="/inicio" className={estilos.marca}>
            <Marca tamanho={26} />
            <span className={estilos.nomeMarca}>CommitPost</span>
          </Link>
          <BotaoLateral />
        </div>

        <Navegacao itens={itens} />

        <div className={estilos.rodape}>
          <div className={estilos.usuario}>
            <span className={estilos.nome}>{user.displayName ?? user.githubLogin}</span>
            <span className={estilos.papel}>{ehDono ? "dono" : "dev"}</span>
          </div>

          <div className={estilos.acoesRodape}>
            <AlternadorTema />
            <form action="/api/auth/logout" method="post">
              <button type="submit" className={estilos.sair} title="Sair">
                <span className={estilos.textoSair}>Sair</span>
                <svg
                  className={estilos.iconeSair}
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9M15 16l4-4-4-4M19 12H9" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className={estilos.corpo}>
        <FaixaPendencia quantos={pendentes.length} avisos={resumo.avisos} />
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
function FaixaPendencia({ quantos, avisos }: { quantos: number; avisos: readonly string[] }) {
  if (quantos > 0) {
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

  // Configurado, mas com algo que faz o ciclo trabalhar em vão — os e-mails de
  // autor, por exemplo. Não é passo, e por isso aponta para Conexões e não
  // para a introdução.
  const primeiro = avisos[0];
  if (primeiro === undefined) return null;

  return (
    <div className={estilos.faixa} role="status">
      <span>{primeiro}</span>
      <Link href="/conexoes" className={estilos.faixaLink}>
        Resolver
      </Link>
    </div>
  );
}
