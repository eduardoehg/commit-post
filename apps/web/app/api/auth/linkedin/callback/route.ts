/**
 * Volta da conexão com o LinkedIn — Fase 7.
 *
 * Troca o `code` por um access token e persiste em `oauth_tokens` COM
 * `expires_at`. O token de membro dura ~60 dias e refresh token de longa
 * duração não é concedido a todo app — por isso ele nunca vira env var: em
 * variável de ambiente ele quebraria em silêncio a cada dois meses, e o
 * sintoma seria "os posts pararam de sair" sem nada no log.
 *
 * Este é o token mais consequente do sistema: ele publica no perfil de outra
 * pessoa. Vai cifrado para o banco, como o de colaboração do GitHub.
 */

import { NextResponse, type NextRequest } from "next/server";
import { oauthTokens } from "@commitpost/core/db";
import { encryptSecret } from "@commitpost/core/crypto";
import { exchangeCodeForToken, fetchMember, type LinkedInToken } from "@commitpost/core/linkedin";
import { LINKEDIN_PROVIDER } from "@/lib/providers";
import { finishOAuth } from "@/lib/oauth";
import { backTo, db, env, requireUser } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await requireUser();

  const result = finishOAuth(request, "linkedin");
  if (!result.ok) return backTo("/onboarding", { erro: result.message });

  const configuration = env();
  const clientId = configuration.LINKEDIN_CLIENT_ID;
  const clientSecret = configuration.LINKEDIN_CLIENT_SECRET;
  const redirectUri = configuration.LINKEDIN_REDIRECT_URI;

  if (clientId === undefined || clientSecret === undefined || redirectUri === undefined) {
    return backTo("/onboarding", { erro: "As credenciais do LinkedIn não estão configuradas." });
  }

  let token: LinkedInToken;
  try {
    token = await exchangeCodeForToken({ clientId, clientSecret, code: result.code, redirectUri });
  } catch (error) {
    return backTo("/onboarding", { erro: (error as Error).message });
  }

  // Sem o URN do autor o token é inútil para publicar: o sistema teria acesso
  // e não saberia em nome de quem postar. Falhar aqui é melhor do que gravar
  // uma conexão que só quebra no dia do primeiro post.
  let membro;
  try {
    membro = await fetchMember(token.accessToken);
  } catch (error) {
    return backTo("/onboarding", { erro: (error as Error).message });
  }

  const agora = new Date();
  const cifrado = encryptSecret(token.accessToken, configuration.TOKEN_ENCRYPTION_KEY);

  await db()
    .insert(oauthTokens)
    .values({
      userId: user.id,
      provider: LINKEDIN_PROVIDER,
      accessTokenEncrypted: cifrado,
      refreshTokenEncrypted:
        token.refreshToken === null
          ? null
          : encryptSecret(token.refreshToken, configuration.TOKEN_ENCRYPTION_KEY),
      expiresAt: token.expiresAt,
      scope: token.scope,
      subject: membro.subject,
    })
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        accessTokenEncrypted: cifrado,
        refreshTokenEncrypted:
          token.refreshToken === null
            ? null
            : encryptSecret(token.refreshToken, configuration.TOKEN_ENCRYPTION_KEY),
        expiresAt: token.expiresAt,
        scope: token.scope,
        subject: membro.subject,
        updatedAt: agora,
      },
    });

  const dias = Math.round((token.expiresAt.getTime() - agora.getTime()) / 86_400_000);

  return backTo("/onboarding", {
    aviso:
      `LinkedIn conectado${membro.name === null ? "" : ` como ${membro.name}`}. ` +
      `O acesso vale ${String(dias)} dias — o bot avisa antes de vencer.`,
  });
}
