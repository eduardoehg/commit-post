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

/**
 * O que os botões oferecem.
 *
 * `menu` e `voltar` não decidem nada — só trocam o teclado da mensagem entre
 * "o que fazer com este post" e "para quando". O Telegram não tem submenu; a
 * única forma de ter dois níveis é reescrever o teclado no lugar.
 */
export type CallbackAction = "publish" | "schedule" | "reject" | "menu" | "voltar";

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

const LETRA_DA_ACAO: Record<CallbackAction, string> = {
  publish: "p",
  schedule: "s",
  reject: "r",
  menu: "g",
  voltar: "v",
};

const ACAO_DA_LETRA: Record<string, CallbackAction> = {
  p: "publish",
  s: "schedule",
  r: "reject",
  g: "menu",
  v: "voltar",
};

/**
 * `p:123`, `r:123`, `s:123:2`. Curto porque o Telegram corta em 64 bytes em vez
 * de recusar, e um payload cortado vira decisão aplicada no candidato errado.
 *
 * O id do candidato é suficiente e o do dono é deliberadamente omitido: quem
 * confere se o candidato é de quem clicou é o banco, no momento da decisão.
 * Levar o dono no botão convidaria alguém a trocá-lo.
 *
 * O horário do agendamento também fica de fora: vai o ÍNDICE da opção, e o
 * instante é recalculado no servidor a partir dele. Uma data no botão seria um
 * dado de fora decidindo quando um post vai ao ar.
 */
export function buildCallbackData(
  action: CallbackAction,
  candidateId: number,
  slot?: number,
): string {
  const sufixo = slot === undefined ? "" : `:${String(slot)}`;
  const dados = `${LETRA_DA_ACAO[action]}:${String(candidateId)}${sufixo}`;

  if (Buffer.byteLength(dados, "utf8") > CALLBACK_DATA_MAX_BYTES) {
    throw new TelegramError(`callback_data acima de ${String(CALLBACK_DATA_MAX_BYTES)} bytes.`);
  }
  return dados;
}

export interface ParsedCallback {
  action: CallbackAction;
  candidateId: number;
  /** Qual atalho de horário. Só existe em `schedule`. */
  slot: number | null;
}

/** Devolve null para qualquer coisa que não tenha saído de `buildCallbackData`. */
export function parseCallbackData(data: string): ParsedCallback | null {
  const match = /^([prsgv]):(\d{1,15})(?::(\d{1,2}))?$/.exec(data);
  if (match === null) return null;

  const candidateId = Number(match[2]);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) return null;

  const action = ACAO_DA_LETRA[match[1] ?? ""];
  if (action === undefined) return null;

  const slot = match[3] === undefined ? null : Number(match[3]);

  // Agendar sem dizer para quando não é uma decisão — e seguir com o slot
  // nulo publicaria na hora um post que a pessoa quis adiar.
  if (action === "schedule" && slot === null) return null;

  return { action, candidateId, slot };
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
export function formatProvenance(
  p: Procedencia,
  candidatos: readonly CandidatoParaEnvio[],
): string {
  const linhas = [
    `Posts para decidir — ${dataCurta(p.windowStart)} a ${dataCurta(p.windowEnd)}`,
    "",
    `De ${String(p.commitCount)} commit(s) em: ${p.aliases.join(", ")}`,
  ];

  if (p.shas.length > 0) {
    const curtos = p.shas.slice(0, SHAS_MOSTRADOS).map((s) => s.slice(0, 7));
    const resto = p.shas.length - curtos.length;
    linhas.push(`${curtos.join(" ")}${resto > 0 ? ` (+${String(resto)})` : ""}`);
  }

  const grupos = [...new Set(candidatos.map((c) => c.grupo))];

  // A frase mais importante da mensagem, e a que muda conforme o lote.
  //
  // Com um assunto só, os textos são versões da mesma história: aprovar um
  // encerra os outros, e quem não souber disso vai achar que perdeu dois
  // posts. Com vários assuntos é o contrário — deixar de dizer que dá para
  // publicar todos faz o dev escolher um e descartar trabalho bom.
  if (grupos.length > 1) {
    linhas.push("", `${String(grupos.length)} assuntos diferentes — pode publicar todos:`);
    candidatos.forEach((c, i) => linhas.push(`${String(i + 1)}. ${c.tema}`));
    linhas.push("", "Agende em dias diferentes para não sair tudo junto.");
  } else {
    linhas.push("", "Um assunto, em versões — só uma vai ao ar:");
    candidatos.forEach((c, i) => linhas.push(`${String(i + 1)}. ${c.angulo}`));
  }

  linhas.push("", "Nada é publicado sem você decidir.");

  return linhas.join("\n");
}

export interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

/**
 * O teclado de decisão: publicar agora, marcar hora, ou recusar.
 *
 * Publicar e agendar em cima, recusar embaixo e sozinho. Não é estética: os
 * três seriam uma fileira de alvos do mesmo tamanho num celular, e o que
 * separa "vai ao ar no meu perfil" de "some para sempre" seria meio centímetro
 * de polegar.
 */
export function buildKeyboard(candidateId: number): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "🚀 Publicar agora", callback_data: buildCallbackData("publish", candidateId) },
        { text: "🗓 Agendar", callback_data: buildCallbackData("menu", candidateId) },
      ],
      [{ text: "❌ Recusar", callback_data: buildCallbackData("reject", candidateId) }],
    ],
  };
}

export interface OpcaoDeHorario {
  id: number;
  rotulo: string;
}

/**
 * O segundo nível: para quando.
 *
 * Um horário por linha porque o rótulo tem dia da semana e data, e três deles
 * lado a lado ficam ilegíveis num celular. "Voltar" existe para quem tocou em
 * agendar sem querer não ter que escolher uma data para escapar.
 */
export function buildScheduleKeyboard(
  candidateId: number,
  opcoes: readonly OpcaoDeHorario[],
): InlineKeyboard {
  return {
    inline_keyboard: [
      ...opcoes.map((opcao) => [
        {
          text: `🗓 ${opcao.rotulo}`,
          callback_data: buildCallbackData("schedule", candidateId, opcao.id),
        },
      ]),
      [{ text: "‹ voltar", callback_data: buildCallbackData("voltar", candidateId) }],
    ],
  };
}

/** Troca o teclado de uma mensagem sem mexer no texto dela. */
export async function replaceKeyboard(
  token: string,
  chatId: string,
  messageId: number,
  keyboard: InlineKeyboard,
): Promise<void> {
  await callApi(token, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: keyboard,
  });
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
  /** Qual assunto do lote. Textos do mesmo grupo são versões um do outro. */
  grupo: number;
  tema: string;
  angulo: string;
  texto: string;
}

/**
 * Manda o lote: um cabeçalho com procedência e uma mensagem por candidato.
 *
 * O texto do post vai SOZINHO na mensagem dele, sem rótulo nem enfeite. Mesmo
 * com a publicação automática funcionando, copiar e colar continua sendo a
 * saída quando o LinkedIn recusa — e é o que precisa funcionar sem atrito
 * justamente no dia em que algo deu errado.
 */
export async function sendCandidates(options: {
  token: string;
  chatId: string;
  candidatos: readonly CandidatoParaEnvio[];
  procedencia: Procedencia;
}): Promise<{ candidateId: number; messageId: number }[]> {
  const { token, chatId, candidatos, procedencia } = options;
  if (candidatos.length === 0) return [];

  await sendMessage(token, chatId, formatProvenance(procedencia, candidatos));

  const enviados: { candidateId: number; messageId: number }[] = [];
  for (const candidato of candidatos) {
    const messageId = await sendMessage(token, chatId, candidato.texto, buildKeyboard(candidato.id));
    enviados.push({ candidateId: candidato.id, messageId });
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
