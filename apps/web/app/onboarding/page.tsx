/**
 * A tela de introdução.
 *
 * Esta página é a resposta a uma decisão de produto: nada do que um dev
 * precisa configurar deve morar num arquivo de instruções. Cada passo aqui
 * sabe se já foi cumprido porque olha o banco, e cada botão leva direto para o
 * lugar onde a coisa se resolve.
 *
 * O que É passo e o que NÃO é foi decidido pelo mesmo critério: só entra na
 * lista numerada o que impede o sistema de funcionar. A lista de termos
 * proibidos fica embaixo, fora da contagem — ela é proposta sozinha, dá para
 * ajustar quando quiser, e transformá-la num passo obrigatório fazia o
 * onboarding parecer mais longo do que é sem proteger nada a mais.
 *
 * Ela é um Server Component: os dados vêm do banco na renderização e os
 * formulários chamam Server Actions. Não há estado de cliente para
 * dessincronizar do servidor.
 */

import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { currentOrNewLinkCode, telegramDeepLink } from "@commitpost/core/auth";
import {
  deniedTerms,
  githubInstallations,
  listRepos,
  oauthTokens,
  userEmails,
} from "@commitpost/core/db";
import { fetchBotUsername } from "@commitpost/core/telegram";
import { computeOnboarding, type OnboardingStep } from "@commitpost/core/onboarding";
import { db, env, requireUser } from "@/lib/runtime";
import { GITHUB_COLLAB_PROVIDER, LINKEDIN_PROVIDER } from "@/lib/providers";
import {
  adicionarEmail,
  adicionarTermo,
  alternarRepo,
  desvincularTelegram,
  removerEmail,
  removerTermo,
  renomearRepo,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * A rota `/api/auth/linkedin/authorize` existe desde a Fase 7, e os produtos
 * Share on LinkedIn e Sign In with LinkedIn foram liberados no portal — então
 * o passo volta a aparecer.
 *
 * A constante fica de pé: ter as credenciais no ambiente não basta, e foi
 * exatamente isso que fez o botão levar a um 404 antes. Um passo que parece
 * disponível e não está é pior do que um passo cinza — o dev clica, não
 * entende, e passa a desconfiar do resto da tela.
 */
const CONEXAO_LINKEDIN_PRONTA = true;

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

  const [instalacoes, emails, termos, tokens, repositorios] = await Promise.all([
    database.select().from(githubInstallations).where(eq(githubInstallations.userId, user.id)),
    database.select().from(userEmails).where(eq(userEmails.userId, user.id)),
    database.select().from(deniedTerms).where(eq(deniedTerms.userId, user.id)),
    database
      .select({ provider: oauthTokens.provider })
      .from(oauthTokens)
      .where(eq(oauthTokens.userId, user.id)),
    listRepos(database, user.id),
  ]);

  const providers = new Set(tokens.map((t) => t.provider));

  const { steps, ready, next } = computeOnboarding({
    installationCount: instalacoes.length,
    emailCount: emails.length,
    telegramLinked: user.telegramChatId !== null,
    hasCollaborationGrant: providers.has(GITHUB_COLLAB_PROVIDER),
    hasLinkedIn: providers.has(LINKEDIN_PROVIDER),
    collaborationsAvailable: configuration.GITHUB_OAUTH_CLIENT_ID !== undefined,
    linkedInAvailable:
      CONEXAO_LINKEDIN_PRONTA && configuration.LINKEDIN_CLIENT_ID !== undefined,
  });

  // Só emite código de vínculo se o passo estiver aberto — não faz sentido
  // manter um código vivo para quem já vinculou.
  const bot =
    user.telegramChatId === null ? await botUsername(configuration.TELEGRAM_BOT_TOKEN) : null;
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
        Conecte o GitHub e o Telegram e o sistema começa a trabalhar. Ele lê seus
        commits, descreve o que foi resolvido em linguagem de gente, e manda 2 a 3
        versões para você escolher. <strong>Nada é publicado sem você aprovar.</strong>
      </p>

      {ready ? (
        <Recado tom="feito">
          Tudo pronto. No próximo ciclo você recebe os primeiros posts no Telegram.
        </Recado>
      ) : null}

      <ol style={{ listStyle: "none", padding: 0, margin: "1.5rem 0 0" }}>
        {steps.map((step) => (
          <Passo key={step.id} step={step} destacado={step.id === next}>
            {step.id === "github" && <Github instalacoes={instalacoes} emails={emails} />}
            {step.id === "collaborations" && (
              <Colaboracoes concedido={step.done} disponivel={step.available} />
            )}
            {step.id === "telegram" && (
              <Telegram
                vinculado={user.telegramChatId !== null}
                link={linkTelegram}
                botConfigurado={bot !== null || user.telegramChatId !== null}
              />
            )}
            {step.id === "linkedin" && (
              <LinkedIn conectado={step.done} disponivel={step.available} />
            )}
          </Passo>
        ))}
      </ol>

      <Repositorios repos={repositorios} />
      <Denylist termos={termos} />
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

const nota = {
  fontSize: "0.85rem",
  color: CORES.indisponivel,
  marginBottom: 0,
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

/** Separa as duas metades do passo do GitHub sem sugerir que são passos. */
function Divisor({ titulo }: { titulo: string }) {
  return (
    <h3
      style={{
        fontSize: "0.9rem",
        margin: "1.25rem 0 0.35rem",
        paddingTop: "0.9rem",
        borderTop: `1px solid ${CORES.fundo}`,
      }}
    >
      {titulo}
    </h3>
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
  emails,
}: {
  instalacoes: {
    id: number;
    accountLogin: string;
    accountType: string;
    suspendedAt: Date | null;
  }[];
  emails: { id: number; email: string; source: string }[];
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

      <p style={nota}>
        Se os repositórios são de uma organização, quem instala precisa ser admin dela.
        Uma instalação cobre todos os repos que você escolher.
      </p>

      <Divisor titulo="Seus e-mails de autor" />
      <p style={{ margin: "0 0 0.7rem", color: "#3c4043", fontSize: "0.95rem" }}>
        É por eles que o sistema reconhece um commit como seu. O do trabalho costuma
        ser diferente do pessoal.
      </p>

      {emails.length > 0 && (
        <Lista>
          {emails.map((e) => (
            <Item key={e.id}>
              <span style={{ wordBreak: "break-all" }}>
                {e.email}
                {e.source === "github" && (
                  <span style={{ color: CORES.indisponivel, fontSize: "0.85rem" }}>
                    {" "}
                    · do GitHub
                  </span>
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

      <p style={nota}>
        Confira com <code>git config user.email</code> na máquina onde você trabalha.
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
            <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer">
              github.com/settings/applications
            </a>
            .
          </p>
        </div>
      </details>

      <a href="/api/auth/github/oauth/authorize" style={concedido ? botaoDiscreto : botaoPrincipal}>
        {concedido ? "Reautorizar" : "Conceder acesso de colaboração"}
      </a>

      <p style={nota}>
        Pule se todos os seus commits estão em contas onde você instalou o CommitPost
        no passo anterior.
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
      <p style={nota}>
        O link vale 15 minutos e serve uma vez. Basta abrir e tocar em iniciar — você
        não precisa digitar nada.
      </p>
    </>
  );
}

function LinkedIn({ conectado, disponivel }: { conectado: boolean; disponivel: boolean }) {
  if (!disponivel) {
    return (
      <p style={{ color: CORES.indisponivel, margin: 0 }}>
        A publicação automática ainda está em aprovação no LinkedIn. Até lá, o post
        aprovado chega pronto no Telegram para você copiar.
      </p>
    );
  }

  return (
    <>
      <a href="/api/auth/linkedin/authorize" style={conectado ? botaoDiscreto : botaoPrincipal}>
        {conectado ? "Reconectar" : "Conectar o LinkedIn"}
      </a>

      <p style={nota}>
        O acesso do LinkedIn dura cerca de 60 dias e não se renova sozinho — o bot
        avisa antes de vencer, e reconectar é este mesmo botão. Você pode revogar
        quando quiser em{" "}
        <a
          href="https://www.linkedin.com/mypreferences/d/permitted-services"
          target="_blank"
          rel="noreferrer"
        >
          serviços autorizados
        </a>
        .
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fora da lista: ajuste, não passo
// ---------------------------------------------------------------------------

/**
 * Quais repositórios entram na coleta.
 *
 * Fora da numeração pelo mesmo critério do resto: novo repositório entra ativo,
 * então não há nada a cumprir aqui para o sistema funcionar. Existe porque a
 * concessão de colaboração é tudo-ou-nada — ela alcança todos os repositórios
 * de uma vez —, e sem esta lista "não quero que este vire post" não teria
 * resposta em lugar nenhum.
 *
 * O apelido é editável e começa sem significado (`repo-3`). Qualquer padrão
 * derivado do nome real — iniciais, abreviação — seria o nome real de volta
 * com um disfarce; o que é seguro chamar cada projeto é decisão de quem
 * conhece o contrato, não nossa.
 */
function Repositorios({ repos }: { repos: { id: number; alias: string; active: boolean }[] }) {
  const ativos = repos.filter((r) => r.active).length;

  if (repos.length === 0) {
    return (
      <p style={{ ...nota, marginTop: "1.5rem" }}>
        Os repositórios aparecem aqui depois que você conectar o GitHub.
      </p>
    );
  }

  return (
    <details
      style={{
        border: `1px solid ${CORES.borda}`,
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        marginTop: "1.5rem",
        background: CORES.fundo,
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Repositórios que entram na coleta
        <span style={{ color: CORES.indisponivel, fontWeight: 400 }}>
          {" "}
          · {String(ativos)} de {String(repos.length)}
        </span>
      </summary>

      <p style={{ margin: "0.75rem 0", color: "#3c4043", fontSize: "0.95rem" }}>
        Desligue os que não devem virar post. O apelido é só para você reconhecer
        de onde veio cada sugestão no Telegram — ele aparece na mensagem de
        aprovação, então <strong>não use o nome do cliente</strong>.
      </p>

      <Lista>
        {repos.map((r) => (
          <Item key={r.id}>
            <form action={renomearRepo} style={{ display: "flex", gap: "0.4rem", flex: 1 }}>
              <input type="hidden" name="id" value={r.id} />
              <input
                type="text"
                name="apelido"
                defaultValue={r.alias}
                maxLength={60}
                aria-label="Apelido do repositório"
                style={{ ...campo, opacity: r.active ? 1 : 0.5 }}
              />
              <button type="submit" style={botaoDiscreto}>
                Renomear
              </button>
            </form>

            <form action={alternarRepo}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="ativo" value={r.active ? "0" : "1"} />
              <button type="submit" style={r.active ? botaoDiscreto : botaoPrincipal}>
                {r.active ? "Desligar" : "Ligar"}
              </button>
            </form>
          </Item>
        ))}
      </Lista>

      <p style={nota}>
        Um repositório desligado não é consultado — nem os commits dele são lidos.
      </p>
    </details>
  );
}

/**
 * A lista de termos proibidos.
 *
 * Fora da numeração de propósito. Ela é preenchida sozinha a cada conexão do
 * GitHub, e não é ela que impede vazamento — o que impede é o filtro nunca
 * copiar texto de commit para a saída. Aqui é ajuste fino, e pode esperar.
 */
function Denylist({ termos }: { termos: { id: number; term: string; source: string }[] }) {
  const automaticos = termos.filter((t) => t.source === "auto").length;

  return (
    <details
      style={{
        border: `1px solid ${CORES.borda}`,
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        marginTop: "1.5rem",
        background: CORES.fundo,
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Palavras que nunca aparecem nos seus posts
        <span style={{ color: CORES.indisponivel, fontWeight: 400 }}>
          {" "}
          · {String(termos.length)} — ajuste quando quiser
        </span>
      </summary>

      <p style={{ margin: "0.75rem 0", color: "#3c4043", fontSize: "0.95rem" }}>
        Preenchida sozinha com os nomes dos seus repositórios e das contas donas deles.
        Isto <strong>não</strong> decide quais repositórios são lidos — decide o que
        jamais é escrito. Acrescente clientes e produtos internos que não viraram
        repositório.
      </p>

      {termos.length > 0 && (
        <Lista>
          {termos.map((t) => (
            <Item key={t.id}>
              <span style={{ wordBreak: "break-word" }}>
                {t.term}
                {t.source === "auto" && (
                  <span style={{ color: CORES.indisponivel, fontSize: "0.85rem" }}>
                    {" "}
                    · sugerido
                  </span>
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

      <p style={nota}>
        {automaticos > 0 && `${String(automaticos)} vieram dos seus repositórios. `}
        Termos com menos de 3 letras são ignorados pelo filtro, e a comparação é por
        palavra inteira.
      </p>
    </details>
  );
}
