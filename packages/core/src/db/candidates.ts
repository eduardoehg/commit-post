/**
 * A decisão humana — Fase 5.
 *
 * É a terceira barreira, e a única que não é código. Tudo aqui existe para que
 * ela seja registrada exatamente uma vez e para que ninguém decida no lugar de
 * outra pessoa.
 */

import { and, asc, eq, lte } from "drizzle-orm";
import type { Database } from "./client";
import { postCandidates } from "./schema";

export type Decisao = "approve" | "reject" | "schedule";

export type ResultadoDecisao =
  | {
      tipo: "aplicada";
      decisao: Decisao;
      /**
       * As mensagens do Telegram das irmãs encerradas. Quem chama usa para
       * apagar os botões delas — o estado da tela precisa acompanhar o do
       * banco, senão o dev clica em algo que já não existe.
       */
      encerradas: number[];
      /** Quando vai ao ar. Só existe na decisão de agendar. */
      agendadoPara: Date | null;
    }
  | { tipo: "ja-decidida"; statusAtual: string }
  | { tipo: "nao-encontrada" }
  | { tipo: "sem-horario" };

/** O status que cada decisão grava. */
const STATUS_DA_DECISAO = {
  approve: "approved",
  reject: "rejected",
  schedule: "scheduled",
} as const;

/**
 * Decidir a favor encerra as irmãs; recusar não diz nada sobre as outras.
 *
 * Agendar conta como decidir a favor: o dev já disse sim, só disse para depois.
 * Fosse diferente, as versões irmãs continuariam pendentes e ele poderia
 * aprovar duas do mesmo assunto sem nada avisando.
 */
function encerraAsIrmas(decisao: Decisao): boolean {
  return decisao !== "reject";
}

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
  quando?: Date,
): Promise<ResultadoDecisao> {
  // Agendar sem horário viraria um candidato em `scheduled` com
  // `scheduled_for` nulo — invisível para o workflow, que procura o que já
  // venceu. O post ficaria esperando para sempre e ninguém saberia por quê.
  if (decisao === "schedule" && (quando === undefined || Number.isNaN(quando.getTime()))) {
    return { tipo: "sem-horario" };
  }

  const linhas = await db
    .select({
      id: postCandidates.id,
      batchId: postCandidates.batchId,
      themeGroup: postCandidates.themeGroup,
      status: postCandidates.status,
    })
    .from(postCandidates)
    .where(and(eq(postCandidates.id, candidateId), eq(postCandidates.userId, userId)))
    .limit(1);

  const candidato = linhas[0];
  if (candidato === undefined) return { tipo: "nao-encontrada" };
  if (candidato.status !== "pending") return { tipo: "ja-decidida", statusAtual: candidato.status };

  const agendadoPara = decisao === "schedule" ? (quando ?? null) : null;

  return db.transaction(async (tx) => {
    // O `status = pending` no WHERE fecha a corrida entre dois cliques rápidos:
    // o segundo não encontra linha para atualizar e não desfaz o primeiro.
    const atualizados = await tx
      .update(postCandidates)
      .set({
        status: STATUS_DA_DECISAO[decisao],
        decidedAt: new Date(),
        scheduledFor: agendadoPara,
      })
      .where(and(eq(postCandidates.id, candidateId), eq(postCandidates.status, "pending")))
      .returning({ id: postCandidates.id });

    if (atualizados.length === 0) return { tipo: "ja-decidida", statusAtual: "pending" };

    // Recusar não diz nada sobre os outros — eles seguem esperando.
    if (!encerraAsIrmas(decisao)) {
      return { tipo: "aplicada", decisao, encerradas: [], agendadoPara };
    }

    // Encerra as irmãs DO MESMO ASSUNTO, e não as do lote inteiro.
    //
    // Esta é a linha que o agrupamento existe para mudar. Textos do mesmo
    // grupo contam a mesma história e só um pode sair; textos de grupos
    // diferentes são trabalhos diferentes e podem sair todos, em dias
    // diferentes. Sem o `theme_group` aqui, aprovar o post sobre a lentidão
    // mataria em silêncio o post sobre a migração.
    //
    // O decidido não precisa ser excluído por id: ele acabou de sair de
    // `pending` na instrução acima, e é o `status` que o exclui daqui. Um
    // `ne(id)` a mais parecia zelo e não era — teste de mutação mostrou que
    // removê-lo não quebrava nada, porque nunca chegava a fazer trabalho.
    const encerrados = await tx
      .update(postCandidates)
      .set({ status: "superseded", decidedAt: new Date() })
      .where(
        and(
          eq(postCandidates.batchId, candidato.batchId),
          eq(postCandidates.themeGroup, candidato.themeGroup),
          eq(postCandidates.status, "pending"),
        ),
      )
      .returning({ messageId: postCandidates.telegramMessageId });

    return {
      tipo: "aplicada",
      decisao,
      // Candidato sem `telegram_message_id` é de um lote gravado antes desta
      // coluna existir, ou que falhou no envio. Fica de fora em vez de virar
      // uma edição contra uma mensagem que não existe.
      encerradas: encerrados.map((e) => e.messageId).filter((id) => id !== null),
      agendadoPara,
    };
  });
}

/**
 * Os posts agendados cuja hora chegou.
 *
 * Pergunta do sistema inteiro, sem filtrar por dev: quem publica é um workflow
 * de hora em hora, não uma sessão de alguém. O `limite` existe para uma fila
 * represada — depois de o LinkedIn ficar fora do ar por um dia, por exemplo —
 * não virar uma execução que tenta publicar cinquenta posts de uma vez.
 */
export async function candidatosVencidos(
  db: Database,
  agora: Date = new Date(),
  limite = 20,
): Promise<{ id: number; userId: number; scheduledFor: Date | null }[]> {
  return db
    .select({
      id: postCandidates.id,
      userId: postCandidates.userId,
      scheduledFor: postCandidates.scheduledFor,
    })
    .from(postCandidates)
    .where(and(eq(postCandidates.status, "scheduled"), lte(postCandidates.scheduledFor, agora)))
    // Do mais atrasado para o mais recente: numa fila represada, o que já
    // devia ter saído tem prioridade sobre o que acabou de vencer.
    .orderBy(asc(postCandidates.scheduledFor))
    .limit(limite);
}

/** Desmarca um agendamento e devolve o post para a fila de decisão. */
export async function desagendarCandidato(
  db: Database,
  userId: number,
  candidateId: number,
): Promise<boolean> {
  const linhas = await db
    .update(postCandidates)
    .set({ status: "approved", scheduledFor: null })
    .where(
      and(
        eq(postCandidates.id, candidateId),
        eq(postCandidates.userId, userId),
        eq(postCandidates.status, "scheduled"),
      ),
    )
    .returning({ id: postCandidates.id });

  return linhas.length > 0;
}

/** Guarda onde cada candidato foi parar no Telegram, para poder editá-lo depois. */
export async function recordTelegramMessage(
  db: Database,
  candidateId: number,
  messageId: number,
): Promise<void> {
  await db
    .update(postCandidates)
    .set({ telegramMessageId: messageId })
    .where(eq(postCandidates.id, candidateId));
}
