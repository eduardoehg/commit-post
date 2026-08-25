"use client";

/**
 * Recolher e abrir a barra lateral.
 *
 * Recolher deixa a trilha de ícones, não esconde a navegação: o ganho é o
 * espaço dos rótulos, e sumir com a barra inteira custaria um clique a mais
 * para chegar a qualquer lugar — que é o preço que um menu escondido cobra.
 *
 * Mesmo mecanismo do tema: o estado sai do cookie no servidor, então a barra
 * já nasce do jeito certo e não pula depois que o JavaScript carrega. Este
 * componente cuida só do clique.
 */

import estilos from "./BotaoLateral.module.css";

const COOKIE = "commitpost_lateral";
const UM_ANO = 60 * 60 * 24 * 365;

export function BotaoLateral() {
  function alternar(): void {
    const raiz = document.documentElement;
    const recolhida = raiz.dataset["lateral"] === "recolhida";

    if (recolhida) delete raiz.dataset["lateral"];
    else raiz.dataset["lateral"] = "recolhida";

    document.cookie = `${COOKIE}=${recolhida ? "aberta" : "recolhida"}; path=/; max-age=${String(UM_ANO)}; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={alternar}
      className={estilos.botao}
      // O rótulo diz a ação, não o estado: o estado muda sem o React saber, e
      // um `aria-label` desatualizado é pior do que um genérico.
      aria-label="Recolher ou abrir a barra lateral"
      title="Recolher ou abrir a barra lateral"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false">
        <rect
          x="3.5"
          y="4.5"
          width="17"
          height="15"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path d="M10 4.5V19.5" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    </button>
  );
}
