/**
 * A decisão humana — Fase 5.
 *
 * É a terceira barreira, e a única que não é código. Tudo aqui existe para que
 * ela seja registrada exatamente uma vez e para que ninguém decida no lugar de
 * outra pessoa.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "./client";
import { postCandidates } from "./schema";

export type Decisao = "approve" | "reject";

export type ResultadoDecisao =
  | { tipo: "aplicada"; decisao: Decisao; superseded: number }
  | { tipo: "ja-decidida"; statusAtual: string }
  | { tipo: "nao-encontrada" };

/**
 * Aplica a decisão, se o candidato for mesmo de quem clicou.
 *
 * O `user_id` no WHERE é a trava que importa: o `callback_data` do botão
 * carrega só o id do candidato, e um id é adivinhável. Sem esta condição,
 * qualquer chat vinculado poderia aprovar o post de outro dev — e o post sairia
 * no perfil de quem nunca o viu.
 *
 * "Não é seu" e "não existe" devolvem a MESMA coisa, de propósito: distinguir
 * os dois transformaria o botão num oráculo de quais ids existem.
 */
export async function decideCandidate(
  db: Database,
  userId: number,
  candidateId: number,
  decisao: Decisao,
): Promise<ResultadoDecisao> {
  const linhas = await db
    .select({ id: postCandidates.id, batchId: postCandidates.batchId, status: postCandidates.status })
    .from(postCandidates)
    .where(and(eq(postCandidates.id, candidateId), eq(postCandidates.userId, userId)))
    .limit(1);

  const candidato = linhas[0];
  if (candidato === undefined) return { tipo: "nao-encontrada" };
  if (candidato.status !== "pending") return { tipo: "ja-decidida", statusAtual: candidato.status };

  return db.transaction(async (tx) => {
    // O `status = pending` no WHERE fecha a corrida entre dois cliques rápidos:
    // o segundo não encontra linha para atualizar e não desfaz o primeiro.
    const atualizados = await tx
      .update(postCandidates)
      .set({
        status: decisao === "approve" ? "approved" : "rejected",
        decidedAt: new Date(),
      })
      .where(and(eq(postCandidates.id, candidateId), eq(postCandidates.status, "pending")))
      .returning({ id: postCandidates.id });

    if (atualizados.length === 0) return { tipo: "ja-decidida", statusAtual: "pending" };

    // Aprovar um candidato encerra os irmãos: as 2 ou 3 variações são do mesmo
    // trabalho, e publicar duas seria contar a mesma história duas vezes. Já
    // recusar um não diz nada sobre os outros — eles seguem esperando.
    if (decisao === "reject") return { tipo: "aplicada", decisao, superseded: 0 };

    // O aprovado não precisa ser excluído por id: ele acabou de sair de
    // `pending` na instrução acima, e é o `status` que o exclui daqui. Um
    // `ne(id)` a mais parecia zelo e não era — teste de mutação mostrou que
    // removê-lo não quebrava nada, porque nunca chegava a fazer trabalho.
    const encerrados = await tx
      .update(postCandidates)
      .set({ status: "superseded", decidedAt: new Date() })
      .where(
        and(
          eq(postCandidates.batchId, candidato.batchId),
          eq(postCandidates.status, "pending"),
        ),
      )
      .returning({ id: postCandidates.id });

    return { tipo: "aplicada", decisao, superseded: encerrados.length };
  });
}
