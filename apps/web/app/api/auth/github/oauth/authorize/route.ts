/**
 * Passo opcional: alcançar repositórios de colaboração.
 *
 * Este é o caminho que pede escopo `repo` — leitura E escrita, porque
 * `repo:read` não existe no OAuth clássico. É o único lugar do sistema onde
 * pedimos mais poder do que usamos, e existe porque a alternativa é não
 * enxergar os repositórios de outras pessoas onde o dev trabalha.
 *
 * A rota exige sessão e é acionada por um botão que explica o alcance em
 * português. Ninguém chega aqui sem ter lido o que está concedendo.
 */

import { NextResponse } from "next/server";
import { COLLABORATION_SCOPE, authorizeUrl } from "@commitpost/core/github";
import { OAUTH_COOKIE } from "@/lib/constants";
import { beginOAuth, oauthCookieOptions } from "@/lib/oauth";
import { absoluteUrl, backTo, env, requireUser } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await requireUser();

  const clientId = env().GITHUB_OAUTH_CLIENT_ID;
  if (clientId === undefined) {
    return backTo("/onboarding", {
      erro:
        "O operador ainda não configurou o OAuth App para colaborações. " +
        "Enquanto isso, repositórios de outras pessoas ficam de fora.",
    });
  }

  const { state, nonce } = beginOAuth("collab");

  const response = NextResponse.redirect(
    authorizeUrl({
      clientId,
      redirectUri: absoluteUrl("/api/auth/github/oauth/callback"),
      state,
      scope: COLLABORATION_SCOPE,
    }),
  );

  response.cookies.set(OAUTH_COOKIE, nonce, oauthCookieOptions());
  return response;
}
