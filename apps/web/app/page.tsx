/**
 * A porta de entrada.
 *
 * Quem já tem sessão nem vê esta tela — vai direto para a introdução. Quem não
 * tem vê o que o sistema faz antes de decidir entrar, e principalmente a regra
 * que responde à primeira pergunta de qualquer dev: o que exatamente vai parar
 * no meu perfil.
 */

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/runtime";

export const dynamic = "force-dynamic";

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if ((await currentUser()) !== null) redirect("/onboarding");

  const erro = primeiro((await searchParams)["erro"]);

  return (
    <main>
      <h1 style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>CommitPost</h1>
      <p style={{ fontSize: "1.05rem", color: "#3c4043", marginTop: 0 }}>
        Seus commits viram posts de LinkedIn. Você aprova cada um antes de qualquer
        coisa ir ao ar.
      </p>

      {erro !== undefined && (
        <p
          style={{
            background: "#fce8e6",
            border: "1px solid #dadce0",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
          }}
        >
          {erro}
        </p>
      )}

      <ul style={{ paddingLeft: "1.2rem", color: "#3c4043" }}>
        <li>
          <strong>Nada identifica onde você trabalha.</strong> O post fala da solução
          técnica; nome de empresa, cliente, produto e repositório não têm por onde sair.
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

      <a
        href="/api/auth/github/login"
        style={{
          display: "inline-block",
          background: "#1a1a1a",
          color: "#fff",
          borderRadius: "0.375rem",
          padding: "0.6rem 1.1rem",
          textDecoration: "none",
          marginTop: "0.5rem",
        }}
      >
        Entrar com o GitHub
      </a>

      <p style={{ fontSize: "0.85rem", color: "#70757a" }}>
        O acesso é restrito aos devs autorizados pelo operador do sistema.
      </p>
    </main>
  );
}
