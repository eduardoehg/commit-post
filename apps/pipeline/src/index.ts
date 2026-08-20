/**
 * Entrypoint do pipeline.
 *
 * Roda no runner do GitHub Actions (`.github/workflows/scan.yml`), não numa
 * API route da Vercel. Isso elimina o limite de duração de função serverless
 * — o pipeline soma latência de GitHub + Claude + Telegram e estouraria — e
 * dispensa um endpoint HTTP público só para ser chamado por nós mesmos.
 *
 * Local: `npm run pipeline` na raiz.
 */

import { loadPipelineEnv } from "@commitpost/core/env";

async function main(): Promise<void> {
  // Falha aqui, no primeiro instante, se faltar qualquer secret — em vez de
  // estourar `undefined` no meio de uma chamada de API.
  const env = loadPipelineEnv();

  const until = new Date();
  const since = new Date(until.getTime() - env.GITHUB_LOOKBACK_DAYS * 86_400_000);

  console.log("[commitpost] pipeline iniciado");
  console.log(`[commitpost] janela: ${since.toISOString()} → ${until.toISOString()}`);
  console.log(`[commitpost] autores: ${env.GITHUB_AUTHOR_EMAILS.join(", ")}`);

  // Fase 2 — coleta de commits (packages/core/github)
  // Fase 3 — filtro de confidencialidade (packages/core/redact)
  // Fase 4 — geração dos candidatos (packages/core/llm)
  // Fase 1 — persistência do lote (packages/core/db)
  // Fase 5 — envio com procedência (packages/core/telegram)

  console.log("[commitpost] nada a fazer ainda — fases 1-5 pendentes");
}

main().catch((error: unknown) => {
  console.error("[commitpost] pipeline falhou");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
