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
import { users } from "@commitpost/core/db";
import { sendMessage } from "@commitpost/core/telegram";
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
}

/** Extrai chat e texto de qualquer formato de update que nos interessa. */
function readUpdate(update: unknown): Incoming {
  if (typeof update !== "object" || update === null) return { chatId: null, text: null };
  const u = update as Record<string, unknown>;

  const callback = u["callback_query"] as Record<string, unknown> | undefined;
  const message = (callback?.["message"] ?? u["message"]) as Record<string, unknown> | undefined;
  const chat = message?.["chat"] as Record<string, unknown> | undefined;
  const id = chat?.["id"];
  const text = u["message"] === undefined ? undefined : (message?.["text"] as unknown);

  return {
    chatId: typeof id === "number" || typeof id === "string" ? String(id) : null,
    text: typeof text === "string" ? text : null,
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
const OK = new Response("ok", { status: 200 });

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
  const { chatId, text } = readUpdate(update);
  if (chatId === null) return OK;

  const database = db();
  const codigo = startPayload(text);

  if (codigo !== null) {
    if (codigo === "") {
      await sendMessage(
        configuration.TELEGRAM_BOT_TOKEN,
        chatId,
        "Para vincular sua conta, abra o link que aparece na tela de introdução do CommitPost.",
      );
      return OK;
    }

    const userId = await redeemLinkCode(database, codigo);
    if (userId === null) {
      // Sem distinguir "não existe" de "expirou": para quem está do outro lado
      // a ação é a mesma, e a diferença só ajudaria quem chuta códigos.
      await sendMessage(
        configuration.TELEGRAM_BOT_TOKEN,
        chatId,
        "Este link não vale mais. Gere um novo na tela de introdução — eles duram 15 minutos.",
      );
      return OK;
    }

    await bindTelegramChat(database, userId, chatId);
    await sendMessage(
      configuration.TELEGRAM_BOT_TOKEN,
      chatId,
      "Pronto. É por aqui que seus posts vão chegar para aprovação.",
    );
    return OK;
  }

  const donos = await database
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.telegramChatId, chatId))
    .limit(1);

  const dono = donos[0];
  if (dono === undefined || !dono.active) return OK;

  // TODO Fase 5: parseCallbackData → atualizar status → answerCallbackQuery
  // para o botão parar de girar.

  return OK;
}
