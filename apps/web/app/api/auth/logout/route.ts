/**
 * Sair.
 *
 * POST, não GET: um GET que destrói sessão pode ser disparado por qualquer
 * `<img>` numa página de terceiro, e o dev seria deslogado sem entender por
 * quê. Chato, não perigoso — mas não custa nada evitar.
 *
 * A linha some do banco, não só o cookie. Um cookie apagado no navegador
 * deixaria o token válido para quem já o tivesse copiado.
 */

import { NextResponse } from "next/server";
import { SESSION_COOKIE, destroySession } from "@commitpost/core/auth";
import { cookies } from "next/headers";
import { absoluteUrl, db } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  await destroySession(db(), jar.get(SESSION_COOKIE)?.value);

  const response = NextResponse.redirect(absoluteUrl("/"), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
