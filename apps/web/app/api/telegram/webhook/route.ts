/**
 * Webhook do Telegram — Fase 5.
 *
 * As duas travas de segurança abaixo já estão implementadas de verdade, ainda
 * que a lógica de negócio esteja pendente. São o tipo de coisa que, deixada
 * como TODO, não volta:
 *
 *   1. `X-Telegram-Bot-Api-Secret-Token` prova que a chamada veio do Telegram.
 *   2. Allowlist de `chat_id` prova que veio de VOCÊ. Sem ela, qualquer pessoa
 *      que ache o bot consegue acionar aprovações — o secret do item 1 não
 *      protege contra isso.
 */

import { timingSafeEqual } from "node:crypto";
import { loadWebEnv } from "@commitpost/core/env";

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

/** Extrai o chat_id de qualquer formato de update que nos interessa. */
function chatIdOf(update: unknown): string | null {
  if (typeof update !== "object" || update === null) return null;
  const u = update as Record<string, unknown>;

  const callback = u["callback_query"] as Record<string, unknown> | undefined;
  const message = (callback?.["message"] ?? u["message"]) as
    | Record<string, unknown>
    | undefined;
  const chat = message?.["chat"] as Record<string, unknown> | undefined;
  const id = chat?.["id"];

  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

export async function POST(request: Request): Promise<Response> {
  const env = loadWebEnv();

  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }

  const update: unknown = await request.json();

  if (chatIdOf(update) !== env.TELEGRAM_CHAT_ID) {
    // 200 de propósito: o Telegram reenvia em erro, e não queremos fila de
    // retentativas por causa de mensagem de terceiro. Ignoramos em silêncio.
    return new Response("ignored", { status: 200 });
  }

  // TODO Fase 5: parseCallbackData → atualizar status → responder
  // answerCallbackQuery para o botão parar de girar.

  return new Response("ok", { status: 200 });
}
