/**
 * A porta de entrada.
 *
 * Quem já tem sessão nem vê esta tela. Quem não tem vê o que o sistema faz
 * antes de decidir entrar — e principalmente a regra que responde à primeira
 * pergunta de qualquer dev: o que exatamente vai parar no meu perfil.
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
        <div className={estilos.marca}>
          <Marca tamanho={40} />
          <h1 className={estilos.nome}>CommitPost</h1>
        </div>

        <p className={estilos.chamada}>
          Seus commits viram posts de LinkedIn. Você aprova cada um antes de qualquer
          coisa ir ao ar.
        </p>

        {erro !== undefined && <Recado tom="erro">{erro}</Recado>}

        <ul className={estilos.promessas}>
          <li>
            <strong>Nada identifica onde você trabalha.</strong> O post fala da solução
            técnica; nome de empresa, cliente, produto e repositório não têm por onde
            sair.
          </li>
          <li>
            <strong>Nada é publicado sozinho.</strong> Você recebe 2 ou 3 versões no
            Telegram e decide.
          </li>
          <li>
            <strong>Sua mensagem de commit não fica guardada.</strong> Ela é lida, vira
            rótulos genéricos, e é descartada na mesma execução.
          </li>
        </ul>

        <Acao href="/api/auth/github/login" tom="principal">
          Entrar com o GitHub
        </Acao>

        <p className={estilos.rodape}>
          O acesso é liberado por quem administra o sistema. Não há cadastro nem senha.
        </p>
      </div>
    </main>
  );
}
