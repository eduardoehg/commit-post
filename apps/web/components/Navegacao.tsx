"use client";

/**
 * Os links da barra lateral.
 *
 * Cliente por um motivo só: marcar qual está ativo. Layouts de servidor não
 * recebem o caminho da URL, e saber onde você está é justamente o que uma
 * barra de navegação serve para dizer.
 *
 * Quais itens aparecem é decidido no servidor e chega por props — a aba de
 * devs só existe para o dono, e esconder no cliente seria esconder na
 * aparência, não no acesso.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import estilos from "./Navegacao.module.css";

export interface ItemNav {
  href: string;
  rotulo: string;
  /** Nome do ícone em `Icone`. */
  icone: IconeNome;
  /** Some quando o onboarding termina, por exemplo. */
  distintivo?: string;
}

export type IconeNome =
  | "historico"
  | "introducao"
  | "conexoes"
  | "repositorios"
  | "palavras"
  | "devs";

export function Navegacao({ itens }: { itens: readonly ItemNav[] }) {
  const caminho = usePathname();

  return (
    <nav className={estilos.nav} aria-label="Seções">
      <ul className={estilos.lista}>
        {itens.map((item) => {
          // Comparação por prefixo para `/post/12` manter "Histórico" aceso.
          const ativo = caminho === item.href || caminho.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={estilos.item}
                aria-current={ativo ? "page" : undefined}
              >
                <Icone nome={item.icone} />
                <span className={estilos.rotulo}>{item.rotulo}</span>
                {item.distintivo !== undefined && (
                  <span className={estilos.distintivo}>{item.distintivo}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Ícones desenhados à mão, em traço de 1.7 — não há biblioteca de ícones no
 * projeto e seis desenhos não justificam uma dependência.
 */
function Icone({ nome }: { nome: IconeNome }) {
  const comum = {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: "false" as const,
  };

  if (nome === "historico") {
    return (
      <svg {...comum}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8 9.5h8M8 13h8M8 16.5h4.5" />
      </svg>
    );
  }

  if (nome === "introducao") {
    return (
      <svg {...comum}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    );
  }

  if (nome === "conexoes") {
    return (
      <svg {...comum}>
        <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
        <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3" />
      </svg>
    );
  }

  if (nome === "repositorios") {
    return (
      <svg {...comum}>
        <path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v15L12 17l-6.5 3V5A1.5 1.5 0 0 1 7 3.5Z" />
      </svg>
    );
  }

  if (nome === "palavras") {
    return (
      <svg {...comum}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m6.2 6.2 11.6 11.6" />
      </svg>
    );
  }

  return (
    <svg {...comum}>
      <path d="M15.5 20v-1.8a3.4 3.4 0 0 0-3.4-3.4H7a3.4 3.4 0 0 0-3.4 3.4V20" />
      <circle cx="9.5" cy="7.6" r="3.4" />
      <path d="M20.4 20v-1.8a3.4 3.4 0 0 0-2.6-3.3M15.8 4.4a3.4 3.4 0 0 1 0 6.4" />
    </svg>
  );
}
