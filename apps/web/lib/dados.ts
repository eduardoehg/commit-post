/**
 * As consultas que as telas do painel fazem.
 *
 * Cada uma busca só o que a tela desenha. Estão juntas aqui, e não espalhadas
 * pelas páginas, porque a introdução e a tela de conexões desenham as mesmas
 * seções — e duas versões da mesma consulta divergiriam no primeiro ajuste.
 */

import { and, count, desc, eq } from "drizzle-orm";
import { currentOrNewLinkCode, telegramDeepLink } from "@commitpost/core/auth";
import {
  deniedTerms,
  githubInstallations,
  listRepos,
  oauthTokens,
  postBatches,
  postCandidates,
  userEmails,
} from "@commitpost/core/db";
import { fetchBotUsername } from "@commitpost/core/telegram";
import { GITHUB_COLLAB_PROVIDER, LINKEDIN_PROVIDER } from "./providers";
import { db, env } from "./runtime";

export function instalacoesDe(userId: number) {
  return db()
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, userId));
}

export function emailsDe(userId: number) {
  return db().select().from(userEmails).where(eq(userEmails.userId, userId));
}

export function termosDe(userId: number) {
  return db()
    .select()
    .from(deniedTerms)
    .where(eq(deniedTerms.userId, userId))
    .orderBy(deniedTerms.term);
}

export function reposDe(userId: number) {
  return listRepos(db(), userId);
}

export interface EstadoConexoes {
  temColaboracao: boolean;
  temLinkedIn: boolean;
  linkedInVenceEm: Date | null;
}

export async function conexoesDe(userId: number): Promise<EstadoConexoes> {
  const tokens = await db()
    .select({ provider: oauthTokens.provider, expiresAt: oauthTokens.expiresAt })
    .from(oauthTokens)
    .where(eq(oauthTokens.userId, userId));

  const linkedin = tokens.find((t) => t.provider === LINKEDIN_PROVIDER);

  return {
    temColaboracao: tokens.some((t) => t.provider === GITHUB_COLLAB_PROVIDER),
    temLinkedIn: linkedin !== undefined,
    linkedInVenceEm: linkedin?.expiresAt ?? null,
  };
}

/** O @username do bot muda praticamente nunca; uma consulta por instância basta. */
let botCache: string | undefined;

/**
 * O link de vínculo do Telegram, ou null.
 *
 * Só emite código para quem ainda não vinculou — manter um código vivo para
 * quem já está ligado é deixar uma chave sobrando na mesa.
 */
export async function linkTelegramDe(
  userId: number,
  jaVinculado: boolean,
): Promise<{ link: string | null; botDisponivel: boolean }> {
  if (jaVinculado) return { link: null, botDisponivel: true };

  try {
    botCache ??= await fetchBotUsername(env().TELEGRAM_BOT_TOKEN);
  } catch {
    return { link: null, botDisponivel: false };
  }

  const codigo = await currentOrNewLinkCode(db(), userId);
  return { link: telegramDeepLink(botCache, codigo), botDisponivel: true };
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

export interface PostHistorico {
  id: number;
  corpo: string;
  status: string;
  variante: number;
  decididoEm: Date | null;
  criadoEm: Date;
  janelaInicio: Date;
  janelaFim: Date;
  commits: number;
}

/**
 * Quantos posts em cada estado.
 *
 * Uma consulta agrupada, não uma por filtro: o número aparece em todos os
 * botões ao mesmo tempo, e cinco consultas para desenhar uma barra seria
 * pagar cinco vezes pela mesma informação.
 */
export async function contagemPorStatus(userId: number): Promise<Record<string, number>> {
  const linhas = await db()
    .select({ status: postCandidates.status, n: count() })
    .from(postCandidates)
    .where(eq(postCandidates.userId, userId))
    .groupBy(postCandidates.status);

  const contagem: Record<string, number> = {};
  let total = 0;

  for (const linha of linhas) {
    contagem[linha.status] = linha.n;
    total += linha.n;
  }

  contagem["todos"] = total;
  return contagem;
}

/**
 * Os posts do dev, do mais novo para o mais velho.
 *
 * `edited_body` ganha de `body`: se o dev editou, é a versão dele que conta —
 * mostrar o original seria mostrar um texto que ele já decidiu não usar.
 */
export function historicoDe(userId: number, apenas?: string): Promise<PostHistorico[]> {
  const filtro =
    apenas === undefined
      ? eq(postCandidates.userId, userId)
      : and(eq(postCandidates.userId, userId), eq(postCandidates.status, apenas as "pending"));

  return db()
    .select({
      id: postCandidates.id,
      corpo: postCandidates.editedBody,
      original: postCandidates.body,
      status: postCandidates.status,
      variante: postCandidates.variantIndex,
      decididoEm: postCandidates.decidedAt,
      criadoEm: postCandidates.createdAt,
      janelaInicio: postBatches.windowStart,
      janelaFim: postBatches.windowEnd,
      commits: postBatches.commitCount,
    })
    .from(postCandidates)
    .innerJoin(postBatches, eq(postBatches.id, postCandidates.batchId))
    .where(filtro)
    .orderBy(desc(postCandidates.createdAt), postCandidates.variantIndex)
    .then((linhas) =>
      linhas.map(({ original, corpo, ...resto }) => ({ ...resto, corpo: corpo ?? original })),
    );
}
