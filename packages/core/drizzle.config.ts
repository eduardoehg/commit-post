import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

/**
 * Lê DATABASE_URL do .env.local da raiz do monorepo quando ela não já está no
 * ambiente. Evita uma dependência só para carregar um arquivo de sete linhas,
 * e mantém os comandos `db:*` funcionando sem prefixo nenhum.
 *
 * Em CI a variável vem do ambiente e este bloco não faz nada.
 */
function databaseUrl(): string {
  const fromEnv = process.env["DATABASE_URL"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;

  try {
    const file = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
    const match = /^DATABASE_URL=(.+)$/m.exec(file);
    if (match?.[1] !== undefined) return match[1].trim();
  } catch {
    // Sem .env.local: cai no erro abaixo, que diz o que fazer.
  }

  throw new Error(
    "DATABASE_URL não encontrada. Defina no ambiente ou em .env.local na raiz do repositório.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl() },
  strict: true,
  verbose: true,
});
