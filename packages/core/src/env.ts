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
  ANTHROPIC_API_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  PANEL_TOKEN_SECRET: secret,
  APP_BASE_URL: httpUrl,
});

const webSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
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
