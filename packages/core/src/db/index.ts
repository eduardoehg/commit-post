/**
 * Banco de dados — Fase 1.
 *
 * Decisões de modelagem, com o porquê em `schema.ts`:
 *   - Nenhuma mensagem de commit é persistida. `commits` serve para
 *     deduplicar e mostrar procedência, não para guardar conteúdo.
 *   - Nenhum nome real de repositório é persistido; só o id numérico do
 *     GitHub e um alias nosso.
 *   - `post_status` é coluna enum, não tabela.
 *   - UNIQUE(user_id, sha) em `commits` é o que torna a execução idempotente.
 *   - O token do LinkedIn mora aqui com `expires_at` e o nome da coluna exige
 *     que ele esteja cifrado.
 *
 * ORM: Drizzle, escolhido sobre Prisma por não exigir engine binário — o que
 * importa no runner do Actions e em qualquer runtime serverless.
 */

export * from "./schema";
export { createDatabase, closeDatabase, type Database } from "./client";
export * from "./repos";
