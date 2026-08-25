/**
 * A publicação, com o banco e a chave desta requisição.
 *
 * A lógica mora em `@commitpost/core/publicar`, e não aqui, porque três
 * caminhos chegam nela: o botão do Telegram, o botão do painel e o workflow
 * que publica o agendado. O que sobrou neste arquivo é só o preenchimento das
 * dependências — `db()` e a chave de cifra vêm do runtime da Vercel, que o
 * runner do Actions não tem.
 */

import { publicarNoLinkedIn as publicar } from "@commitpost/core/publicar";
import { db, env } from "./runtime";

export type { ResultadoPublicacao } from "@commitpost/core/publicar";

export async function publicarNoLinkedIn(userId: number, candidateId: number) {
  return publicar({
    db: db(),
    encryptionKey: env().TOKEN_ENCRYPTION_KEY,
    userId,
    candidateId,
  });
}
