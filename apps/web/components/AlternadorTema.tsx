"use client";

/**
 * Alternar entre claro e escuro.
 *
 * O tema é lido do cookie NO SERVIDOR e sai já aplicado no `<html>`, então não
 * existe piscada de tela clara antes do escuro aparecer — que é o defeito
 * clássico de tema guardado em `localStorage`.
 *
 * Este componente cuida só do clique: muda o atributo na hora, para a resposta
 * ser imediata, e grava o cookie para a próxima visita já vir certa. É o único
 * pedaço de estado de cliente da aplicação inteira.
 *
 * O ícone certo aparece antes de qualquer JavaScript rodar porque quem decide
 * qual mostrar é o CSS, com a mesma regra de três estados dos tokens. Se
 * dependesse deste componente, o botão nasceria com o ícone errado para quem
 * usa o sistema no escuro.
 */

import estilos from "./AlternadorTema.module.css";

const COOKIE = "commitpost_tema";
const UM_ANO = 60 * 60 * 24 * 365;

function temaAtual(): "claro" | "escuro" {
  const escolhido = document.documentElement.dataset["tema"];
  if (escolhido === "claro" || escolhido === "escuro") return escolhido;

  // Sem escolha manual, o efetivo é o que o sistema pede.
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

export function AlternadorTema() {
  function alternar(): void {
    const proximo = temaAtual() === "escuro" ? "claro" : "escuro";

    document.documentElement.dataset["tema"] = proximo;
    document.cookie = `${COOKIE}=${proximo}; path=/; max-age=${String(UM_ANO)}; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={alternar}
      className={estilos.botao}
      // O rótulo não diz o estado atual porque ele muda sem o React saber —
      // diz a ação, que é sempre a mesma frase.
      aria-label="Alternar entre tema claro e escuro"
      title="Alternar tema"
    >
      <svg className={estilos.lua} viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false">
        <path
          d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>

      <svg className={estilos.sol} viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false">
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
        </g>
      </svg>
    </button>
  );
}
