/**
 * Conectar o LinkedIn — Fase 7.
 *
 * O `state` é assinado E amarrado a um cookie deste navegador, pelo mesmo
 * motivo dos fluxos do GitHub: a assinatura prova que saiu daqui, o cookie
 * prova que saiu deste navegador. Aqui a consequência de não ter as duas seria
 * um dev com a conta de LinkedIn de outra pessoa vinculada — e posts dele
 * saindo no perfil errado.
 */

import { NextResponse } from "next/server";
import { authorizeUrl } from "@commitpost/core/linkedin";
import { OAUTH_COOKIE } from "@/lib/constants";
import { beginOAuth, oauthCookieOptions } from "@/lib/oauth";
import { backTo, env, requireUser } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await requireUser();

  const configuration = env();
  const clientId = configuration.LINKEDIN_CLIENT_ID;
  const redirectUri = configuration.LINKEDIN_REDIRECT_URI;

  if (clientId === undefined || redirectUri === undefined) {
    return backTo("/onboarding", {
      erro: "O operador ainda não configurou as credenciais do LinkedIn.",
    });
  }

  const { state, nonce } = beginOAuth("linkedin");

  // O `redirect_uri` vem da variável, e não de `absoluteUrl`, de propósito:
  // ele precisa bater CARACTERE A CARACTERE com o registrado no portal do
  // LinkedIn. Derivá-lo esconderia a divergência até o meio do fluxo.
  const response = NextResponse.redirect(authorizeUrl({ clientId, redirectUri, state }));

  response.cookies.set(OAUTH_COOKIE, nonce, oauthCookieOptions());
  return response;
}
