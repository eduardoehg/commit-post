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
import { gerarEGravar } from "./geracao";
import { enviarParaAprovacao } from "./envio";
import { avisarExpiracao } from "./avisos";

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

  // `npm run pipeline -- --ensaio` mostra o que sairia sem gravar nada. É o
  // único jeito de reler commits que o índice único já considera conhecidos,
  // sem apagar linha do banco de ninguém.
  const ensaio = process.argv.includes("--ensaio");
  if (ensaio) log("ENSAIO: nada será gravado");

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
        await processarDev(db, env, dev, since, until, ensaio);
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
  ensaio: boolean,
): Promise<void> {
  // Antes da coleta: um acesso vencendo é notícia mesmo que a semana não
  // tenha rendido commit nenhum, e no ensaio nada é gravado nem enviado.
  if (!ensaio) {
    const aviso = await avisarExpiracao(db, dev.id, env.TELEGRAM_BOT_TOKEN);
    if (aviso === "enviado") log(`${dev.login}: aviso de expiração enviado no Telegram`);
  }

  const coleta = await coletarDoDev({
    db,
    userId: dev.id,
    since,
    until,
    appId: env.GITHUB_APP_ID,
    appPrivateKey: env.GITHUB_APP_PRIVATE_KEY,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    extraDeniedTerms: env.REDACT_DENIED_TERMS,
    oauthClientId: env.GITHUB_OAUTH_CLIENT_ID,
    oauthClientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
    ensaio,
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
  if (fatos.length === 0) return;

  const lote = await gerarEGravar({
    db,
    userId: dev.id,
    apiKey: env.ANTHROPIC_API_KEY,
    facts: fatos,
    deniedTerms: coleta.termosProibidos,
    windowStart: since,
    windowEnd: until,
    commitCount: coleta.novos.length,
    ensaio,
  });

  for (const descartado of lote.descartados) {
    // Isto não é ruído de log. Descarte na barreira 2 significa que algo
    // passou pela barreira 1 ou que o modelo inventou — precisa doer o
    // suficiente para alguém investigar.
    log(
      `${dev.login}: ATENÇÃO — candidato "${descartado.angulo}" descartado ` +
        `(${descartado.removidos.join(", ")})`,
    );
  }

  if (lote.candidatos.length === 0) {
    log(`${dev.login}: nenhum candidato aprovado — ${lote.motivo ?? "sem motivo informado"}`);
    return;
  }

  const origem = lote.batchId === null ? "ensaio" : `lote ${String(lote.batchId)}`;
  log(`${dev.login}: ${origem} com ${String(lote.candidatos.length)} candidato(s)`);
  if (lote.motivo !== null) log(`${dev.login}: ${lote.motivo}`);

  for (const candidato of lote.candidatos) {
    log(`${dev.login}: ── ${candidato.angulo} ──`);
    for (const linha of candidato.texto.split("\n")) log(`${dev.login}: ${linha}`);
  }

  if (lote.batchId === null) return;

  const envio = await enviarParaAprovacao({
    db,
    userId: dev.id,
    botToken: env.TELEGRAM_BOT_TOKEN,
    batchId: lote.batchId,
    facts: fatos,
    commitCount: coleta.novos.length,
    windowStart: since,
    windowEnd: until,
  });

  if (envio.tipo === "sem-telegram") {
    // O lote fica pendente no banco de propósito: o dev vincula o Telegram e
    // recebe na execução seguinte, em vez de perder o trabalho da semana.
    log(`${dev.login}: sem Telegram vinculado — lote guardado para depois`);
    return;
  }

  if (envio.tipo === "enviado") {
    log(`${dev.login}: ${String(envio.quantidade)} post(s) no Telegram, esperando decisão`);
  }
}

main().catch((error: unknown) => {
  console.error("[commitpost] pipeline falhou");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
