/**
 * Avisos de credencial vencendo, no Telegram.
 *
 * O GitHub renova sozinho; o LinkedIn não. O refresh token dele só é concedido
 * a parceiros aprovados, e o tier padrão não recebe nenhum — então a única
 * defesa contra o acesso morrer é dizer antes.
 *
 * O aviso vai para o Telegram, e não só para o painel, porque o painel só
 * avisa quem abre o painel. Quem já configurou tudo não tem motivo para abrir:
 * ele vive no Telegram, aprovando post. O aviso precisa chegar onde a pessoa
 * está.
 */

import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  avaliarExpiracao,
  avaliarVersaoApi,
  textoExpiracao,
  textoVersaoApi,
} from "@commitpost/core/linkedin";
import { logs, oauthTokens, users, type Database } from "@commitpost/core/db";
import { sendMessage } from "@commitpost/core/telegram";

const LINKEDIN_PROVIDER = "linkedin";

/** Marca em `logs` que serve para não repetir o aviso a cada execução. */
const FASE_AVISO = "aviso-expiracao";

/** A mesma ideia, para o aviso que é do operador e não de um dev. */
const FASE_VERSAO = "aviso-versao-api";

/**
 * Janela de silêncio entre dois avisos iguais.
 *
 * Vinte horas, e não vinte e quatro, para o ciclo semanal nunca pular um aviso
 * por chegar alguns minutos mais cedo que na semana anterior. O que se quer
 * evitar é a repetição de quem roda o pipeline três vezes seguidas testando —
 * não o lembrete legítimo.
 */
const SILENCIO_MS = 20 * 60 * 60 * 1000;

export type ResultadoAviso = "enviado" | "nada-a-avisar" | "ja-avisado" | "sem-telegram";

export async function avisarExpiracao(
  db: Database,
  userId: number,
  botToken: string,
): Promise<ResultadoAviso> {
  const linhas = await db
    .select({ expiresAt: oauthTokens.expiresAt })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, LINKEDIN_PROVIDER)))
    .limit(1);

  const token = linhas[0];
  if (token === undefined) return "nada-a-avisar";

  const estado = avaliarExpiracao(token.expiresAt);
  if (estado === null || !estado.precisaAvisar) return "nada-a-avisar";

  const recentes = await db
    .select({ id: logs.id })
    .from(logs)
    .where(
      and(
        eq(logs.userId, userId),
        eq(logs.phase, FASE_AVISO),
        gt(logs.createdAt, new Date(Date.now() - SILENCIO_MS)),
      ),
    )
    .orderBy(desc(logs.createdAt))
    .limit(1);

  if (recentes.length > 0) return "ja-avisado";

  const donos = await db
    .select({ chatId: users.telegramChatId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const chatId = donos[0]?.chatId;
  if (chatId === null || chatId === undefined) return "sem-telegram";

  await sendMessage(botToken, chatId, textoExpiracao(estado));

  // Gravado DEPOIS do envio: se o Telegram falhar, o aviso não conta como
  // dado e a próxima execução tenta de novo. O contrário silenciaria um aviso
  // que ninguém recebeu.
  await db.insert(logs).values({
    userId,
    phase: FASE_AVISO,
    level: estado.vencido ? "error" : "warn",
    message: textoExpiracao(estado),
    meta: { diasRestantes: estado.diasRestantes, provider: LINKEDIN_PROVIDER },
  });

  return "enviado";
}

/**
 * A versão da API do LinkedIn envelhecendo.
 *
 * Vai para o OPERADOR, não para os devs: consertar isto é subir uma constante
 * e publicar de novo. Um dev que recebesse esta mensagem não teria o que fazer
 * com ela, e aviso sem ação possível é o tipo que ensina a ignorar avisos.
 *
 * Uma vez por execução, não uma por dev — a versão é do sistema inteiro.
 */
export async function avisarVersaoApi(
  db: Database,
  chatOperador: string | undefined,
  botToken: string,
  agora: Date = new Date(),
): Promise<ResultadoAviso> {
  const estado = avaliarVersaoApi(agora);
  if (!estado.precisaAvisar) return "nada-a-avisar";
  if (chatOperador === undefined) return "sem-telegram";

  // `userId` nulo é o que distingue o aviso do operador dos avisos de dev, e
  // por isso a busca precisa do IS NULL: sem ele, o aviso de um dev qualquer
  // silenciaria este.
  const recentes = await db
    .select({ id: logs.id })
    .from(logs)
    .where(
      and(
        isNull(logs.userId),
        eq(logs.phase, FASE_VERSAO),
        gt(logs.createdAt, new Date(agora.getTime() - SILENCIO_MS)),
      ),
    )
    .orderBy(desc(logs.createdAt))
    .limit(1);

  if (recentes.length > 0) return "ja-avisado";

  await sendMessage(botToken, chatOperador, textoVersaoApi(estado));

  await db.insert(logs).values({
    phase: FASE_VERSAO,
    level: estado.vencida ? "error" : "warn",
    message: textoVersaoApi(estado),
    meta: { versao: estado.versao, mesesRestantes: estado.mesesRestantes },
  });

  return "enviado";
}
