/**
 * Volta do login com o GitHub.
 *
 * Aqui acontece a única coisa que impede o sistema de virar cadastro aberto:
 * a allowlist de logins. "Entrar com GitHub", sozinho, deixaria qualquer
 * pessoa do mundo criar conta e passar a consumir a chave da Anthropic do
 * operador.
 *
 * O token de usuário do GitHub vive dentro desta função e não é gravado em
 * lugar nenhum. Ele serve para descobrir quem é o dev, quais instalações
 * existem e quais e-mails são dele — e morre no fim da requisição.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  purgeExpiredSessions,
} from "@commitpost/core/auth";
import { users } from "@commitpost/core/db";
import { exchangeCodeForToken, fetchViewer } from "@commitpost/core/github";
import { absoluteUrl, backTo, db, env } from "@/lib/runtime";
import { finishOAuth } from "@/lib/oauth";
import { syncFromGitHub } from "@/lib/github-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Comparação por login, sem diferenciar maiúsculas — o GitHub também não. */
function isAllowed(login: string, allowlist: readonly string[]): boolean {
  return allowlist.some((l) => l.toLowerCase() === login.toLowerCase());
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = finishOAuth(request, "app");
  if (!result.ok) return backTo("/", { erro: result.message });

  const configuration = env();
  const database = db();

  let viewerToken: string;
  try {
    const exchanged = await exchangeCodeForToken({
      clientId: configuration.GITHUB_APP_CLIENT_ID,
      clientSecret: configuration.GITHUB_APP_CLIENT_SECRET,
      code: result.code,
      redirectUri: absoluteUrl("/api/auth/github/callback"),
    });
    viewerToken = exchanged.accessToken;
  } catch (error) {
    return backTo("/", { erro: (error as Error).message });
  }

  const viewer = await fetchViewer(viewerToken);

  if (!isAllowed(viewer.login, configuration.ALLOWED_GITHUB_LOGINS)) {
    // Diz o login recusado de propósito: quem chegou aqui já provou ser dono
    // da conta, e a causa mais comum é o operador ter escrito outro nome na
    // allowlist. Esconder o motivo só geraria uma mensagem no WhatsApp.
    return backTo("/", {
      erro:
        `A conta "${viewer.login}" não está na lista de acesso. ` +
        `Peça ao operador para incluí-la em ALLOWED_GITHUB_LOGINS.`,
    });
  }

  const now = new Date();

  // O id numérico é a identidade; o login pode ser trocado pelo dono a
  // qualquer momento e por isso é atualizado, nunca usado para reconhecer.
  const inserted = await database
    .insert(users)
    .values({
      githubUserId: viewer.id,
      githubLogin: viewer.login,
      displayName: viewer.name,
      avatarUrl: viewer.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.githubUserId,
      set: {
        githubLogin: viewer.login,
        displayName: viewer.name,
        avatarUrl: viewer.avatarUrl,
        updatedAt: now,
      },
    })
    .returning({ id: users.id, active: users.active });

  const account = inserted[0];
  if (account === undefined) return backTo("/", { erro: "Não foi possível criar sua conta." });

  if (!account.active) {
    return backTo("/", {
      erro: "Esta conta está desativada. Fale com o operador do sistema.",
    });
  }

  const sync = await syncFromGitHub(account.id, viewer, viewerToken);

  await purgeExpiredSessions(database);
  const session = await createSession(database, account.id);

  const response = backTo(
    "/onboarding",
    sync.emailsUnavailable
      ? {
          aviso:
            "O GitHub App está sem a permissão de leitura de e-mails, então seus " +
            "e-mails de autor precisam ser informados à mão abaixo.",
        }
      : {},
  );

  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: configuration.APP_BASE_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return response;
}
