/**
 * O que toda rota do app web precisa: ambiente validado, uma conexão e o dev
 * da sessão atual.
 *
 * O pool é criado uma vez por instância e reaproveitado. Abrir um por
 * requisição funcionaria, mas numa função serverless que recebe rajadas isso
 * vira dezenas de conexões contra o limite do Neon.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, resolveSession, type SessionUser } from "@commitpost/core/auth";
import { createDatabase, type Database } from "@commitpost/core/db";
import { loadWebEnv, type WebEnv } from "@commitpost/core/env";
import { OAUTH_COOKIE } from "./constants";

let cachedEnv: WebEnv | undefined;
let cachedDb: Database | undefined;

export function env(): WebEnv {
  cachedEnv ??= loadWebEnv();
  return cachedEnv;
}

export function db(): Database {
  cachedDb ??= createDatabase(env().DATABASE_URL);
  return cachedDb;
}

/** URL absoluta a partir de APP_BASE_URL — usada nos redirect_uri do OAuth. */
export function absoluteUrl(path: string): string {
  return new URL(path, env().APP_BASE_URL).toString();
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return resolveSession(db(), jar.get(SESSION_COOKIE)?.value);
}

/** Para páginas e ações que não fazem sentido sem dono. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (user === null) redirect("/");
  return user;
}

/**
 * Volta para uma tela com um recado.
 *
 * Erro de OAuth vira texto na tela, não stack trace: quem está no meio do
 * onboarding precisa saber o que fazer a seguir, e a mensagem já vem escrita
 * em português por quem a levantou.
 */
export function backTo(path: string, params: Record<string, string> = {}): NextResponse {
  const target = new URL(absoluteUrl(path));
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);

  const response = NextResponse.redirect(target, { status: 303 });
  // O nonce do OAuth serve a uma ida e volta só. Some aqui, dê certo ou não.
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}
