/**
 * Publicar um post aprovado no LinkedIn.
 *
 * Acontece **na aprovação**, e não num passo separado depois, porque o ciclo
 * seguinte é semanal: adiar a publicação para o próximo pipeline faria "aprovei
 * hoje" virar "saiu na segunda que vem".
 *
 * Falhar aqui não desfaz a aprovação. O candidato fica `approved` e o dev
 * recebe o motivo — ele ainda tem o texto no Telegram e publica à mão se
 * quiser. Reverter a decisão por causa de uma indisponibilidade do LinkedIn
 * seria punir a pessoa por um problema que não é dela.
 */

import { and, eq } from "drizzle-orm";
import { decryptSecret } from "@commitpost/core/crypto";
import { LinkedInError, memberUrn, publishPost } from "@commitpost/core/linkedin";
import { oauthTokens, postCandidates, publications } from "@commitpost/core/db";
import { LINKEDIN_PROVIDER } from "./providers";
import { db, env } from "./runtime";

export type ResultadoPublicacao =
  | { tipo: "publicado"; url: string }
  | { tipo: "sem-linkedin" }
  | { tipo: "falhou"; motivo: string };

export async function publicarNoLinkedIn(
  userId: number,
  candidateId: number,
): Promise<ResultadoPublicacao> {
  const database = db();
  const configuration = env();

  const tokens = await database
    .select({
      cifrado: oauthTokens.accessTokenEncrypted,
      subject: oauthTokens.subject,
      expiresAt: oauthTokens.expiresAt,
    })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, LINKEDIN_PROVIDER)))
    .limit(1);

  const token = tokens[0];
  if (token === undefined || token.subject === null) return { tipo: "sem-linkedin" };

  // O texto que vai ao ar é o EDITADO, quando existe. Publicar o original
  // depois de o dev ter mexido seria publicar o que ele decidiu não usar.
  const candidatos = await database
    .select({ body: postCandidates.body, editedBody: postCandidates.editedBody })
    .from(postCandidates)
    .where(and(eq(postCandidates.id, candidateId), eq(postCandidates.userId, userId)))
    .limit(1);

  const candidato = candidatos[0];
  if (candidato === undefined) return { tipo: "falhou", motivo: "post não encontrado" };

  let acessivel: string;
  try {
    acessivel = decryptSecret(token.cifrado, configuration.TOKEN_ENCRYPTION_KEY);
  } catch {
    return { tipo: "falhou", motivo: "não foi possível decifrar o acesso — reconecte o LinkedIn" };
  }

  try {
    const publicado = await publishPost({
      accessToken: acessivel,
      authorUrn: memberUrn(token.subject),
      texto: candidato.editedBody ?? candidato.body,
    });

    // Os dois numa transação: um `published` sem linha em `publications`
    // perderia o link do post para sempre, e uma linha sem o status faria o
    // sistema achar que ainda há o que publicar.
    await database.transaction(async (tx) => {
      await tx.insert(publications).values({
        candidateId,
        userId,
        provider: LINKEDIN_PROVIDER,
        externalId: publicado.urn,
        url: publicado.url,
      });

      await tx
        .update(postCandidates)
        .set({ status: "published" })
        .where(and(eq(postCandidates.id, candidateId), eq(postCandidates.status, "approved")));
    });

    return { tipo: "publicado", url: publicado.url };
  } catch (error) {
    const vencido = error instanceof LinkedInError && error.status === 401;

    return {
      tipo: "falhou",
      motivo: vencido
        ? "o acesso ao LinkedIn venceu — reconecte em Conexões e publique de novo"
        : error instanceof Error
          ? error.message
          : "erro desconhecido",
    };
  }
}
