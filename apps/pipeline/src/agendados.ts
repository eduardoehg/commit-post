/**
 * Publica o que foi agendado — Fase 8.
 *
 * Entrypoint próprio, separado do pipeline semanal, e roda de hora em hora
 * (`.github/workflows/publicar.yml`). São dois trabalhos com ritmos diferentes:
 * coletar e gerar custa chamada de GitHub e de LLM e faz sentido uma vez por
 * semana; publicar o que venceu é uma consulta e uma chamada HTTP, e precisa
 * acontecer perto da hora marcada.
 *
 * O cron do Actions atrasa de 5 a 30 minutos, então "13h" na prática é "durante
 * as 13h". Para post de LinkedIn isso não muda nada — e a alternativa seria um
 * processo nosso ligado o tempo todo, para ganhar minutos que ninguém percebe.
 *
 * Uma falha não derruba as outras: o post que não saiu continua `scheduled` e
 * a execução seguinte tenta de novo. É o mesmo princípio do pipeline — o erro
 * de um dev não pode custar o post de outro.
 */

import { loadPublisherEnv } from "@commitpost/core/env";
import { rotularInstante, fusoOuPadrao } from "@commitpost/core/agenda";
import {
  candidatosVencidos,
  closeDatabase,
  createDatabase,
  users,
  type Database,
} from "@commitpost/core/db";
import { publicarNoLinkedIn } from "@commitpost/core/publicar";
import { sendMessage } from "@commitpost/core/telegram";
import { eq } from "drizzle-orm";

function log(mensagem: string): void {
  console.log(`[commitpost] ${mensagem}`);
}

/**
 * Quantos posts uma execução pode publicar.
 *
 * Existe para o caso da fila represada: depois de o LinkedIn passar um dia
 * fora do ar, publicar tudo de uma vez encheria o feed de quem segue o dev com
 * cinco posts em dois minutos — o oposto do que o agendamento existe para
 * fazer. O que sobra vai na hora seguinte.
 */
const POR_EXECUCAO = 5;

/** Avisar é cortesia; a publicação já aconteceu ou já falhou. */
async function tentarAvisar(token: string, chatId: string | null, texto: string): Promise<void> {
  if (chatId === null) return;
  try {
    await sendMessage(token, chatId, texto);
  } catch {
    // Telegram fora do ar não pode virar erro de publicação.
  }
}

async function donoDe(
  db: Database,
  userId: number,
): Promise<{ chatId: string | null; fuso: string }> {
  const linhas = await db
    .select({ chatId: users.telegramChatId, timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return {
    chatId: linhas[0]?.chatId ?? null,
    fuso: fusoOuPadrao(linhas[0]?.timezone),
  };
}

async function main(): Promise<void> {
  const env = loadPublisherEnv();
  const agora = new Date();
  const db = createDatabase(env.DATABASE_URL);

  try {
    const fila = await candidatosVencidos(db, agora, POR_EXECUCAO);

    if (fila.length === 0) {
      log("nenhum post agendado venceu");
      return;
    }

    log(`${String(fila.length)} post(s) agendado(s) para publicar`);

    // Devs cujo acesso ao LinkedIn morreu. Insistir nos outros posts da mesma
    // pessoa só colecionaria o mesmo 401 e mandaria o mesmo aviso três vezes.
    const semAcesso = new Set<number>();

    for (const candidato of fila) {
      if (semAcesso.has(candidato.userId)) {
        log(`post ${String(candidato.id)}: pulado, o acesso do dono venceu`);
        continue;
      }

      const dono = await donoDe(db, candidato.userId);
      const marcado =
        candidato.scheduledFor === null ? "sem hora" : rotularInstante(candidato.scheduledFor, dono.fuso);

      const resultado = await publicarNoLinkedIn({
        db,
        encryptionKey: env.TOKEN_ENCRYPTION_KEY,
        userId: candidato.userId,
        candidateId: candidato.id,
      });

      if (resultado.tipo === "publicado") {
        log(`post ${String(candidato.id)}: no ar (marcado para ${marcado})`);
        await tentarAvisar(
          env.TELEGRAM_BOT_TOKEN,
          dono.chatId,
          `Seu post agendado para ${marcado} está no ar: ${resultado.url}`,
        );
        continue;
      }

      if (resultado.tipo === "nao-publicavel") {
        // Alguém publicou ou desagendou entre a consulta e agora. Não é erro:
        // é o estado do banco tendo mudado, e o certo é não fazer nada.
        log(`post ${String(candidato.id)}: já estava ${resultado.statusAtual}, nada a fazer`);
        continue;
      }

      if (resultado.tipo === "sem-linkedin") {
        semAcesso.add(candidato.userId);
        log(`post ${String(candidato.id)}: dono sem LinkedIn conectado`);
        await tentarAvisar(
          env.TELEGRAM_BOT_TOKEN,
          dono.chatId,
          `Seu post agendado para ${marcado} não saiu: o LinkedIn não está conectado. ` +
            `Conecte em Conexões — ele continua na fila e tenta de novo sozinho.`,
        );
        continue;
      }

      if (resultado.acessoVencido) semAcesso.add(candidato.userId);

      // O post continua `scheduled` e a hora já passou, então a execução
      // seguinte o encontra de novo. É a retentativa: não há fila separada nem
      // contador, e um LinkedIn fora do ar por uma hora se resolve sozinho.
      log(`post ${String(candidato.id)}: FALHOU — ${resultado.motivo}`);
      await tentarAvisar(
        env.TELEGRAM_BOT_TOKEN,
        dono.chatId,
        `Seu post agendado para ${marcado} não saiu: ${resultado.motivo}\n\n` +
          `Ele continua na fila e o sistema tenta de novo na próxima hora.`,
      );
    }
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error: unknown) => {
  console.error("[commitpost] publicador falhou");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
