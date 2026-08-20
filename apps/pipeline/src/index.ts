/**
 * Entrypoint do pipeline.
 *
 * Roda no runner do GitHub Actions (`.github/workflows/scan.yml`), não numa
 * API route da Vercel. Isso elimina o limite de duração de função serverless
 * — o pipeline soma latência de GitHub + Claude + Telegram e estouraria — e
 * dispensa um endpoint HTTP público só para ser chamado por nós mesmos.
 *
 * Uma execução varre TODOS os devs ativos. Cada um é independente: quem falha
 * vira aviso e não derruba os outros, porque uma instalação suspensa de uma
 * pessoa não é motivo para a outra ficar sem post.
 *
 * Local: `npm run pipeline` na raiz.
 */

import { loadPipelineEnv } from "@commitpost/core/env";
import { closeDatabase, createDatabase, users } from "@commitpost/core/db";
import { extractTechnicalFacts } from "@commitpost/core/redact";
import { eq } from "drizzle-orm";
import { coletarDoDev } from "./coleta";

function log(mensagem: string): void {
  console.log(`[commitpost] ${mensagem}`);
}

async function main(): Promise<void> {
  // Falha aqui, no primeiro instante, se faltar qualquer secret — em vez de
  // estourar `undefined` no meio de uma chamada de API.
  const env = loadPipelineEnv();

  const until = new Date();
  const since = new Date(until.getTime() - env.GITHUB_LOOKBACK_DAYS * 86_400_000);

  log(`janela: ${since.toISOString()} → ${until.toISOString()}`);

  const db = createDatabase(env.DATABASE_URL);

  try {
    const devs = await db
      .select({ id: users.id, login: users.githubLogin })
      .from(users)
      .where(eq(users.active, true));

    if (devs.length === 0) {
      log("nenhum dev cadastrado — ninguém passou pela tela de introdução ainda");
      return;
    }

    log(`${String(devs.length)} dev(s) ativo(s)`);

    for (const dev of devs) {
      try {
        await processarDev(db, env, dev, since, until);
      } catch (error) {
        // O erro de um não pode custar o ciclo dos outros.
        log(`${dev.login}: falhou — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await closeDatabase(db);
  }
}

async function processarDev(
  db: ReturnType<typeof createDatabase>,
  env: ReturnType<typeof loadPipelineEnv>,
  dev: { id: number; login: string },
  since: Date,
  until: Date,
): Promise<void> {
  const coleta = await coletarDoDev({
    db,
    userId: dev.id,
    since,
    until,
    appId: env.GITHUB_APP_ID,
    appPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    extraDeniedTerms: env.REDACT_DENIED_TERMS,
  });

  for (const aviso of coleta.avisos) log(`${dev.login}: ${aviso}`);

  log(
    `${dev.login}: ${String(coleta.reposVarridos)} repo(s), ` +
      `${String(coleta.novos.length)} commit(s) novo(s), ` +
      `${String(coleta.repetidos)} já conhecido(s)`,
  );

  if (coleta.novos.length === 0) return;

  // A barreira 1. Daqui em diante a mensagem do commit não existe mais: o que
  // segue é vocabulário fechado, e `coleta.novos` sai de escopo com ela.
  const fatos = extractTechnicalFacts(coleta.novos, { deniedTerms: coleta.termosProibidos });

  log(`${dev.login}: ${String(fatos.length)} fato(s) técnico(s) publicáveis`);
  for (const fato of fatos) {
    log(
      `${dev.login}:   ${fato.changeKind} · ${fato.technologies.join(", ") || "sem tecnologia"}` +
        `${fato.problemClass === null ? "" : ` · ${fato.problemClass}`}` +
        ` · ${String(fato.sourceShas.length)} commit(s)`,
    );
  }

  // Fase 4 — geração dos candidatos (packages/core/llm)
  // Fase 1 — persistência do lote (post_batches + post_candidates)
  // Fase 5 — envio com procedência (packages/core/telegram)
}

main().catch((error: unknown) => {
  console.error("[commitpost] pipeline falhou");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
