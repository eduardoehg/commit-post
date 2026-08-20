/**
 * Bot do Telegram — Fase 5.
 *
 * Webhook, não long polling.
 *
 * Duas travas de segurança, ambas obrigatórias:
 *   - header `X-Telegram-Bot-Api-Secret-Token` prova que a chamada veio do
 *     Telegram;
 *   - o chat precisa pertencer a um dev cadastrado e ativo. O secret sozinho
 *     não impede que qualquer pessoa que ache o bot converse com ele.
 *
 * A exceção à segunda regra é o `/start <código>`, que por definição chega de
 * um chat ainda desconhecido — é assim que o vínculo nasce. O que autoriza ali
 * é o código de uso único, com quinze minutos de validade.
 *
 * `callback_data` tem limite de 64 bytes — usar IDs curtos, nunca UUID.
 *
 * A mensagem de aprovação precisa mostrar a PROCEDÊNCIA (alias do repo, shas,
 * contagem de commits). Sem isso o gate humano é decorativo: não há como
 * perceber um vazamento que passou pelo filtro.
 */

const NOT_IMPLEMENTED = "Fase 5 — ainda não implementado";

/** Limite do Telegram para o payload de um botão inline. */
export const CALLBACK_DATA_MAX_BYTES = 64;

export type CallbackAction = "approve" | "reject" | "edit";

const API = "https://api.telegram.org";

export class TelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramError";
  }
}

async function callApi<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

  const body = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!body.ok || body.result === undefined) {
    throw new TelegramError(`Telegram recusou ${method}: ${body.description ?? "sem descrição"}`);
  }

  return body.result;
}

/**
 * O @username do bot, para montar o link `t.me/<bot>?start=<código>`.
 *
 * Perguntado ao Telegram em vez de exigido em variável de ambiente: é um dado
 * que o próprio token já determina, e uma variável a mais é uma variável a
 * mais para alguém preencher errado.
 */
export async function fetchBotUsername(token: string): Promise<string> {
  const me = await callApi<{ username?: string }>(token, "getMe");
  if (me.username === undefined) {
    throw new TelegramError("O bot não tem @username — verifique o token.");
  }
  return me.username;
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  await callApi(token, "sendMessage", { chat_id: chatId, text });
}

export function sendCandidates(): Promise<never> {
  throw new Error(NOT_IMPLEMENTED);
}

export function parseCallbackData(_data: string): never {
  throw new Error(NOT_IMPLEMENTED);
}
