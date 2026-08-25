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
import { count, eq } from "drizzle-orm";
import { decideAccess, userEmails, users } from "@commitpost/core/db";
import { exchangeCodeForToken, fetchViewer } from "@commitpost/core/github";
import { absoluteUrl, backTo, db, env } from "@/lib/runtime";
import { finishOAuth } from "@/lib/oauth";
import { syncFromGitHub } from "@/lib/github-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


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

  // A lista vive no banco desde a reforma do painel; a variável de ambiente
  // continua valendo como semente do primeiro dono e como escotilha para o dia
  // em que ninguém conseguir entrar.
  const acesso = await decideAccess(database, viewer.login, configuration.ALLOWED_GITHUB_LOGINS);

  if (!acesso.permitido) {
    // Diz o login recusado de propósito: quem chegou aqui já provou ser dono
    // da conta, e a causa mais comum é terem convidado outro nome. Esconder o
    // motivo só geraria uma mensagem no WhatsApp.
    return backTo("/", {
      erro:
        `A conta "${viewer.login}" não tem acesso ao CommitPost. ` +
        `Peça a quem administra o sistema para liberar este login.`,
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
      // Só na criação. Um login seguinte nunca muda papel — promoção não é
      // efeito colateral de entrar.
      role: acesso.seraDono ? "owner" : "dev",
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
    .returning({
      id: users.id,
      active: users.active,
      telegramChatId: users.telegramChatId,
    });

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

  // Para onde levar depois de entrar: quem ainda tem conexão obrigatória
  // faltando cai na introdução; quem já configurou cai no histórico. É o que
  // faz a tela de configuração sumir sozinha quando deixa de ser necessária.
  const emailsTotal = await database
    .select({ n: count() })
    .from(userEmails)
    .where(eq(userEmails.userId, account.id));

  const configurado =
    sync.installations > 0 && (emailsTotal[0]?.n ?? 0) > 0 && account.telegramChatId !== null;

  const response = backTo(
    configurado ? "/inicio" : "/onboarding",
    sync.emailsUnavailable
      ? {
          aviso:
            "O GitHub App está sem a permissão de leitura de e-mails, então seus " +
            "e-mails de autor precisam ser informados à mão.",
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
