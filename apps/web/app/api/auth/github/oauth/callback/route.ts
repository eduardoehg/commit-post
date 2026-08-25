/**
 * Volta da concessão de colaborações.
 *
 * Este token é o mais perigoso que o sistema guarda: escopo `repo`, que dá
 * escrita em tudo que o dev alcança. Três coisas acontecem aqui por causa
 * disso:
 *
 *   1. ele vai cifrado para o banco, nunca em claro;
 *   2. o escopo devolvido é registrado, para dar para auditar depois o que
 *      exatamente foi concedido;
 *   3. o token só é usado para LEITURA. O sistema não tem uma única chamada de
 *      escrita ao GitHub, e acrescentar uma é decisão a ser tomada de novo.
 */

import { NextResponse, type NextRequest } from "next/server";
import { oauthTokens } from "@commitpost/core/db";
import { encryptSecret } from "@commitpost/core/crypto";
import {
  exchangeCodeForToken,
  fetchViewer,
  type TokenExchange,
} from "@commitpost/core/github";
import { GITHUB_COLLAB_PROVIDER, cifrarOpcional } from "@/lib/providers";
import { proposeTermsFromCollaborations } from "@/lib/github-sync";
import { finishOAuth } from "@/lib/oauth";
import { absoluteUrl, backTo, db, env, requireUser } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await requireUser();

  const result = finishOAuth(request, "collab");
  if (!result.ok) return backTo("/onboarding", { erro: result.message });

  const configuration = env();
  const clientId = configuration.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = configuration.GITHUB_OAUTH_CLIENT_SECRET;

  if (clientId === undefined || clientSecret === undefined) {
    return backTo("/onboarding", { erro: "O OAuth App para colaborações não está configurado." });
  }

  let exchanged: TokenExchange;
  try {
    exchanged = await exchangeCodeForToken({
      clientId,
      clientSecret,
      code: result.code,
      redirectUri: absoluteUrl("/api/auth/github/oauth/callback"),
    });
  } catch (error) {
    return backTo("/onboarding", { erro: (error as Error).message });
  }

  // Autorizar com a conta errada é um erro fácil de cometer e difícil de
  // perceber: o dev fica com um token que não enxerga os commits dele e a tela
  // diz que está tudo certo. Conferir custa uma chamada.
  const grantee = await fetchViewer(exchanged.accessToken);
  if (grantee.id !== user.githubUserId) {
    return backTo("/onboarding", {
      erro:
        `A autorização veio da conta "${grantee.login}", que não é a sua. ` +
        `Saia dela no GitHub e tente de novo.`,
    });
  }

  const now = new Date();
  const encrypted = encryptSecret(exchanged.accessToken, configuration.TOKEN_ENCRYPTION_KEY);

  await db()
    .insert(oauthTokens)
    .values({
      userId: user.id,
      provider: GITHUB_COLLAB_PROVIDER,
      accessTokenEncrypted: encrypted,
      // O refresh token é o que evita o dev ter que reautorizar de tempos em
      // tempos. Ele estava sendo descartado aqui, e o sintoma era o acesso
      // morrer em oito horas sem ninguém entender por quê.
      refreshTokenEncrypted: cifrarOpcional(exchanged.refreshToken, configuration.TOKEN_ENCRYPTION_KEY),
      scope: exchanged.scope,
      expiresAt: exchanged.expiresAt,
      subject: String(grantee.id),
    })
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        accessTokenEncrypted: encrypted,
        refreshTokenEncrypted: cifrarOpcional(exchanged.refreshToken, configuration.TOKEN_ENCRYPTION_KEY),
        scope: exchanged.scope,
        expiresAt: exchanged.expiresAt,
        subject: String(grantee.id),
        updatedAt: now,
      },
    });

  // A proposta de denylist a partir das colaborações é o motivo principal de
  // fazer isto aqui e agora: é nos repositórios de outras pessoas que moram os
  // nomes que ninguém lembra de esconder. Falhar não desfaz a concessão — o
  // token já está gravado e serve à coleta.
  let propostos = 0;
  try {
    propostos = await proposeTermsFromCollaborations(user.id, grantee.login, exchanged.accessToken);
  } catch {
    return backTo("/onboarding", {
      aviso:
        "Colaborações conectadas, mas não deu para listar os repositórios agora. " +
        "Confira a lista de termos proibidos à mão antes do primeiro ciclo.",
    });
  }

  return backTo("/onboarding", {
    aviso:
      propostos === 0
        ? "Colaborações conectadas. O acesso é usado apenas para leitura."
        : `Colaborações conectadas. ${String(propostos)} nome(s) novo(s) entraram na lista de ` +
          `termos proibidos — revise antes do primeiro ciclo.`,
  });
}
