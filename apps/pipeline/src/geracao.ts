/**
 * Geração e gravação do lote — Fase 4.
 *
 * O lote e seus candidatos entram numa transação só. Não é zelo: um lote sem
 * candidatos deixaria commits marcados como processados sem nada para aprovar,
 * e eles nunca mais voltariam — a coleta deduplica por sha e não os traria de
 * novo. É a razão de o driver da Neon ser o de WebSocket e não o HTTP, que não
 * suporta transação.
 */

import { and, eq, inArray } from "drizzle-orm";
import { generatePostCandidates, type GenerateResult } from "@commitpost/core/llm";
import { commits, postBatches, postCandidates, type Database } from "@commitpost/core/db";
import type { TechnicalFact } from "@commitpost/core/redact";

export interface GeracaoOptions {
  db: Database;
  userId: number;
  apiKey: string;
  facts: readonly TechnicalFact[];
  deniedTerms: readonly string[];
  windowStart: Date;
  windowEnd: Date;
  commitCount: number;
  /** Ensaio: gera os candidatos e não grava lote nenhum. */
  ensaio?: boolean;
}

export interface GeracaoResult extends GenerateResult {
  /** Null quando nada foi gravado — não houve candidato aprovado. */
  batchId: number | null;
}

export async function gerarEGravar(options: GeracaoOptions): Promise<GeracaoResult> {
  const resultado = await generatePostCandidates({
    apiKey: options.apiKey,
    facts: options.facts,
    deniedTerms: options.deniedTerms,
  });

  // Nada aprovado: não grava lote nenhum. Um lote vazio no banco só serviria
  // para alguém achar depois que houve post e ele sumiu.
  if (resultado.candidatos.length === 0) return { ...resultado, batchId: null };
  if (options.ensaio === true) return { ...resultado, batchId: null };

  const batchId = await options.db.transaction(async (tx) => {
    const [lote] = await tx
      .insert(postBatches)
      .values({
        userId: options.userId,
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        facts: options.facts,
        commitCount: options.commitCount,
      })
      .returning({ id: postBatches.id });

    if (lote === undefined) throw new Error("insert do lote não devolveu id");

    await tx.insert(postCandidates).values(
      resultado.candidatos.map((candidato, indice) => ({
        batchId: lote.id,
        userId: options.userId,
        variantIndex: indice,
        // O grupo vem do modelo e é o que decide, na aprovação, quais irmãs
        // são encerradas. Gravá-lo aqui é o que faz a decisão sobreviver ao
        // fim desta execução — o Telegram só carrega o id do candidato.
        themeGroup: candidato.grupo,
        theme: candidato.tema,
        angle: candidato.angulo,
        body: candidato.texto,
      })),
    );

    // Só os commits que viraram fato. Os que a barreira 1 descartou ficam com
    // `processed_at` nulo de propósito: é o registro de que foram coletados e
    // não renderam nada, que é diferente de "ainda não olhamos".
    const shas = [...new Set(options.facts.flatMap((f) => f.sourceShas))];
    if (shas.length > 0) {
      // O `user_id` no WHERE não é redundante: dois devs do mesmo repositório
      // podem legitimamente ter o MESMO sha, e a restrição do banco é por
      // usuário. Sem ele, marcar o lote de um marcaria o commit do outro como
      // processado — e o post dele nunca sairia.
      await tx
        .update(commits)
        .set({ processedAt: new Date() })
        .where(and(eq(commits.userId, options.userId), inArray(commits.sha, shas)));
    }

    return lote.id;
  });

  return { ...resultado, batchId };
}
