/**
 * Manda o dev instalar o GitHub App.
 *
 * O GitHub decide sozinho o que mostrar: conta pessoal, organizações onde a
 * pessoa é admin, e a escolha de quais repositórios liberar. Não temos o que
 * parametrizar aqui além de para onde voltar.
 *
 * Depois de instalar, o dev volta pelo login (ver `/api/auth/github/login`), e
 * é lá que a instalação nova é descoberta.
 */

import { NextResponse } from "next/server";
import { installUrl } from "@commitpost/core/github";
import { env, requireUser } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await requireUser();
  return NextResponse.redirect(installUrl(env().GITHUB_APP_SLUG));
}
