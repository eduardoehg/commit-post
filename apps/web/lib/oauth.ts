/**
 * Início e fim dos fluxos OAuth do GitHub.
 *
 * O `state` é assinado por nós E amarrado a um cookie deste navegador. As duas
 * coisas são necessárias por motivos diferentes:
 *
 *   - a assinatura prova que o `state` saiu daqui;
 *   - o cookie prova que saiu DESTE navegador.
 *
 * Só a assinatura não bastaria: qualquer pessoa pode abrir nossa rota de login
 * e receber um `state` válido, montar a URL de callback com um `code` da
 * própria conta e induzir um dev a abri-la. O dev terminaria com a conta de um
 * estranho vinculada à sessão dele, sem perceber nada.
 */

import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { signState, verifyState, type StatePayload } from "@commitpost/core/auth";
import { OAUTH_COOKIE } from "./constants";
import { env } from "./runtime";

/** O mesmo prazo do `state`, para os dois vencerem juntos. */
const OAUTH_COOKIE_MAX_AGE = 600;

export type OAuthKind = "app" | "collab" | "linkedin";

function fingerprint(nonce: string): string {
  return createHash("sha256").update(nonce).digest("base64url");
}

/**
 * `secure` sai de APP_BASE_URL, e não de NODE_ENV: em desenvolvimento a URL é
 * http e um cookie `secure` seria descartado em silêncio — o login falharia
 * com "não foi possível confirmar" sem nada explicando por quê.
 */
export function oauthCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: env().APP_BASE_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  };
}

/** Gera o `state` e o valor do cookie que precisa acompanhá-lo na resposta. */
export function beginOAuth(
  kind: OAuthKind,
  extra: StatePayload = {},
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const state = signState({ ...extra, k: kind, b: fingerprint(nonce) }, env().PANEL_TOKEN_SECRET);
  return { state, nonce };
}

export type OAuthReturn =
  | { ok: true; code: string; payload: StatePayload }
  | { ok: false; message: string };

/** Valida a volta do GitHub: erro declarado, `state`, cookie e `code`. */
export function finishOAuth(request: NextRequest, kind: OAuthKind): OAuthReturn {
  const params = request.nextUrl.searchParams;

  const declaredError = params.get("error");
  if (declaredError !== null) {
    return {
      ok: false,
      message:
        declaredError === "access_denied"
          ? "Você cancelou a autorização no GitHub."
          : `O GitHub recusou a autorização (${declaredError}).`,
    };
  }

  const nonce = request.cookies.get(OAUTH_COOKIE)?.value;
  const payload = verifyState(params.get("state") ?? "", env().PANEL_TOKEN_SECRET);

  if (payload === null || nonce === undefined || payload["b"] !== fingerprint(nonce)) {
    return {
      ok: false,
      message:
        "Não foi possível confirmar que este retorno partiu daqui. " +
        "Acontece quando o link demora demais ou é aberto em outro navegador. Tente de novo.",
    };
  }

  if (payload["k"] !== kind) {
    return { ok: false, message: "Retorno de autorização veio de um fluxo diferente do esperado." };
  }

  const code = params.get("code");
  if (code === null || code === "") {
    return { ok: false, message: "O GitHub não devolveu o código de autorização." };
  }

  return { ok: true, code, payload };
}
