/**
 * Envio para aprovação — Fase 5.
 *
 * O último passo do ciclo, e o único que entrega o controle a uma pessoa. Tudo
 * que veio antes foi para chegar aqui com um texto que dá para aprovar sem
 * medo — e com procedência suficiente para o "sem medo" ser justificado, e não
 * uma esperança.
 */

import { and, eq, inArray } from "drizzle-orm";
import { sendCandidates, type CandidatoParaEnvio } from "@commitpost/core/telegram";
import {
  commits,
  postCandidates,
  recordTelegramMessage,
  repos,
  users,
  type Database,
} from "@commitpost/core/db";
import type { TechnicalFact } from "@commitpost/core/redact";

export interface EnvioOptions {
  db: Database;
  userId: number;
  botToken: string;
  batchId: number;
  facts: readonly TechnicalFact[];
  commitCount: number;
  windowStart: Date;
  windowEnd: Date;
}

export type EnvioResult =
  | { tipo: "enviado"; quantidade: number }
  | { tipo: "sem-telegram" }
  | { tipo: "nada-a-enviar" };

export async function enviarParaAprovacao(options: EnvioOptions): Promise<EnvioResult> {
  const { db, userId } = options;

  const donos = await db
    .select({ chatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const chatId = donos[0]?.chatId;
  if (chatId === null || chatId === undefined) return { tipo: "sem-telegram" };

  // Relidos do banco porque é o id da linha que vai no botão. Gerar o botão a
  // partir do que está em memória arriscaria mandar um id que não existe.
  const candidatos = await db
    .select({
      id: postCandidates.id,
      body: postCandidates.body,
      themeGroup: postCandidates.themeGroup,
      theme: postCandidates.theme,
      angle: postCandidates.angle,
    })
    .from(postCandidates)
    .where(and(eq(postCandidates.batchId, options.batchId), eq(postCandidates.status, "pending")))
    .orderBy(postCandidates.variantIndex);

  if (candidatos.length === 0) return { tipo: "nada-a-enviar" };

  const paraEnvio: CandidatoParaEnvio[] = candidatos.map((c, i) => ({
    id: c.id,
    grupo: c.themeGroup,
    // Os padrões cobrem os lotes gravados antes destas colunas existirem. Sem
    // eles a mensagem sairia com "null" no lugar do assunto, que é pior do que
    // um rótulo genérico — parece defeito e o dev não sabe se pode confiar.
    tema: c.theme ?? `assunto ${String(c.themeGroup + 1)}`,
    angulo: c.angle ?? `opção ${String(i + 1)}`,
    texto: c.body,
  }));

  const shas = [...new Set(options.facts.flatMap((f) => f.sourceShas))];

  const enviados = await sendCandidates({
    token: options.botToken,
    chatId,
    candidatos: paraEnvio,
    procedencia: {
      aliases: await aliasesDosCommits(db, userId, shas),
      commitCount: options.commitCount,
      shas,
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
    },
  });

  // Guardado DEPOIS do envio, um a um, porque é o Telegram que atribui o id da
  // mensagem. Se o envio falhar no meio, os que já foram ficam registrados e
  // continuam editáveis; os que não foram ficam sem id e são ignorados na hora
  // de apagar botões, em vez de gerar edição contra mensagem inexistente.
  for (const { candidateId, messageId } of enviados) {
    await recordTelegramMessage(db, candidateId, messageId);
  }

  return { tipo: "enviado", quantidade: enviados.length };
}

/**
 * Os repositórios que ORIGINARAM estes posts, não todos os do dev.
 *
 * A diferença é a procedência valer alguma coisa. "De 69 commits em: repo-1 …
 * repo-25" não diz nada — é a lista inteira, sempre igual, e vira decoração
 * que o olho pula. O que ajuda a decidir é saber que aquele texto veio de dois
 * repositórios específicos.
 *
 * Só aliases: o nome real não existe no banco para ser lido.
 */
async function aliasesDosCommits(
  db: Database,
  userId: number,
  shas: readonly string[],
): Promise<string[]> {
  if (shas.length === 0) return [];

  const linhas = await db
    .selectDistinct({ alias: repos.alias })
    .from(commits)
    .innerJoin(repos, eq(repos.id, commits.repoId))
    .where(and(eq(commits.userId, userId), inArray(commits.sha, [...shas])));

  return linhas.map((l) => l.alias).sort();
}
