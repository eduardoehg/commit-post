/**
 * Bot do Telegram — Fase 5.
 *
 * Webhook, não long polling.
 *
 * Duas travas de segurança, ambas obrigatórias:
 *   - header `X-Telegram-Bot-Api-Secret-Token` prova que a chamada veio do
 *     Telegram;
 *   - allowlist de `chat_id` prova que veio de VOCÊ. O secret sozinho não
 *     impede que qualquer pessoa que ache o bot converse com ele.
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

export function sendCandidates(): Promise<never> {
  throw new Error(NOT_IMPLEMENTED);
}

export function parseCallbackData(_data: string): never {
  throw new Error(NOT_IMPLEMENTED);
}
