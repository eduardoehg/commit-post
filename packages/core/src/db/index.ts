/**
 * Banco de dados (Neon + Drizzle) — Fase 1.
 *
 * Decisões de modelagem já fechadas:
 *   - `post_status` é COLUNA enum em post_candidates, não tabela. Histórico de
 *     transições, se necessário, vai numa `post_events` append-only.
 *   - `commits.sha` tem UNIQUE desde já: é pré-requisito de idempotência para
 *     re-runs do GitHub Actions, não refinamento de Fase 10.
 *   - Repositórios são gravados por alias, nunca pelo nome real.
 *   - O token do LinkedIn mora aqui com `expires_at` (expira em ~60 dias),
 *     nunca em env var.
 *
 * ORM: Drizzle. Escolhido sobre Prisma por não exigir engine binário, o que
 * importa no runner do Actions e em qualquer runtime serverless.
 */

export type PostStatus = "pending" | "approved" | "rejected" | "published";

export const TABLES = [
  "repos",
  "commits",
  "post_batches",
  "post_candidates",
  "publications",
  "oauth_tokens",
  "logs",
] as const;

export type TableName = (typeof TABLES)[number];
