/**
 * A porta de entrada.
 *
 * Enxuta de propósito: quem chega aqui ou tem acesso ou não tem, e nenhum
 * texto muda isso. A explicação do produto vive na introdução, para quem já
 * entrou — vender antes da porta era ocupar a tela com o que ninguém lê.
 *
 * Não há campo de senha porque não há senha. Quem prova quem você é é o
 * GitHub; aqui só existe a confirmação disso.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlternadorTema } from "@/components/AlternadorTema";
import { Marca } from "@/components/Marca";
import { Acao, Recado } from "@/components/ui";
import { currentUser } from "@/lib/runtime";
import { primeiroParam } from "@/lib/params";
import estilos from "./entrada.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar" };

export default async function Entrada({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await currentUser()) !== null) redirect("/inicio");

  const erro = primeiroParam((await searchParams)["erro"]);

  return (
    <main className={estilos.tela}>
      <div className={estilos.canto}>
        <AlternadorTema />
      </div>

      <div className={estilos.cartao}>
        <Marca tamanho={44} />
        <h1 className={estilos.nome}>CommitPost</h1>

        {erro !== undefined && <Recado tom="erro">{erro}</Recado>}

        <Acao href="/api/auth/github/login" tom="principal">
          Entrar com o GitHub
        </Acao>

        <p className={estilos.rodape}>
          O acesso é liberado por quem administra o sistema!
        </p>
      </div>
    </main>
  );
}
