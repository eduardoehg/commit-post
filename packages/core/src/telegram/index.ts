/**
 * Bot do Telegram — Fase 5.
 *
 * É aqui que a terceira barreira acontece, e ela é a única que não é código: a
 * pessoa lê e decide. Por isso a mensagem precisa mostrar a PROCEDÊNCIA — de
 * quais repositórios e de quantos commits aquele texto saiu. Sem isso o gate
 * humano é decorativo: não há como perceber um vazamento que passou pelas duas
 * barreiras anteriores se o dev não sabe do que o post está falando.
 *
 * Webhook, não long polling.
 *
 * Duas travas de segurança, ambas obrigatórias:
 *   - header `X-Telegram-Bot-Api-Secret-Token` prova que a chamada veio do
 *     Telegram;
 *   - o chat precisa pertencer a um dev cadastrado e ativo, E o candidato
 *     precisa ser daquele dev. O secret sozinho não impede que qualquer pessoa
 *     que ache o bot converse com ele.
 *
 * A exceção à segunda regra é o `/start <código>`, que por definição chega de
 * um chat ainda desconhecido — é assim que o vínculo nasce. O que autoriza ali
 * é o código de uso único, com quinze minutos de validade.
 */

const API = "https://api.telegram.org";

/** Limite do Telegram para o payload de um botão inline. */
export const CALLBACK_DATA_MAX_BYTES = 64;

export type CallbackAction = "approve" | "reject";

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

// ---------------------------------------------------------------------------
// Botões
// ---------------------------------------------------------------------------

/**
 * `a:123` e `r:123`. Curto porque o Telegram corta em 64 bytes, e um payload
 * cortado vira uma decisão aplicada no candidato errado.
 *
 * O id do candidato é suficiente e o do usuário é deliberadamente omitido: quem
 * confere se o candidato é de quem clicou é o banco, no momento da decisão.
 * Levar o dono no botão convidaria alguém a trocá-lo.
 */
export function buildCallbackData(action: CallbackAction, candidateId: number): string {
  const dados = `${action === "approve" ? "a" : "r"}:${String(candidateId)}`;

  if (Buffer.byteLength(dados, "utf8") > CALLBACK_DATA_MAX_BYTES) {
    throw new TelegramError(`callback_data acima de ${String(CALLBACK_DATA_MAX_BYTES)} bytes.`);
  }
  return dados;
}

export interface ParsedCallback {
  action: CallbackAction;
  candidateId: number;
}

/** Devolve null para qualquer coisa que não tenha saído de `buildCallbackData`. */
export function parseCallbackData(data: string): ParsedCallback | null {
  const match = /^([ar]):(\d{1,15})$/.exec(data);
  if (match === null) return null;

  const candidateId = Number(match[2]);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) return null;

  return { action: match[1] === "a" ? "approve" : "reject", candidateId };
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export interface Procedencia {
  /** Aliases dos repositórios. NUNCA o nome real. */
  aliases: readonly string[];
  commitCount: number;
  shas: readonly string[];
  windowStart: Date;
  windowEnd: Date;
}

/** Quantos shas cabem antes de a mensagem virar parede de texto. */
const SHAS_MOSTRADOS = 8;

function dataCurta(d: Date): string {
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}

/**
 * O cabeçalho do lote.
 *
 * Só alias, contagem e sha curto. Um sha não identifica empresa nem cliente, e
 * é o que permite ao dev reencontrar exatamente o commit se algo parecer
 * errado — que é a função inteira desta mensagem.
 */
export function formatProvenance(p: Procedencia, angulos: readonly string[]): string {
  const linhas = [
    `Posts para aprovar — ${dataCurta(p.windowStart)} a ${dataCurta(p.windowEnd)}`,
    "",
    `De ${String(p.commitCount)} commit(s) em: ${p.aliases.join(", ")}`,
  ];

  if (p.shas.length > 0) {
    const curtos = p.shas.slice(0, SHAS_MOSTRADOS).map((s) => s.slice(0, 7));
    const resto = p.shas.length - curtos.length;
    linhas.push(`${curtos.join(" ")}${resto > 0 ? ` (+${String(resto)})` : ""}`);
  }

  linhas.push("", "Opções:");
  angulos.forEach((angulo, i) => linhas.push(`${String(i + 1)}. ${angulo}`));
  linhas.push("", "Nada é publicado sem você aprovar.");

  return linhas.join("\n");
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export function buildKeyboard(candidateId: number, numero: number): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: `✅ Aprovar ${String(numero)}`, callback_data: buildCallbackData("approve", candidateId) },
        { text: `❌ Recusar ${String(numero)}`, callback_data: buildCallbackData("reject", candidateId) },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<number> {
  const enviado = await callApi<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text,
    // Sem `parse_mode` de propósito: o corpo do post é texto de gente e pode
    // conter `<`, `&` ou `_`. Em modo HTML ou Markdown, um caractere desses
    // faz o Telegram recusar a mensagem inteira — e o dev fica sem post sem
    // entender por quê.
    ...(keyboard === undefined ? {} : { reply_markup: keyboard }),
  });

  return enviado.message_id;
}

export interface CandidatoParaEnvio {
  id: number;
  angulo: string;
  texto: string;
}

/**
 * Manda o lote: um cabeçalho com procedência e uma mensagem por candidato.
 *
 * O texto do post vai SOZINHO na mensagem dele, sem rótulo nem enfeite, para
 * que copiar e colar no LinkedIn não traga junto nada nosso. Enquanto a
 * publicação automática não existe, copiar é o caminho — e é o que precisa
 * funcionar sem atrito.
 */
export async function sendCandidates(options: {
  token: string;
  chatId: string;
  candidatos: readonly CandidatoParaEnvio[];
  procedencia: Procedencia;
}): Promise<number> {
  const { token, chatId, candidatos, procedencia } = options;
  if (candidatos.length === 0) return 0;

  await sendMessage(token, chatId, formatProvenance(procedencia, candidatos.map((c) => c.angulo)));

  let enviados = 0;
  for (const [indice, candidato] of candidatos.entries()) {
    await sendMessage(token, chatId, candidato.texto, buildKeyboard(candidato.id, indice + 1));
    enviados += 1;
  }

  return enviados;
}

/** Para o botão parar de girar. Sem isto o dev acha que nada aconteceu. */
export async function answerCallback(
  token: string,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await callApi(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    // 200 é o limite do Telegram para o aviso curto.
    text: text.slice(0, 200),
  });
}

/**
 * Tira os botões e diz o que foi decidido.
 *
 * Editar em vez de mandar mensagem nova é o que impede o dev de clicar duas
 * vezes no mesmo lote e o que deixa o histórico do chat legível depois.
 */
export async function markDecided(
  token: string,
  chatId: string,
  messageId: number,
  legenda: string,
): Promise<void> {
  await callApi(token, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [[{ text: legenda, callback_data: "x" }]] },
  });
}
