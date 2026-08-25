/**
 * As peças de interface que aparecem em mais de uma tela.
 *
 * Todas de servidor: nenhuma tem estado. O único componente de cliente da
 * aplicação é o alternador de tema, e é assim que deve continuar — estado de
 * cliente é a coisa que dessincroniza do banco sem ninguém notar.
 *
 * `Botao` e `Acao` existem separados porque um é `<button>` e o outro é `<a>`,
 * e trocar um pelo outro quebra o teclado: link navega, botão executa.
 */

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import estilos from "./ui.module.css";

export type Tom = "principal" | "discreto" | "perigo";

function classeTom(tom: Tom): string {
  if (tom === "principal") return `${estilos.botao} ${estilos.principal}`;
  if (tom === "perigo") return `${estilos.botao} ${estilos.perigo}`;
  return `${estilos.botao} ${estilos.discreto}`;
}

export function Botao({
  tom = "discreto",
  className,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { tom?: Tom }) {
  return <button className={`${classeTom(tom)} ${className ?? ""}`} {...resto} />;
}

export function Acao({
  tom = "principal",
  href,
  externo = false,
  children,
  ...resto
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  tom?: Tom;
  href: string;
  externo?: boolean;
}) {
  // Rotas de API são redirecionamentos do servidor: o `Link` do Next tentaria
  // buscá-las como página e o fluxo de OAuth não sairia do lugar.
  const precisaNavegacaoCrua = externo || href.startsWith("/api/") || href.startsWith("http");

  if (precisaNavegacaoCrua) {
    return (
      <a
        className={classeTom(tom)}
        href={href}
        {...(externo ? { target: "_blank", rel: "noreferrer" } : {})}
        {...resto}
      >
        {children}
      </a>
    );
  }

  // Repassar o resto dos atributos de âncora para o `Link` não passa no
  // `exactOptionalPropertyTypes`: os tipos do Next não aceitam a propriedade
  // presente valendo `undefined`. Só o que a aplicação usa atravessa, e é
  // melhor assim — um `target` num link interno seria um bug silencioso.
  const { "aria-current": atual, title, "data-vazio": vazio } = resto as typeof resto & {
    "data-vazio"?: string;
  };

  return (
    <Link
      className={classeTom(tom)}
      href={href}
      {...(atual === undefined ? {} : { "aria-current": atual })}
      {...(title === undefined ? {} : { title })}
      {...(vazio === undefined ? {} : { "data-vazio": vazio })}
    >
      {children}
    </Link>
  );
}

export function TituloPagina({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <header className={estilos.cabecalhoPagina}>
      <div>
        <h1>{titulo}</h1>
        {descricao !== undefined && <p className={estilos.descricaoPagina}>{descricao}</p>}
      </div>
      {acao}
    </header>
  );
}

export function Cartao({
  titulo,
  descricao,
  children,
}: {
  titulo?: string;
  descricao?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={estilos.cartao}>
      {titulo !== undefined && <h2 className={estilos.cartaoTitulo}>{titulo}</h2>}
      {descricao !== undefined && <p className={estilos.cartaoDescricao}>{descricao}</p>}
      {children}
    </section>
  );
}

export type TomRecado = "erro" | "aviso" | "ok" | "neutro";

export function Recado({ tom, children }: { tom: TomRecado; children: ReactNode }) {
  return (
    <p className={`${estilos.recado} ${estilos[tom]}`} role={tom === "erro" ? "alert" : undefined}>
      {children}
    </p>
  );
}

export function Lista({ children }: { children: ReactNode }) {
  return <ul className={estilos.lista}>{children}</ul>;
}

export function Item({ children }: { children: ReactNode }) {
  return <li className={estilos.item}>{children}</li>;
}

export function Nota({ children }: { children: ReactNode }) {
  return <p className={estilos.nota}>{children}</p>;
}

export function Campo({
  className,
  ...resto
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${estilos.campo} ${className ?? ""}`} {...resto} />;
}

/** Linha de formulário: campo que estica e botão que não. */
export function LinhaForm({ children }: { children: ReactNode }) {
  return <div className={estilos.linhaForm}>{children}</div>;
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className={estilos.vazio}>{children}</p>;
}

export type EstadoSelo = "ok" | "pendente" | "inativo" | "erro";

/**
 * O selo de estado.
 *
 * A cor nunca é a única informação: cada estado tem forma e texto próprios.
 * Quem não distingue as cores lê a mesma coisa que os outros — e o âmbar
 * continua livre para significar só "clique aqui".
 */
export function Selo({ estado, children }: { estado: EstadoSelo; children: ReactNode }) {
  const marca = estado === "ok" ? "●" : estado === "erro" ? "▲" : "○";

  return (
    <span className={`${estilos.selo} ${estilos[`selo_${estado}`]}`}>
      <span aria-hidden>{marca}</span>
      {children}
    </span>
  );
}
