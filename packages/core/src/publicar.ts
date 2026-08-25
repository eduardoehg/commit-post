/**
 * Publicar um post no LinkedIn.
 *
 * Mora em `core`, e não no painel, porque agora existem TRÊS caminhos até aqui:
 * o botão do Telegram, o botão do painel e o workflow que publica o que foi
 * agendado. Duas implementações divergiriam no primeiro ajuste, e a errada
 * seria a menos usada — que é justamente a automática, a única que ninguém
 * está olhando quando roda.
 *
 * Falhar aqui não desfaz a decisão. O candidato mantém o status e o dev recebe
 * o motivo; o texto continua no Telegram para publicar à mão. Reverter por
 * causa de uma indisponibilidade do LinkedIn seria punir a pessoa por um
 * problema que não é dela.
 */

import { and, eq, inArray } from "drizzle-orm";
import { decryptSecret } from "./crypto";
import type { Database } from "./db/client";
import { oauthTokens, postCandidates, publications } from "./db/schema";
import { LinkedInError, memberUrn, publishPost } from "./linkedin/index";

/** O nome na coluna `provider` de `oauth_tokens`. */
export const LINKEDIN_PROVIDER = "linkedin";

/**
 * De quais estados um post pode ir ao ar.
 *
 * `approved` é o "publique agora" e `scheduled` é o "publique na hora marcada".
 * Os outros ficam de fora por motivos diferentes e igualmente importantes:
 * `pending` nunca foi decidido, `rejected` foi recusado, e `published` já saiu
 * — publicar de novo duplicaria o post no perfil de alguém.
 */
const PUBLICAVEIS = ["approved", "scheduled"] as const;

export type ResultadoPublicacao =
  | { tipo: "publicado"; url: string }
  | { tipo: "sem-linkedin" }
  | { tipo: "nao-publicavel"; statusAtual: string }
  | { tipo: "falhou"; motivo: string; acessoVencido: boolean };

export async function publicarNoLinkedIn(options: {
  db: Database;
  encryptionKey: string;
  userId: number;
  candidateId: number;
}): Promise<ResultadoPublicacao> {
  const { db, encryptionKey, userId, candidateId } = options;

  const tokens = await db
    .select({
      cifrado: oauthTokens.accessTokenEncrypted,
      subject: oauthTokens.subject,
    })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, LINKEDIN_PROVIDER)))
    .limit(1);

  const token = tokens[0];
  if (token === undefined || token.subject === null) return { tipo: "sem-linkedin" };

  // O texto que vai ao ar é o EDITADO, quando existe. Publicar o original
  // depois de o dev ter mexido seria publicar o que ele decidiu não usar.
  const candidatos = await db
    .select({
      body: postCandidates.body,
      editedBody: postCandidates.editedBody,
      status: postCandidates.status,
    })
    .from(postCandidates)
    .where(and(eq(postCandidates.id, candidateId), eq(postCandidates.userId, userId)))
    .limit(1);

  const candidato = candidatos[0];
  if (candidato === undefined) {
    return { tipo: "falhou", motivo: "post não encontrado", acessoVencido: false };
  }

  // Conferido ANTES de falar com o LinkedIn. A trava de verdade é o `status`
  // no WHERE do update lá embaixo, que fecha a corrida; esta checagem existe
  // para não publicar de fato um post que já saiu e só depois descobrir que o
  // update não pegou nada — o post estaria no perfil duas vezes.
  if (!PUBLICAVEIS.some((s) => s === candidato.status)) {
    return { tipo: "nao-publicavel", statusAtual: candidato.status };
  }

  let acessivel: string;
  try {
    acessivel = decryptSecret(token.cifrado, encryptionKey);
  } catch {
    return {
      tipo: "falhou",
      motivo: "não foi possível decifrar o acesso — reconecte o LinkedIn",
      acessoVencido: true,
    };
  }

  try {
    const publicado = await publishPost({
      accessToken: acessivel,
      authorUrn: memberUrn(token.subject),
      texto: candidato.editedBody ?? candidato.body,
    });

    // Os dois numa transação: um `published` sem linha em `publications`
    // perderia o link do post para sempre, e uma linha sem o status faria o
    // sistema achar que ainda há o que publicar — e publicar de novo.
    await db.transaction(async (tx) => {
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
        .where(
          and(
            eq(postCandidates.id, candidateId),
            inArray(postCandidates.status, [...PUBLICAVEIS]),
          ),
        );
    });

    return { tipo: "publicado", url: publicado.url };
  } catch (error) {
    // 401 é a única falha em que insistir não adianta: o acesso morreu e só o
    // dev resolve. Quem publica em lote usa isto para parar de tentar os
    // outros posts do mesmo dono, em vez de colecionar o mesmo erro.
    const acessoVencido = error instanceof LinkedInError && error.status === 401;

    return {
      tipo: "falhou",
      acessoVencido,
      motivo: acessoVencido
        ? "o acesso ao LinkedIn venceu — reconecte em Conexões e publique de novo"
        : error instanceof Error
          ? error.message
          : "erro desconhecido",
    };
  }
}
