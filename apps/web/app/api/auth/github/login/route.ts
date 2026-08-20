/**
 * Entrar com o GitHub.
 *
 * Esta rota é usada em dois momentos: o login de verdade e o "já instalei,
 * atualizar" da tela de introdução. É a mesma coisa de propósito — o callback
 * sempre ressincroniza instalações, e-mails e sugestões de denylist, e o
 * GitHub não mostra tela de consentimento a quem já autorizou. Para o dev, é
 * um piscar de tela; para nós, evita guardar um token de usuário só para poder
 * perguntar "instalou?".
 */

import { NextResponse } from "next/server";
import { authorizeUrl } from "@commitpost/core/github";
import { absoluteUrl, env } from "@/lib/runtime";
import { beginOAuth, oauthCookieOptions } from "@/lib/oauth";
import { OAUTH_COOKIE } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  const { state, nonce } = beginOAuth("app");

  const response = NextResponse.redirect(
    authorizeUrl({
      clientId: env().GITHUB_APP_CLIENT_ID,
      redirectUri: absoluteUrl("/api/auth/github/callback"),
      state,
    }),
  );

  response.cookies.set(OAUTH_COOKIE, nonce, oauthCookieOptions());
  return response;
}
