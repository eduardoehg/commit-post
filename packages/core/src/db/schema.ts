/**
 * Schema do banco — Fase 1.
 *
 * Duas ausências neste arquivo são decisões de projeto, não esquecimento:
 *
 *   1. NÃO existe coluna com a mensagem do commit. A tabela `commits` serve
 *      para deduplicação e procedência, não como depósito de conteúdo. A
 *      mensagem é lida da API do GitHub, atravessa o filtro e é descartada na
 *      mesma execução — nunca toca o disco.
 *
 *   2. NÃO existe coluna com o nome real do repositório. Guardamos o id
 *      numérico do GitHub e um alias nosso; o nome é buscado na API quando
 *      precisa. Caminhos de arquivo, idem: só extensões.
 *
 * O preço da primeira é não conseguir regerar fatos técnicos de commits
 * antigos se o vocabulário melhorar — daria para rebuscar no GitHub. Vale o
 * troco: é a diferença entre um vazamento do banco expor metadados ou expor o
 * trabalho inteiro de duas pessoas.
 */

import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------

/**
 * Um dev.
 *
 * O acesso é controlado por allowlist de logins do GitHub (ver
 * ALLOWED_GITHUB_LOGINS). Sem isso, "entrar com GitHub" deixaria qualquer
 * pessoa do mundo criar conta e consumir a chave da Anthropic do operador.
 */
export const users = pgTable(
  "users",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),

    /**
     * O id numérico é a identidade real: um login do GitHub pode ser trocado
     * pelo dono a qualquer momento, o id não muda nunca.
     */
    githubUserId: bigint("github_user_id", { mode: "number" }).notNull(),
    githubLogin: text("github_login").notNull(),

    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),

    /**
     * Preenchido quando o dev abre o link `t.me/<bot>?start=<código>`.
     * Null = não recebe nada.
     *
     * Único: uma conta do Telegram é de uma pessoa só, e um chat apontando
     * para dois devs mandaria os posts de um para o outro aprovar. Nulo
     * repetido é permitido pelo Postgres, que é o que queremos enquanto
     * ninguém vinculou.
     */
    telegramChatId: text("telegram_chat_id"),

    /**
     * `owner` libera o acesso de outros devs; `dev` não.
     *
     * Existe porque a lista de quem pode entrar saiu da variável de ambiente e
     * veio para o banco: alguém precisa ser dono dela. O primeiro dev a entrar
     * vira dono, e é a única forma de virar — não há tela que promova ninguém,
     * porque uma promoção de si mesmo seria a única coisa que um convidado
     * precisaria descobrir para tomar o sistema.
     */
    role: text().notNull().default("dev"),

    /**
     * O fuso em que "9h" quer dizer nove da manhã para este dev.
     *
     * Existe por causa do agendamento, e sem ele o recurso não funciona: o
     * servidor pensa em UTC, e um post marcado para as 9h sairia às 6h no
     * Brasil. Vale só para INTERPRETAR a escolha e para EXIBIR a data — o que
     * o banco guarda continua sendo UTC.
     *
     * O padrão é São Paulo porque é onde estão os devs de hoje; um padrão
     * errado é mais fácil de perceber e corrigir do que uma coluna nula, que
     * obrigaria cada leitura a decidir o que fazer sem fuso.
     */
    timezone: text().notNull().default("America/Sao_Paulo"),

    active: boolean().notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("users_github_user_id_idx").on(t.githubUserId),
    uniqueIndex("users_github_login_idx").on(t.githubLogin),
    uniqueIndex("users_telegram_chat_idx").on(t.telegramChatId),
  ],
);

/**
 * Quem pode entrar.
 *
 * Guarda o LOGIN do GitHub, e não o id numérico, porque é o login que o dono
 * conhece na hora de convidar — ninguém sabe de cabeça o id de outra pessoa. O
 * preço é conhecido: se alguém trocar o login no GitHub, o convite deixa de
 * valer. É o preço certo, porque o contrário — convidar por id — tornaria a
 * tela inutilizável.
 *
 * Existe separada de `users` porque um convite acontece ANTES de a pessoa
 * existir: `users` exige o id numérico do GitHub, que só aparece no primeiro
 * login.
 */
export const allowedLogins = pgTable(
  "allowed_logins",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** Sempre gravado em minúsculas — o GitHub não diferencia caixa. */
    login: text().notNull(),
    invitedBy: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
  },
  (t) => [uniqueIndex("allowed_logins_login_idx").on(t.login)],
);

/**
 * E-mails de autor no git.
 *
 * Único globalmente, não por usuário: um e-mail de autor identifica uma
 * pessoa, e o mesmo e-mail em dois usuários faria o mesmo commit ser coletado
 * duas vezes e virar post duas vezes.
 */
export const userEmails = pgTable(
  "user_emails",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Sempre gravado em minúsculas. */
    email: text().notNull(),
    /** `github` = lido da conta; `manual` = digitado pelo dev. */
    source: text().notNull().default("manual"),

    createdAt,
  },
  (t) => [
    uniqueIndex("user_emails_email_idx").on(t.email),
    index("user_emails_user_idx").on(t.userId),
  ],
);

/**
 * Termos que o filtro de confidencialidade remove: empresas, clientes,
 * produtos internos e os nomes reais dos repositórios.
 *
 * Esta tabela é o dado mais sensível do sistema — ela nomeia exatamente aquilo
 * que não pode vazar. `source = 'auto'` são sugestões que o sistema montou a
 * partir dos repositórios que a instalação do GitHub App expõe.
 */
export const deniedTerms = pgTable(
  "denied_terms",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    term: text().notNull(),
    source: text().notNull().default("manual"),

    createdAt,
  },
  (t) => [
    uniqueIndex("denied_terms_user_term_idx").on(t.userId, t.term),
    index("denied_terms_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Sessão e vínculos
// ---------------------------------------------------------------------------

/**
 * Sessão do painel. Em tabela, e não em cookie assinado sem estado, para que
 * dê para revogar o acesso de alguém sem trocar o segredo de todo mundo.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Só o hash. O valor em claro existe apenas dentro do cookie do dev. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/**
 * Códigos de uso único para vincular canais externos.
 *
 * Hoje só o Telegram: a tela de introdução monta um link
 * `t.me/commitpost_bot?start=<code>`, o dev clica, e o webhook recebe o código
 * junto do `chat_id`. Ninguém copia número nenhum.
 */
export const linkCodes = pgTable(
  "link_codes",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    code: text().notNull(),
    purpose: text().notNull().default("telegram"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [uniqueIndex("link_codes_code_idx").on(t.code)],
);

/**
 * Tokens de OAuth de terceiros. Hoje só LinkedIn.
 *
 * A coluna se chama `access_token_encrypted` de propósito: o nome é a única
 * barreira barata contra alguém gravar o token em claro por distração. Guardar
 * em claro a credencial que publica no perfil de OUTRA pessoa não é aceitável.
 *
 * `expiresAt` não é enfeite — o token de membro do LinkedIn dura cerca de 60
 * dias e refresh de longa duração não é concedido a todo app. É daqui que sai
 * o aviso de reautenticação.
 */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    provider: text().notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scope: text(),

    /** URN do autor no LinkedIn, obtido em /v2/userinfo. Exigido para publicar. */
    subject: text(),

    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex("oauth_tokens_user_provider_idx").on(t.userId, t.provider)],
);

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

/**
 * Instalação do GitHub App. Um dev pode ter mais de uma — conta pessoal e uma
 * ou mais organizações.
 *
 * Note que não há token aqui: tokens de instalação são gerados na hora a
 * partir da chave privada do app e expiram em uma hora. O sistema nunca
 * armazena credencial de acesso ao código de ninguém.
 *
 * A unicidade é por (user_id, installation_id), não por installation_id: dois
 * devs da mesma organização enxergam a MESMA instalação, e cada um precisa da
 * própria linha. Fosse única só pelo id da instalação, o segundo login
 * roubaria a instalação do primeiro e ele pararia de coletar sem aviso. Os
 * commits são separados por e-mail de autor, então compartilhar a instalação
 * não mistura o trabalho de ninguém.
 */
export const githubInstallations = pgTable(
  "github_installations",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull().default("User"),

    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("github_installations_user_installation_idx").on(t.userId, t.installationId),
    index("github_installations_installation_idx").on(t.installationId),
    index("github_installations_user_idx").on(t.userId),
  ],
);

/**
 * Repositório, por alias.
 *
 * `externalId` é o id numérico do GitHub e é o que permite reencontrar o repo
 * na API sem guardar o nome. O `alias` é o que aparece em qualquer lugar que
 * uma pessoa vá ler — inclusive na mensagem de procedência do Telegram.
 */
export const repos = pgTable(
  "repos",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").references(() => githubInstallations.id, {
      onDelete: "set null",
    }),

    externalId: bigint("external_id", { mode: "number" }).notNull(),
    alias: text().notNull(),
    private: boolean().notNull().default(true),

    /**
     * Desmarcado pelo dev para tirar o repositório da coleta.
     *
     * É o único controle que existe para os repositórios de colaboração: a
     * concessão OAuth é tudo-ou-nada e alcança todos de uma vez. Sem esta
     * coluna, "não quero que este vire post" não teria resposta.
     *
     * Novo repositório entra ativo. O contrário — precisar marcar cada um —
     * faria o sistema parecer quebrado para quem acabou de configurar.
     */
    active: boolean().notNull().default(true),

    createdAt,
  },
  (t) => [
    uniqueIndex("repos_user_external_idx").on(t.userId, t.externalId),
    index("repos_user_idx").on(t.userId),
  ],
);

/**
 * Commit coletado.
 *
 * Existe para deduplicar e para mostrar procedência na aprovação — não para
 * guardar conteúdo. Repare na ausência de `message`: ela é lida da API,
 * atravessa o filtro e some na mesma execução.
 *
 * O índice único em (user_id, sha) é o que torna a execução idempotente: rodar
 * o workflow duas vezes na mesma janela não gera lote duplicado.
 */
export const commits = pgTable(
  "commits",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),

    sha: text().notNull(),
    authoredAt: timestamp("authored_at", { withTimezone: true }).notNull(),

    /** Só extensões, sem caminho: ["ts", "sql"]. */
    fileExtensions: text("file_extensions").array().notNull().default([]),
    fileCount: integer("file_count").notNull().default(0),

    /** Null enquanto não entrou em nenhum lote. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex("commits_user_sha_idx").on(t.userId, t.sha),
    index("commits_user_processed_idx").on(t.userId, t.processedAt),
  ],
);

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/**
 * `scheduled` é um estado terminal da DECISÃO e inicial da publicação: o dev
 * já disse sim, só disse para depois. Por isso é diferente de `approved`, que
 * significa "sai agora" — e a diferença importa, porque é `scheduled` que o
 * workflow de hora em hora procura. Fossem o mesmo estado, republicaria o que
 * já saiu ou publicaria antes da hora.
 */
export const postStatus = pgEnum("post_status", [
  "pending",
  "approved",
  "rejected",
  "published",
  "superseded",
  "scheduled",
]);

/**
 * Uma execução do pipeline para um dev, numa janela de tempo.
 *
 * `facts` guarda os TechnicalFact que foram enviados ao LLM. São seguros por
 * construção — só contêm rótulos de vocabulário fechado — e é o que permite
 * entender depois por que um post saiu como saiu.
 */
export const postBatches = pgTable(
  "post_batches",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),

    facts: jsonb().notNull().default([]),
    commitCount: integer("commit_count").notNull().default(0),

    createdAt,
  },
  (t) => [index("post_batches_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Um post candidato. De 2 a 3 por lote, conforme a regra de negócio.
 *
 * `body` é o texto do LLM depois da barreira 2. `editedBody` é o que o dev
 * escreveu no painel; quando existe, é ele que vai ao ar.
 */
export const postCandidates = pgTable(
  "post_candidates",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => postBatches.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    variantIndex: integer("variant_index").notNull(),
    body: text().notNull(),
    editedBody: text("edited_body"),

    /**
     * Qual ASSUNTO do lote este candidato trata.
     *
     * É o que separa "três posts sobre três trabalhos" de "três redações do
     * mesmo trabalho". Aprovar encerra as irmãs de **grupo**, não as do lote:
     * dentro de um grupo os textos contam a mesma história e só um pode sair;
     * entre grupos são conteúdos distintos e todos podem.
     *
     * Sem esta coluna as duas situações seriam indistinguíveis, e o sistema
     * teria que escolher entre nunca deixar publicar mais de um (o que o dev
     * não quer) ou deixar publicar três versões da mesma coisa (que é pior).
     */
    themeGroup: integer("theme_group").notNull().default(0),

    /** Rótulo curto do assunto, para o dev escolher sem reler os três textos. */
    theme: text(),

    /**
     * Em que esta versão difere das outras DO MESMO assunto.
     *
     * Não era coluna até a Fase 8 — o texto dizia "opção 1, opção 2", o que
     * bastava quando as variações eram indistinguíveis de propósito. Com
     * agrupamento, é ele que responde a pergunta que o dev passa a ter:
     * "por que estes dois são do mesmo assunto e o terceiro não?".
     */
    angle: text(),

    status: postStatus().notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    /**
     * Quando este post deve ir ao ar. Preenchido só no status `scheduled`.
     *
     * Guardado em UTC, como todo timestamp aqui. O fuso de quem escolheu vive
     * em `users.timezone` e serve para INTERPRETAR "9h" na hora de agendar e
     * para EXIBIR depois — nunca para armazenar. Guardar hora local seria
     * guardar um número que muda de significado se a pessoa viajar.
     */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),

    /**
     * A mensagem do Telegram onde este candidato foi enviado.
     *
     * Existe para que o estado da tela acompanhe o do banco. Sem ela, aprovar
     * uma variação encerrava as irmãs no banco e deixava os botões delas
     * ativos no celular — o dev clicava achando que decidia, e nada acontecia.
     * Uma tela de aprovação que mente sobre o próprio estado é o começo de
     * alguém clicar sem ler.
     */
    telegramMessageId: integer("telegram_message_id"),

    createdAt,
  },
  (t) => [
    uniqueIndex("post_candidates_batch_variant_idx").on(t.batchId, t.variantIndex),
    index("post_candidates_user_status_idx").on(t.userId, t.status),
    // O workflow de hora em hora pergunta "o que venceu?" para o sistema
    // inteiro, sem filtrar por dev — este índice é o que impede essa pergunta
    // de virar varredura da tabela toda a cada hora.
    index("post_candidates_due_idx").on(t.status, t.scheduledFor),
  ],
);

/** O que efetivamente foi ao ar. */
export const publications = pgTable(
  "publications",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => postCandidates.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    provider: text().notNull().default("linkedin"),
    /** URN devolvido pelo LinkedIn. */
    externalId: text("external_id"),
    url: text(),

    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("publications_user_idx").on(t.userId, t.publishedAt)],
);

// ---------------------------------------------------------------------------
// Observabilidade
// ---------------------------------------------------------------------------

/**
 * `userId` é opcional: erros que acontecem antes de saber de quem é a execução
 * também precisam de lugar para cair.
 */
export const logs = pgTable(
  "logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),

    phase: text().notNull(),
    level: text().notNull().default("info"),
    message: text().notNull(),
    meta: jsonb(),

    createdAt,
  },
  (t) => [index("logs_created_idx").on(t.createdAt), index("logs_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Relações
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  emails: many(userEmails),
  deniedTerms: many(deniedTerms),
  installations: many(githubInstallations),
  repos: many(repos),
  commits: many(commits),
  batches: many(postBatches),
  candidates: many(postCandidates),
}));

export const postBatchesRelations = relations(postBatches, ({ one, many }) => ({
  user: one(users, { fields: [postBatches.userId], references: [users.id] }),
  candidates: many(postCandidates),
}));

export const postCandidatesRelations = relations(postCandidates, ({ one }) => ({
  batch: one(postBatches, { fields: [postCandidates.batchId], references: [postBatches.id] }),
  user: one(users, { fields: [postCandidates.userId], references: [users.id] }),
}));

export const commitsRelations = relations(commits, ({ one }) => ({
  user: one(users, { fields: [commits.userId], references: [users.id] }),
  repo: one(repos, { fields: [commits.repoId], references: [repos.id] }),
}));
