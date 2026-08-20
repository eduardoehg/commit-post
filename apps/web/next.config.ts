import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * Carrega o `.env.local` da RAIZ do monorepo.
 *
 * O Next procura o arquivo ao lado do próprio app, e as variáveis deste
 * projeto vivem numa raiz só — pipeline e web compartilham quase todas, e
 * manter duas cópias é garantia de que uma delas fica velha.
 *
 * Sem dependência nova, pelo mesmo motivo do `drizzle.config.ts`: é um arquivo
 * de poucas linhas, e o que já está no ambiente sempre ganha, para a Vercel
 * (onde este arquivo não existe) seguir mandando.
 */
function loadRootEnv(): void {
  let file: string;
  try {
    file = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  } catch {
    return; // Em produção não existe, e é assim que tem que ser.
  }

  for (const linha of file.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(linha.trim());
    if (match === null) continue;

    const [, chave, bruto] = match;
    if (chave === undefined || bruto === undefined) continue;
    if (process.env[chave] !== undefined) continue;

    process.env[chave] = bruto.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  // packages/core é consumido como TypeScript direto, sem passo de build.
  transpilePackages: ["@commitpost/core"],
};

export default nextConfig;
