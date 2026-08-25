/**
 * Layout raiz.
 *
 * O tema sai do cookie AQUI, no servidor, e desce já no `<html>`. É o que
 * elimina a piscada de tela clara antes do escuro aparecer — o defeito de
 * quem guarda tema em `localStorage` e só descobre a escolha depois que o
 * JavaScript roda.
 *
 * Sem cookie, o atributo não é escrito e quem decide é o
 * `prefers-color-scheme` do sistema, pelo CSS. Três estados, e o padrão é
 * "faça o que o sistema faz".
 */

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "CommitPost",
    template: "%s · CommitPost",
  },
  description: "Commits viram posts — com aprovação humana antes de publicar.",
};

const COOKIE_TEMA = "commitpost_tema";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const escolhido = (await cookies()).get(COOKIE_TEMA)?.value;
  const tema = escolhido === "claro" || escolhido === "escuro" ? escolhido : undefined;

  return (
    <html lang="pt-BR" {...(tema === undefined ? {} : { "data-tema": tema })}>
      <body>{children}</body>
    </html>
  );
}
