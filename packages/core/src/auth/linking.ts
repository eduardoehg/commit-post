/**
 * Vínculo de canais externos por código de uso único.
 *
 * Hoje só o Telegram. O dev clica num link `t.me/<bot>?start=<código>`, o
 * Telegram entrega o código junto do `chat_id` no webhook, e o vínculo se faz
 * sozinho. Ninguém copia número de chat de lugar nenhum — o `chat_id` não é
 * algo que uma pessoa saiba de cabeça, e pedir para descobrir era o passo mais
 * provável de o onboarding morrer.
 */

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { linkCodes, users } from "../db/schema";

/** Quinze minutos: o código vive o tempo de trocar de aplicativo. */
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

export type LinkPurpose = "telegram";

/**
 * O Telegram aceita até 64 caracteres em `[A-Za-z0-9_-]` no payload do
 * `start`. Dezesseis bytes em base64url dão 22 — folgado, e aleatório o
 * bastante para ninguém adivinhar o código de outra pessoa dentro dos quinze
 * minutos.
 */
export function issueLinkCode(
  db: Database,
  userId: number,
  purpose: LinkPurpose = "telegram",
  nowMs: number = Date.now(),
): Promise<string> {
  const code = randomBytes(16).toString("base64url");

  return db
    .insert(linkCodes)
    .values({
      userId,
      code,
      purpose,
      expiresAt: new Date(nowMs + LINK_CODE_TTL_MS),
    })
    .then(() => code);
}

/**
 * Reaproveita um código válido, ou emite um novo.
 *
 * A tela de introdução mostra o link do Telegram já pronto, sem exigir clique
 * em "gerar". Sem este reaproveitamento, cada recarregamento da página criaria
 * uma linha nova, e um dev indeciso deixaria dezenas de códigos vivos ao mesmo
 * tempo — todos capazes de vincular a conta dele.
 */
export async function currentOrNewLinkCode(
  db: Database,
  userId: number,
  purpose: LinkPurpose = "telegram",
  nowMs: number = Date.now(),
): Promise<string> {
  const existing = await db
    .select({ code: linkCodes.code })
    .from(linkCodes)
    .where(
      and(
        eq(linkCodes.userId, userId),
        eq(linkCodes.purpose, purpose),
        isNull(linkCodes.usedAt),
        gt(linkCodes.expiresAt, new Date(nowMs + 60_000)),
      ),
    )
    .limit(1);

  // A folga de um minuto acima evita entregar um código que vence enquanto o
  // dev troca de aplicativo.
  const found = existing[0]?.code;
  return found ?? (await issueLinkCode(db, userId, purpose, nowMs));
}

/**
 * Consome o código e devolve o dono, ou null.
 *
 * Tudo numa instrução só — validade, uso único e marcação — para que dois
 * cliques no mesmo link não consigam resgatar duas vezes. Fazer SELECT e
 * depois UPDATE abriria essa janela.
 */
export async function redeemLinkCode(
  db: Database,
  code: string,
  purpose: LinkPurpose = "telegram",
  nowMs: number = Date.now(),
): Promise<number | null> {
  if (code === "") return null;

  const rows = await db
    .update(linkCodes)
    .set({ usedAt: new Date(nowMs) })
    .where(
      and(
        eq(linkCodes.code, code),
        eq(linkCodes.purpose, purpose),
        isNull(linkCodes.usedAt),
        gt(linkCodes.expiresAt, new Date(nowMs)),
      ),
    )
    .returning({ userId: linkCodes.userId });

  return rows[0]?.userId ?? null;
}

/**
 * Liga o chat ao dev.
 *
 * O `chat_id` é limpo de quem porventura já o tivesse: uma conta do Telegram
 * pertence a uma pessoa só, e um chat apontando para dois devs mandaria os
 * posts de um para o outro aprovar.
 */
export async function bindTelegramChat(
  db: Database,
  userId: number,
  chatId: string,
): Promise<void> {
  await db
    .update(users)
    .set({ telegramChatId: null, updatedAt: new Date() })
    .where(and(eq(users.telegramChatId, chatId), sql`${users.id} <> ${userId}`));

  await db
    .update(users)
    .set({ telegramChatId: chatId, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** O link que a tela de introdução mostra. */
export function telegramDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername.replace(/^@/, "")}?start=${code}`;
}
