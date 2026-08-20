/**
 * Validação de ambiente.
 *
 * Duas superfícies consomem envs diferentes, então há dois schemas:
 *
 *   - `loadPipelineEnv()` → apps/pipeline, rodando no runner do GitHub Actions
 *   - `loadWebEnv()`      → apps/web, rodando na Vercel
 *
 * Os loaders são funções (não parse no topo do módulo) de propósito: o Next.js
 * avalia módulos em build time, quando os secrets de runtime não existem. Fazer
 * parse na importação quebraria o build.
 */

import { z } from "zod";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Aceita "a@x.com, b@y.com" e devolve ["a@x.com", "b@y.com"]. */
const emailList = z
  .string()
  .min(1)
  .transform((raw) => raw.split(",").map((s) => s.trim()).filter(Boolean))
  .refine((list) => list.length > 0, "precisa de ao menos um e-mail")
  .refine(
    (list) => list.every((e) => EMAIL_RE.test(e)),
    "contém um e-mail inválido",
  );

/** Aceita "7" e devolve 7, rejeitando zero, negativo e não-numérico. */
const positiveInt = z
  .string()
  .regex(/^\d+$/, "precisa ser um número inteiro")
  .transform(Number)
  .refine((n) => n > 0, "precisa ser maior que zero");

/**
 * Lista separada por vírgula. Diferente de `emailList`, aceita vazia — nem
 * todo mundo tem nomes de cliente a esconder.
 */
const termList = z
  .string()
  .transform((raw) => raw.split(",").map((s) => s.trim()).filter(Boolean));

/** Chave de 32 bytes em hexadecimal, para cifrar tokens guardados no banco. */
const encryptionKey = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'precisa ser 32 bytes em hex (64 caracteres)');

/**
 * Chave privada do GitHub App, sempre devolvida como PEM.
 *
 * Aceita três formas porque as três acontecem de verdade: o .pem colado
 * inteiro, o mesmo .pem em base64 (única forma que sobrevive a uma variável de
 * ambiente de uma linha só), e o .pem com `\n` literal, que é como um painel
 * de deploy costuma devolver o que foi colado com quebras.
 */
const pemPrivateKey = z
  .string()
  .min(1)
  .transform((raw) => {
    const unescaped = raw.includes("-----BEGIN") ? raw.replace(/\\n/g, "\n") : raw;
    if (unescaped.includes("-----BEGIN")) return unescaped;

    try {
      const decoded = Buffer.from(unescaped, "base64").toString("utf8");
      if (decoded.includes("-----BEGIN")) return decoded;
    } catch {
      // Cai no refine abaixo com a mensagem que explica o que se esperava.
    }
    return unescaped;
  })
  .refine(
    (pem) => pem.includes("-----BEGIN"),
    "precisa ser o arquivo .pem que o GitHub gerou, inteiro, ou o mesmo .pem em base64",
  );

const httpUrl = z
  .string()
  .url("precisa ser uma URL completa (com http:// ou https://)");

/** Segredos usados para assinar/validar. 32 bytes em hex = 64 chars. */
const secret = z
  .string()
  .min(32, "muito curto — gere com `openssl rand -hex 32`");

const pipelineSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_AUTHOR_EMAILS: emailList,
  GITHUB_LOOKBACK_DAYS: positiveInt.default("7"),
  /**
   * Nomes de empresas, clientes, produtos internos e os NOMES REAIS dos
   * repositórios — alimenta a denylist do filtro de confidencialidade.
   *
   * Esta lista é ela própria confidencial: ela nomeia exatamente o que não
   * pode vazar. Vive em GitHub Secrets e .env.local, nunca no repositório.
   */
  REDACT_DENIED_TERMS: termList.default(""),

  TOKEN_ENCRYPTION_KEY: encryptionKey,
  ANTHROPIC_API_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  PANEL_TOKEN_SECRET: secret,
  APP_BASE_URL: httpUrl,
});

const webSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  /**
   * Chat do operador, para avisos de sistema.
   *
   * Opcional aqui, e isso é uma mudança em relação à Fase 0: com vários devs,
   * quem pode aprovar um post não é mais "o chat que está nesta variável", e
   * sim qualquer chat vinculado a um usuário ativo em `users.telegram_chat_id`.
   * A allowlist mora no banco porque é ela que cresce a cada dev novo.
   */
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),

  TOKEN_ENCRYPTION_KEY: encryptionKey,

  /**
   * GitHub App — o caminho principal. Serve de login e dá acesso de leitura
   * aos repositórios das contas onde o dev instalar.
   *
   * Não existe token de dev aqui: os de instalação são gerados na hora a
   * partir da chave privada e expiram em uma hora.
   */
  GITHUB_APP_ID: z.string().regex(/^\d+$/, "é o App ID numérico, não o Client ID"),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: pemPrivateKey,

  /**
   * OAuth App clássico, separado do GitHub App.
   *
   * Existe só para alcançar repositórios onde o dev é apenas colaborador:
   * a instalação de um GitHub App só enxerga repos da conta onde foi
   * instalada, e o token de usuário dele continua preso às instalações.
   *
   * Opcional porque a concessão é opcional — quem não tem colaborações
   * fora das próprias contas não precisa conceder escopo `repo`. Faltando,
   * o passo aparece desabilitado na tela de introdução em vez de sumir.
   */
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),

  /**
   * Logins do GitHub autorizados a entrar, separados por vírgula.
   *
   * Sem isto, "entrar com GitHub" deixaria qualquer pessoa do mundo criar
   * conta e passar a consumir a chave da Anthropic do operador.
   *
   * Não tem valor padrão de propósito: esquecer a variável levanta erro no
   * boot, em vez de trancar todo mundo para fora com uma mensagem confusa.
   * Uma lista deliberadamente vazia é válida — basta declarar vazia.
   */
  ALLOWED_GITHUB_LOGINS: termList,

  TELEGRAM_WEBHOOK_SECRET: secret,
  PANEL_TOKEN_SECRET: secret,
  APP_BASE_URL: httpUrl,
  // LinkedIn entra na Fase 7; opcional até lá para não travar o app web.
  LINKEDIN_CLIENT_ID: z.string().min(1).optional(),
  LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),
  LINKEDIN_REDIRECT_URI: httpUrl.optional(),
});

export type PipelineEnv = z.infer<typeof pipelineSchema>;
export type WebEnv = z.infer<typeof webSchema>;

/** Erro com todas as variáveis problemáticas de uma vez, não só a primeira. */
export class EnvValidationError extends Error {
  constructor(surface: string, issues: readonly z.ZodIssue[]) {
    const lines = issues.map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`);
    super(
      `Ambiente inválido para "${surface}":\n${lines.join("\n")}\n\n` +
        `Confira o .env.example na raiz do repositório.`,
    );
    this.name = "EnvValidationError";
  }
}

function parse<T extends z.ZodTypeAny>(
  schema: T,
  surface: string,
  source: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) throw new EnvValidationError(surface, result.error.issues);
  return result.data;
}

/** Envs exigidas pelo pipeline (GitHub Actions). Lança se faltar alguma. */
export function loadPipelineEnv(
  source: Record<string, string | undefined> = process.env,
): PipelineEnv {
  return parse(pipelineSchema, "pipeline", source);
}

/** Envs exigidas pelo app web (Vercel). Lança se faltar alguma. */
export function loadWebEnv(
  source: Record<string, string | undefined> = process.env,
): WebEnv {
  return parse(webSchema, "web", source);
}
