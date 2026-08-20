/**
 * Sessão do painel.
 *
 * Em tabela, e não em cookie assinado sem estado, porque revogar o acesso de
 * uma pessoa precisa ser possível sem trocar o segredo de todo mundo — apagar
 * a linha basta.
 *
 * O cookie carrega um token aleatório; o banco guarda apenas o SHA-256 dele.
 * Assim um dump da tabela `sessions` não dá a ninguém o direito de se passar
 * pelos devs, do mesmo jeito que uma tabela de senhas com hash não dá.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Database } from "../db/client";
import { sessions, users } from "../db/schema";

export const SESSION_COOKIE = "commitpost_session";

/** Catorze dias. Curto o bastante para importar, longo o bastante para não irritar. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: number;
  githubUserId: number;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
  telegramChatId: string | null;
  active: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  db: Database,
  userId: number,
  nowMs: number = Date.now(),
): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(nowMs + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id: randomBytes(12).toString("hex"),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Devolve o dev dono da sessão, ou null.
 *
 * A comparação do prazo vai na consulta, não no JavaScript: uma sessão vencida
 * simplesmente não é encontrada, e não existe caminho de código onde alguém
 * esqueça de conferir a data depois de ler a linha.
 *
 * `active` é conferido aqui também. Desmarcar um dev tira o acesso dele na
 * próxima requisição, sem precisar caçar as sessões abertas.
 */
export async function resolveSession(
  db: Database,
  token: string | undefined,
  nowMs: number = Date.now(),
): Promise<SessionUser | null> {
  if (token === undefined || token === "") return null;

  const rows = await db
    .select({
      id: users.id,
      githubUserId: users.githubUserId,
      githubLogin: users.githubLogin,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      telegramChatId: users.telegramChatId,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date(nowMs))))
    .limit(1);

  const row = rows[0];
  if (row === undefined || !row.active) return null;
  return row;
}

export async function destroySession(db: Database, token: string | undefined): Promise<void> {
  if (token === undefined || token === "") return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Some com o que já venceu. Chamado no login, que é raro o bastante. */
export async function purgeExpiredSessions(db: Database, nowMs: number = Date.now()): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date(nowMs)));
}

/** Comparação em tempo constante para segredos de tamanho igual. */
export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
