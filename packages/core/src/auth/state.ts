/**
 * Parâmetro `state` dos fluxos OAuth.
 *
 * Sem ele, qualquer pessoa consegue fazer o navegador de um dev logado abrir
 * nosso callback com um `code` de OUTRA conta do GitHub — e o dev acabaria com
 * a conta de um estranho vinculada à sua sessão. O `state` prova que o
 * redirecionamento partiu daqui.
 *
 * Assinado em HMAC e sem estado no servidor de propósito: guardar `state` em
 * tabela custaria uma escrita e uma leitura por login, e a validade de dez
 * minutos já é a janela toda.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Dez minutos: o tempo entre clicar em "entrar" e voltar do GitHub. */
export const STATE_TTL_SECONDS = 600;

export type StatePayload = Record<string, string>;

interface Envelope extends StatePayload {
  /** Impede que dois `state` com o mesmo conteúdo saiam idênticos. */
  n: string;
  /** Expiração, em segundos desde a época. */
  e: string;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signState(
  payload: StatePayload,
  secret: string,
  nowMs: number = Date.now(),
): string {
  const envelope: Envelope = {
    ...payload,
    n: randomBytes(9).toString("base64url"),
    e: String(Math.floor(nowMs / 1000) + STATE_TTL_SECONDS),
  };

  const body = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Devolve o payload, ou null se a assinatura não bate ou o prazo passou. */
export function verifyState(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): StatePayload | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const received = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(sign(body, secret));

  if (received.length !== expected.length) return null;
  if (!timingSafeEqual(received, expected)) return null;

  let envelope: Envelope;
  try {
    envelope = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Envelope;
  } catch {
    return null;
  }

  // A assinatura já garante que ninguém mexeu no prazo; esta checagem é só
  // sobre o tempo ter passado.
  const expiresAt = Number(envelope.e);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < nowMs) return null;

  const { n: _nonce, e: _expiry, ...payload } = envelope;
  return payload;
}
