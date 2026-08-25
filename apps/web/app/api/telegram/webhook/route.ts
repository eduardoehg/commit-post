/**
 * Webhook do Telegram.
 *
 * Duas travas, e elas respondem a perguntas diferentes:
 *
 *   1. `X-Telegram-Bot-Api-Secret-Token` prova que a chamada veio do Telegram.
 *   2. O chat precisa pertencer a um dev cadastrado e ativo. O secret do item 1
 *      não protege contra isso — qualquer pessoa que ache o bot conversa com
 *      ele, e as mensagens chegam aqui pelo caminho legítimo.
 *
 * A allowlist mudou de lugar na Fase 1.5: antes era a variável
 * TELEGRAM_CHAT_ID, um chat só. Com vários devs ela vive em
 * `users.telegram_chat_id`, porque é ela que cresce a cada pessoa nova.
 *
 * A única mensagem aceita de um chat desconhecido é `/start <código>` — tem
 * que ser, é assim que o vínculo nasce. O que autoriza ali é o código de uso
 * único emitido na tela de introdução, com quinze minutos de validade.
 */

import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { bindTelegramChat, redeemLinkCode } from "@commitpost/core/auth";
import { fusoOuPadrao, opcaoPorId, opcoesDeAgendamento, rotularInstante } from "@commitpost/core/agenda";
import { decideCandidate, users, type Decisao, type ResultadoDecisao } from "@commitpost/core/db";
import { publicarNoLinkedIn, type ResultadoPublicacao } from "@commitpost/core/publicar";
import {
  answerCallback,
  buildKeyboard,
  buildScheduleKeyboard,
  markDecided,
  parseCallbackData,
  replaceKeyboard,
  sendMessage,
  type ParsedCallback,
} from "@commitpost/core/telegram";
import { db, env } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comparação em tempo constante, tolerante a tamanhos diferentes. */
function secretMatches(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface Incoming {
  chatId: string | null;
  text: string | null;
  /** Presentes só quando o dev clicou num botão. */
  callbackId: string | null;
  callbackData: string | null;
  messageId: number | null;
}

/** Extrai chat, texto e clique de qualquer formato de update que nos interessa. */
function readUpdate(update: unknown): Incoming {
  const vazio: Incoming = {
    chatId: null,
    text: null,
    callbackId: null,
    callbackData: null,
    messageId: null,
  };
  if (typeof update !== "object" || update === null) return vazio;
  const u = update as Record<string, unknown>;

  const callback = u["callback_query"] as Record<string, unknown> | undefined;
  const message = (callback?.["message"] ?? u["message"]) as Record<string, unknown> | undefined;
  const chat = message?.["chat"] as Record<string, unknown> | undefined;
  const id = chat?.["id"];
  const text = u["message"] === undefined ? undefined : (message?.["text"] as unknown);

  const callbackId = callback?.["id"];
  const callbackData = callback?.["data"];
  const messageId = message?.["message_id"];

  return {
    chatId: typeof id === "number" || typeof id === "string" ? String(id) : null,
    text: typeof text === "string" ? text : null,
    callbackId: typeof callbackId === "string" ? callbackId : null,
    callbackData: typeof callbackData === "string" ? callbackData : null,
    messageId: typeof messageId === "number" ? messageId : null,
  };
}

/** `/start ABC123` → `ABC123`; `/start` sozinho → string vazia. */
function startPayload(text: string | null): string | null {
  if (text === null) return null;
  const match = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text.trim());
  return match === null ? null : (match[1] ?? "");
}

/**
 * O Telegram reenvia updates quando a resposta não é 2xx, e uma fila de
 * retentativas por causa de mensagem de terceiro é pior do que o silêncio.
 * Toda saída daqui é 200, menos o secret errado — esse não é o Telegram.
 */
function ok(): Response {
  return new Response("ok", { status: 200 });
}

/**
 * Responder é cortesia, não parte da transação.
 *
 * Se o envio falhar depois de o vínculo já ter sido gravado, deixar o erro
 * subir devolveria 500 — e o Telegram reenviaria o mesmo `/start` para
 * sempre, contra um código que já foi consumido. O dev veria o bot mudo e uma
 * fila de retentativas girando atrás.
 */
async function tentarEnviar(token: string, chatId: string, texto: string): Promise<void> {
  try {
    await sendMessage(token, chatId, texto);
  } catch {
    // Nada a fazer daqui. O estado que importa já está no banco.
  }
}

/** O aviso curto que faz o botão parar de girar. Também é cortesia. */
async function tentarResponder(token: string, callbackId: string, texto: string): Promise<void> {
  try {
    await answerCallback(token, callbackId, texto);
  } catch {
    // Idem: a decisão já foi gravada.
  }
}

export async function POST(request: Request): Promise<Response> {
  const configuration = env();

  if (
    !secretMatches(
      request.headers.get("x-telegram-bot-api-secret-token"),
      configuration.TELEGRAM_WEBHOOK_SECRET,
    )
  ) {
    return new Response("forbidden", { status: 403 });
  }

  const update: unknown = await request.json();
  const { chatId, text, callbackId, callbackData, messageId } = readUpdate(update);
  if (chatId === null) return ok();

  const database = db();
  const codigo = startPayload(text);

  if (codigo !== null) {
    if (codigo === "") {
      await tentarEnviar(
        configuration.TELEGRAM_BOT_TOKEN,
        chatId,
        "Para vincular sua conta, abra o link que aparece na tela de introdução do CommitPost.",
      );
      return ok();
    }

    const userId = await redeemLinkCode(database, codigo);
    if (userId === null) {
      // Sem distinguir "não existe" de "expirou": para quem está do outro lado
      // a ação é a mesma, e a diferença só ajudaria quem chuta códigos.
      await tentarEnviar(
        configuration.TELEGRAM_BOT_TOKEN,
        chatId,
        "Este link não vale mais. Gere um novo na tela de introdução — eles duram 15 minutos.",
      );
      return ok();
    }

    await bindTelegramChat(database, userId, chatId);
    await tentarEnviar(
      configuration.TELEGRAM_BOT_TOKEN,
      chatId,
      "Pronto. É por aqui que seus posts vão chegar para aprovação.",
    );
    return ok();
  }

  const donos = await database
    .select({ id: users.id, active: users.active, timezone: users.timezone })
    .from(users)
    .where(eq(users.telegramChatId, chatId))
    .limit(1);

  const dono = donos[0];
  if (dono === undefined || !dono.active) return ok();

  if (callbackId === null || callbackData === null) return ok();

  const clique = parseCallbackData(callbackData);
  if (clique === null) {
    // Inclui o `callback_data: "x"` dos botões já decididos, que só existem
    // para segurar a legenda depois que a decisão foi tomada.
    await tentarResponder(configuration.TELEGRAM_BOT_TOKEN, callbackId, "Este lote já foi decidido.");
    return ok();
  }

  const token = configuration.TELEGRAM_BOT_TOKEN;

  // `menu` e `voltar` não decidem nada: trocam o teclado entre os dois níveis.
  // Ficam antes de tudo porque não têm o que gravar, e passar por
  // `decideCandidate` só para não fazer nada convidaria alguém a somar um
  // efeito colateral ali no futuro.
  if (clique.action === "menu" || clique.action === "voltar") {
    await trocarTeclado(token, {
      chatId,
      messageId,
      callbackId,
      clique,
      fuso: fusoOuPadrao(dono.timezone),
    });
    return ok();
  }

  const quando = horarioEscolhido(clique, fusoOuPadrao(dono.timezone));

  // Slot que não existe é payload adulterado ou botão de uma mensagem antiga,
  // cujos horários já passaram. Nos dois casos, não decidir é a resposta certa.
  if (clique.action === "schedule" && quando === null) {
    await tentarResponder(token, callbackId, "Esse horário não vale mais. Toque em Agendar de novo.");
    return ok();
  }

  const acao: Decisao =
    clique.action === "publish" ? "approve" : clique.action === "reject" ? "reject" : "schedule";

  const resultado = await decideCandidate(
    database,
    dono.id,
    clique.candidateId,
    acao,
    quando ?? undefined,
  );

  // Publicar acontece AQUI para "publicar agora", e não num passo depois: o
  // ciclo seguinte é semanal, e adiar faria "aprovei hoje" virar "saiu na
  // segunda que vem". O agendado é do workflow de hora em hora.
  const publicacao =
    resultado.tipo === "aplicada" && acao === "approve"
      ? await publicarNoLinkedIn({
          db: database,
          encryptionKey: configuration.TOKEN_ENCRYPTION_KEY,
          userId: dono.id,
          candidateId: clique.candidateId,
        })
      : null;

  await responderDecisao(token, {
    callbackId,
    chatId,
    messageId,
    resultado,
    acao,
    publicacao,
    fuso: fusoOuPadrao(dono.timezone),
  });

  return ok();
}

/**
 * O instante por trás do slot escolhido.
 *
 * Recalculado aqui a partir do índice, e não lido do botão. O `callback_data`
 * é dado que veio de fora: uma data ali seria o cliente escolhendo quando um
 * post vai ao ar, inclusive fora do horizonte que o sistema aceita.
 */
function horarioEscolhido(clique: ParsedCallback, fuso: string): Date | null {
  if (clique.action !== "schedule" || clique.slot === null) return null;
  return opcaoPorId(new Date(), fuso, clique.slot)?.quando ?? null;
}

/** Alterna a mesma mensagem entre "o que fazer" e "para quando". */
async function trocarTeclado(
  token: string,
  ctx: {
    chatId: string;
    messageId: number | null;
    callbackId: string;
    clique: ParsedCallback;
    fuso: string;
  },
): Promise<void> {
  if (ctx.messageId === null) {
    await tentarResponder(token, ctx.callbackId, "Não consegui abrir os horários.");
    return;
  }

  const teclado =
    ctx.clique.action === "menu"
      ? buildScheduleKeyboard(ctx.clique.candidateId, opcoesDeAgendamento(new Date(), ctx.fuso))
      : buildKeyboard(ctx.clique.candidateId);

  try {
    await replaceKeyboard(token, ctx.chatId, ctx.messageId, teclado);
    await tentarResponder(token, ctx.callbackId, "");
  } catch {
    // Mensagem apagada, ou o mesmo teclado de novo — o Telegram recusa a
    // edição idêntica. Nada foi decidido, então não há estado a consertar.
    await tentarResponder(token, ctx.callbackId, "Não consegui abrir os horários.");
  }
}

/**
 * Fecha o ciclo do clique: avisa o dev e tira os botões.
 *
 * Tudo aqui é cortesia depois do fato — a decisão já está no banco. Falhar em
 * responder não pode virar 500, senão o Telegram reenvia o mesmo clique contra
 * um candidato que não está mais pendente.
 */
async function responderDecisao(
  token: string,
  ctx: {
    callbackId: string;
    chatId: string;
    messageId: number | null;
    resultado: ResultadoDecisao;
    acao: Decisao;
    publicacao: ResultadoPublicacao | null;
    fuso: string;
  },
): Promise<void> {
  const { aviso, legenda } = descreverDecisao(ctx.resultado, ctx.acao, ctx.publicacao, ctx.fuso);

  await tentarResponder(token, ctx.callbackId, aviso);

  if (legenda !== null && ctx.messageId !== null) {
    await tentarMarcar(token, ctx.chatId, ctx.messageId, legenda);
  }

  // O link do post vai numa mensagem à parte: o aviso do botão tem 200 bytes e
  // some sozinho da tela, e um link que some antes de ser tocado não serve.
  if (ctx.publicacao?.tipo === "publicado") {
    await tentarEnviar(token, ctx.chatId, `No ar: ${ctx.publicacao.url}`);
  }

  if (ctx.publicacao?.tipo === "falhou") {
    await tentarEnviar(
      token,
      ctx.chatId,
      `O post foi aprovado mas não saiu no LinkedIn: ${ctx.publicacao.motivo}\n\n` +
        `O texto continua acima — dá para copiar e publicar à mão.`,
    );
  }

  // As irmãs encerradas também perdem os botões. Sem isto o dev clica nelas
  // achando que decide, e nada acontece — foi exatamente o que aconteceu no
  // primeiro lote de verdade.
  if (ctx.resultado.tipo === "aplicada") {
    for (const messageId of ctx.resultado.encerradas) {
      await tentarMarcar(token, ctx.chatId, messageId, "— encerrada —");
    }
  }
}

async function tentarMarcar(
  token: string,
  chatId: string,
  messageId: number,
  legenda: string,
): Promise<void> {
  try {
    await markDecided(token, chatId, messageId, legenda);
  } catch {
    // Botão que não sumiu é chato, não é erro de estado.
  }
}

function descreverDecisao(
  resultado: ResultadoDecisao,
  acao: Decisao,
  publicacao: ResultadoPublicacao | null,
  fuso: string,
): { aviso: string; legenda: string | null } {
  if (resultado.tipo === "nao-encontrada") {
    // Mesma resposta para "não existe" e "não é seu". Distinguir os dois
    // transformaria o botão num oráculo de quais ids existem.
    return { aviso: "Este post não está mais disponível.", legenda: null };
  }

  if (resultado.tipo === "sem-horario") {
    return { aviso: "Esse horário não vale mais. Toque em Agendar de novo.", legenda: null };
  }

  if (resultado.tipo === "ja-decidida") {
    return { aviso: "Este post já tinha sido decidido.", legenda: "— já decidido —" };
  }

  if (acao === "reject") {
    return { aviso: "Recusado. Os outros continuam esperando.", legenda: "❌ recusado" };
  }

  // "Versões" e não "posts": o que foi encerrado são as outras redações DESTE
  // assunto. Os posts dos outros assuntos continuam esperando decisão, e
  // chamar tudo de "outros posts" faria o dev achar que perdeu o lote.
  const outras =
    resultado.encerradas.length > 0
      ? ` As outras ${String(resultado.encerradas.length)} versões deste assunto foram encerradas.`
      : "";

  if (acao === "schedule" && resultado.agendadoPara !== null) {
    const quando = rotularInstante(resultado.agendadoPara, fuso);
    return {
      aviso: `Agendado para ${quando}.${outras}`,
      legenda: `🗓 ${quando}`,
    };
  }

  if (publicacao?.tipo === "publicado") {
    return { aviso: `Publicado no LinkedIn.${outras}`, legenda: "🔗 publicado" };
  }

  if (publicacao?.tipo === "falhou") {
    // A legenda diz "aprovado", e não "publicado", porque foi isso que
    // aconteceu. Marcar como publicado o que não saiu seria a interface
    // mentindo sobre o estado — de novo.
    return { aviso: `Aprovado, mas não saiu no LinkedIn.${outras}`, legenda: "✅ aprovado" };
  }

  return {
    aviso: `Aprovado.${outras} Copie o texto e publique no LinkedIn.`,
    legenda: "✅ aprovado",
  };
}
