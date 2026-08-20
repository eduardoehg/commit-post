/**
 * A tela de introdução.
 *
 * Esta página é a resposta a uma decisão de produto: nada do que um dev
 * precisa configurar deve morar num arquivo de instruções. Cada passo aqui
 * sabe se já foi cumprido porque olha o banco, e cada botão leva direto para o
 * lugar onde a coisa se resolve.
 *
 * Ela é um Server Component: os dados vêm do banco na renderização e os
 * formulários chamam Server Actions. Não há estado de cliente para
 * dessincronizar do servidor.
 */

import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import {
  currentOrNewLinkCode,
  telegramDeepLink,
} from "@commitpost/core/auth";
import { deniedTerms, githubInstallations, oauthTokens, userEmails } from "@commitpost/core/db";
import { fetchBotUsername } from "@commitpost/core/telegram";
import { computeOnboarding, type OnboardingStep } from "@commitpost/core/onboarding";
import { db, env, requireUser } from "@/lib/runtime";
import { GITHUB_COLLAB_PROVIDER, LINKEDIN_PROVIDER } from "@/lib/providers";
import {
  adicionarEmail,
  adicionarTermo,
  confirmarDenylistVazia,
  desvincularTelegram,
  removerEmail,
  removerTermo,
} from "./actions";

export const dynamic = "force-dynamic";

const CORES = {
  feito: "#137333",
  pendente: "#8a6d00",
  indisponivel: "#70757a",
  borda: "#dadce0",
  aviso: "#fef7e0",
  erro: "#fce8e6",
  fundo: "#f8f9fa",
} as const;

/** O @username do bot muda praticamente nunca; uma consulta por instância basta. */
let botUsernameCache: string | undefined;

async function botUsername(token: string): Promise<string | null> {
  if (botUsernameCache !== undefined) return botUsernameCache;
  try {
    botUsernameCache = await fetchBotUsername(token);
    return botUsernameCache;
  } catch {
    return null;
  }
}

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const configuration = env();
  const database = db();
  const params = await searchParams;

  const [instalacoes, emails, termos, tokens] = await Promise.all([
    database
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.userId, user.id)),
    database.select().from(userEmails).where(eq(userEmails.userId, user.id)),
    database.select().from(deniedTerms).where(eq(deniedTerms.userId, user.id)),
    database
      .select({ provider: oauthTokens.provider })
      .from(oauthTokens)
      .where(eq(oauthTokens.userId, user.id)),
  ]);

  const providers = new Set(tokens.map((t) => t.provider));

  const { steps, ready, next } = computeOnboarding({
    installationCount: instalacoes.length,
    emailCount: emails.length,
    deniedTermCount: termos.length,
    denylistAcknowledged: user.denylistAcknowledgedAt !== null,
    telegramLinked: user.telegramChatId !== null,
    hasCollaborationGrant: providers.has(GITHUB_COLLAB_PROVIDER),
    hasLinkedIn: providers.has(LINKEDIN_PROVIDER),
    collaborationsAvailable: configuration.GITHUB_OAUTH_CLIENT_ID !== undefined,
    linkedInAvailable: configuration.LINKEDIN_CLIENT_ID !== undefined,
  });

  // Só emite código de vínculo se o passo estiver aberto — não faz sentido
  // manter um código vivo para quem já vinculou.
  const bot = user.telegramChatId === null ? await botUsername(configuration.TELEGRAM_BOT_TOKEN) : null;
  const linkTelegram =
    bot === null ? null : telegramDeepLink(bot, await currentOrNewLinkCode(database, user.id));

  const erro = primeiro(params["erro"]);
  const aviso = primeiro(params["aviso"]);

  return (
    <main>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.6rem" }}>Bem-vindo ao CommitPost</h1>
          <p style={{ margin: "0.25rem 0 0", color: CORES.indisponivel }}>
            {user.displayName ?? user.githubLogin}
          </p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button type="submit" style={botaoDiscreto}>
            Sair
          </button>
        </form>
      </header>

      {erro !== undefined && <Recado tom="erro">{erro}</Recado>}
      {aviso !== undefined && <Recado tom="aviso">{aviso}</Recado>}

      <p>
        Quatro passos e o sistema começa a trabalhar. Ele lê seus commits, descreve
        o que foi resolvido em linguagem de gente, e manda 2 a 3 versões no seu
        Telegram. <strong>Nada é publicado sem você aprovar.</strong>
      </p>

      {ready ? (
        <Recado tom="feito">
          Tudo pronto. No próximo ciclo você recebe os primeiros posts no Telegram.
        </Recado>
      ) : null}

      <ol style={{ listStyle: "none", padding: 0, margin: "1.5rem 0 0" }}>
        {steps.map((step) => (
          <Passo key={step.id} step={step} destacado={step.id === next}>
            {step.id === "github" && (
              <Github instalacoes={instalacoes} />
            )}
            {step.id === "emails" && <Emails emails={emails} />}
            {step.id === "denylist" && (
              <Denylist termos={termos} confirmada={user.denylistAcknowledgedAt !== null} />
            )}
            {step.id === "telegram" && (
              <Telegram
                vinculado={user.telegramChatId !== null}
                link={linkTelegram}
                botConfigurado={bot !== null || user.telegramChatId !== null}
              />
            )}
            {step.id === "collaborations" && (
              <Colaboracoes concedido={step.done} disponivel={step.available} />
            )}
            {step.id === "linkedin" && <LinkedIn disponivel={step.available} />}
          </Passo>
        ))}
      </ol>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------

const botaoDiscreto = {
  background: "none",
  border: `1px solid ${CORES.borda}`,
  borderRadius: "0.375rem",
  padding: "0.35rem 0.75rem",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.875rem",
} as const;

const botaoPrincipal = {
  display: "inline-block",
  background: "#1a1a1a",
  color: "#fff",
  border: "none",
  borderRadius: "0.375rem",
  padding: "0.5rem 1rem",
  cursor: "pointer",
  font: "inherit",
  fontSize: "0.9rem",
  textDecoration: "none",
} as const;

function Recado({ tom, children }: { tom: "erro" | "aviso" | "feito"; children: ReactNode }) {
  const fundo = tom === "erro" ? CORES.erro : tom === "aviso" ? CORES.aviso : "#e6f4ea";
  return (
    <p
      style={{
        background: fundo,
        border: `1px solid ${CORES.borda}`,
        borderRadius: "0.5rem",
        padding: "0.75rem 1rem",
        margin: "1rem 0",
      }}
    >
      {children}
    </p>
  );
}

function Passo({
  step,
  destacado,
  children,
}: {
  step: OnboardingStep;
  destacado: boolean;
  children: ReactNode;
}) {
  const cor = !step.available ? CORES.indisponivel : step.done ? CORES.feito : CORES.pendente;

  return (
    <li
      style={{
        border: `1px solid ${destacado ? "#1a1a1a" : CORES.borda}`,
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        marginBottom: "0.75rem",
        background: step.available ? "#fff" : CORES.fundo,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
        <span aria-hidden style={{ color: cor, fontSize: "1.1rem" }}>
          {step.done ? "●" : "○"}
        </span>
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
          {step.title}
          {!step.required && (
            <span style={{ color: CORES.indisponivel, fontWeight: 400 }}> · opcional</span>
          )}
        </h2>
      </div>
      <p style={{ margin: "0.4rem 0 0.8rem 1.7rem", color: "#3c4043" }}>{step.summary}</p>
      <div style={{ marginLeft: "1.7rem" }}>{children}</div>
    </li>
  );
}

function Lista({ children }: { children: ReactNode }) {
  return <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.75rem" }}>{children}</ul>;
}

function Item({ children }: { children: ReactNode }) {
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.35rem 0",
        borderBottom: `1px solid ${CORES.fundo}`,
      }}
    >
      {children}
    </li>
  );
}

const campo = {
  flex: 1,
  padding: "0.45rem 0.6rem",
  border: `1px solid ${CORES.borda}`,
  borderRadius: "0.375rem",
  font: "inherit",
  fontSize: "0.9rem",
  minWidth: 0,
} as const;

// ---------------------------------------------------------------------------
// Passos
// ---------------------------------------------------------------------------

function Github({
  instalacoes,
}: {
  instalacoes: { id: number; accountLogin: string; accountType: string; suspendedAt: Date | null }[];
}) {
  return (
    <>
      {instalacoes.length > 0 && (
        <Lista>
          {instalacoes.map((i) => (
            <Item key={i.id}>
              <span>
                <strong>{i.accountLogin}</strong>{" "}
                <span style={{ color: CORES.indisponivel }}>
                  ({i.accountType === "Organization" ? "organização" : "conta pessoal"})
                </span>
              </span>
              {i.suspendedAt !== null && <span style={{ color: CORES.pendente }}>suspensa</span>}
            </Item>
          ))}
        </Lista>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <a href="/api/auth/github/install" style={botaoPrincipal}>
          {instalacoes.length === 0 ? "Instalar o CommitPost" : "Instalar em outra conta"}
        </a>
        <a href="/api/auth/github/login" style={{ ...botaoDiscreto, textDecoration: "none" }}>
          Já instalei, atualizar
        </a>
      </div>

      <p style={{ fontSize: "0.85rem", color: CORES.indisponivel, marginBottom: 0 }}>
        Se os repositórios são de uma organização, quem instala precisa ser admin dela.
        Uma instalação cobre todos os repos que você escolher.
      </p>
    </>
  );
}

function Emails({ emails }: { emails: { id: number; email: string; source: string }[] }) {
  return (
    <>
      {emails.length > 0 && (
        <Lista>
          {emails.map((e) => (
            <Item key={e.id}>
              <span style={{ wordBreak: "break-all" }}>
                {e.email}
                {e.source === "github" && (
                  <span style={{ color: CORES.indisponivel, fontSize: "0.85rem" }}> · do GitHub</span>
                )}
              </span>
              <form action={removerEmail}>
                <input type="hidden" name="id" value={e.id} />
                <button type="submit" style={botaoDiscreto}>
                  Remover
                </button>
              </form>
            </Item>
          ))}
        </Lista>
      )}

      <form action={adicionarEmail} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="email"
          name="email"
          placeholder="voce@empresa.com"
          required
          style={campo}
          aria-label="E-mail de autor"
        />
        <button type="submit" style={botaoPrincipal}>
          Adicionar
        </button>
      </form>

      <p style={{ fontSize: "0.85rem", color: CORES.indisponivel, marginBottom: 0 }}>
        Confira com <code>git config user.email</code> na máquina onde você trabalha.
      </p>
    </>
  );
}

function Denylist({
  termos,
  confirmada,
}: {
  termos: { id: number; term: string; source: string }[];
  confirmada: boolean;
}) {
  const automaticos = termos.filter((t) => t.source === "auto").length;

  return (
    <>
      {termos.length > 0 && (
        <Lista>
          {termos.map((t) => (
            <Item key={t.id}>
              <span style={{ wordBreak: "break-word" }}>
                {t.term}
                {t.source === "auto" && (
                  <span style={{ color: CORES.indisponivel, fontSize: "0.85rem" }}> · sugerido</span>
                )}
              </span>
              <form action={removerTermo}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" style={botaoDiscreto}>
                  Remover
                </button>
              </form>
            </Item>
          ))}
        </Lista>
      )}

      <form action={adicionarTermo} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          name="termo"
          placeholder="Nome de empresa, cliente ou produto"
          required
          style={campo}
          aria-label="Termo proibido"
        />
        <button type="submit" style={botaoPrincipal}>
          Adicionar
        </button>
      </form>

      {automaticos > 0 && (
        <p style={{ fontSize: "0.85rem", color: CORES.indisponivel }}>
          {automaticos === 1
            ? "1 termo veio dos nomes dos seus repositórios."
            : `${String(automaticos)} termos vieram dos nomes dos seus repositórios.`}{" "}
          Remova o que for público.
        </p>
      )}

      {termos.length === 0 && !confirmada && (
        <form action={confirmarDenylistVazia} style={{ marginTop: "0.5rem" }}>
          <button type="submit" style={botaoDiscreto}>
            Não tenho nada a esconder
          </button>
        </form>
      )}

      <p style={{ fontSize: "0.85rem", color: CORES.indisponivel, marginBottom: 0 }}>
        Esta lista nunca entra num post — ela existe para ser removida deles. Fica
        só no banco, e não no repositório do projeto.
      </p>
    </>
  );
}

function Telegram({
  vinculado,
  link,
  botConfigurado,
}: {
  vinculado: boolean;
  link: string | null;
  botConfigurado: boolean;
}) {
  if (vinculado) {
    return (
      <form action={desvincularTelegram}>
        <button type="submit" style={botaoDiscreto}>
          Desvincular este Telegram
        </button>
      </form>
    );
  }

  if (!botConfigurado || link === null) {
    return (
      <p style={{ color: CORES.pendente, margin: 0 }}>
        Não foi possível falar com o bot do Telegram. Avise o operador — o token
        do bot provavelmente está errado.
      </p>
    );
  }

  return (
    <>
      <a href={link} style={botaoPrincipal} target="_blank" rel="noreferrer">
        Abrir o bot e vincular
      </a>
      <p style={{ fontSize: "0.85rem", color: CORES.indisponivel, marginBottom: 0 }}>
        O link vale 15 minutos e serve uma vez. Basta abrir e tocar em iniciar —
        você não precisa digitar nada.
      </p>
    </>
  );
}

function Colaboracoes({ concedido, disponivel }: { concedido: boolean; disponivel: boolean }) {
  if (!disponivel) {
    return (
      <p style={{ color: CORES.indisponivel, margin: 0 }}>
        O operador ainda não configurou este caminho.
      </p>
    );
  }

  return (
    <>
      <details style={{ marginBottom: "0.75rem" }}>
        <summary style={{ cursor: "pointer" }}>O que exatamente você está concedendo</summary>
        <div style={{ fontSize: "0.9rem", color: "#3c4043", marginTop: "0.5rem" }}>
          <p>
            Este passo usa um acesso do GitHub que dá <strong>leitura e escrita</strong> em
            todos os repositórios que você enxerga. Não é escolha nossa: o GitHub não
            oferece um acesso de somente-leitura para repositório privado por este caminho.
          </p>
          <p style={{ marginBottom: 0 }}>
            O que fazemos com isso: só leitura, e nada além de listar commits seus. O
            sistema não tem nenhuma função que escreva no GitHub. O acesso fica cifrado
            no banco, e você pode revogá-lo a qualquer momento em{" "}
            <a
              href="https://github.com/settings/applications"
              target="_blank"
              rel="noreferrer"
            >
              github.com/settings/applications
            </a>
            .
          </p>
        </div>
      </details>

      <a href="/api/auth/github/oauth/authorize" style={concedido ? botaoDiscreto : botaoPrincipal}>
        {concedido ? "Reautorizar" : "Conceder acesso de colaboração"}
      </a>

      <p style={{ fontSize: "0.85rem", color: CORES.indisponivel, marginBottom: 0 }}>
        Pule este passo se todos os seus commits estão em contas onde você instalou o
        CommitPost no passo 1.
      </p>
    </>
  );
}

function LinkedIn({ disponivel }: { disponivel: boolean }) {
  if (!disponivel) {
    return (
      <p style={{ color: CORES.indisponivel, margin: 0 }}>
        A publicação automática ainda está em aprovação no LinkedIn. Até lá, o post
        aprovado chega pronto no Telegram para você copiar.
      </p>
    );
  }

  return (
    <a href="/api/auth/linkedin/authorize" style={botaoPrincipal}>
      Conectar o LinkedIn
    </a>
  );
}
