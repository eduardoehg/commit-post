/**
 * Volta do GitHub depois de instalar ou reconfigurar o App.
 *
 * Só é chamada se o operador preencher o campo *Setup URL* nas configurações
 * do App — e é opcional de propósito. Sem ela o fluxo continua inteiro, porque
 * quem descobre instalações é o login, perguntando ao GitHub em vez de esperar
 * ser avisado.
 *
 * Quando existe, o ganho é de conforto: o dev cai direto aqui em vez de ficar
 * parado numa tela do GitHub sem saber que precisa voltar.
 *
 * Repare que `installation_id` chega na query e é ignorado. Confiar nele seria
 * aceitar da URL o número de uma instalação que talvez não seja deste dev; a
 * lista autoritativa vem de `/user/installations`, com o token dele.
 */

import { NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.redirect(absoluteUrl("/api/auth/github/login"));
}
