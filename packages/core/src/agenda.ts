/**
 * Quando o post vai ao ar — Fase 8.
 *
 * Tudo aqui é puro e recebe o relógio de fora. Não é preciosismo: a única
 * alternativa para testar "amanhã às 9h no horário de Brasília" seria esperar
 * até amanhã.
 *
 * A regra que atravessa o arquivo inteiro: o banco guarda UTC, sempre. O fuso
 * do dev serve para INTERPRETAR a escolha ("9h" de quem?) e para EXIBIR a data
 * depois. Guardar hora local seria guardar um número que muda de significado
 * quando a pessoa troca de fuso — e o post sairia na hora errada sem nada ter
 * sido alterado.
 *
 * Nenhuma biblioteca de datas. `Intl.DateTimeFormat` já sabe o fuso de todo
 * mundo e vem com o Node; o que falta é a volta — de hora local para instante
 * — que são as vinte linhas de `instanteDe`.
 */

/** A hora dos atalhos oferecidos no Telegram. */
export const HORA_PADRAO = 9;

/**
 * Até onde se pode agendar.
 *
 * Noventa dias não é limite técnico, é limite de sentido: post sobre trabalho
 * de três meses atrás não descreve mais o que a pessoa faz. E um campo de data
 * sem teto aceita o ano 3000 por engano de digitação, que ninguém percebe
 * até o post nunca sair.
 */
export const HORIZONTE_DIAS = 90;

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function numero(mapa: Record<string, string>, chave: string): number {
  const valor = mapa[chave];
  if (valor === undefined) throw new Error(`Intl não devolveu "${chave}"`);
  return Number(valor);
}

/** Que horas são, neste instante, naquele fuso. */
function partesNoFuso(instante: Date, fuso: string): Partes {
  const formato = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const mapa: Record<string, string> = {};
  for (const parte of formato.formatToParts(instante)) mapa[parte.type] = parte.value;

  return {
    ano: numero(mapa, "year"),
    mes: numero(mapa, "month"),
    dia: numero(mapa, "day"),
    // Meia-noite sai como "24" em alguns ambientes com hour12: false.
    hora: numero(mapa, "hour") % 24,
    minuto: numero(mapa, "minute"),
    segundo: numero(mapa, "second"),
  };
}

/** Quanto o fuso está adiantado em relação a UTC, naquele instante. */
function deslocamentoMs(instante: Date, fuso: string): number {
  const p = partesNoFuso(instante, fuso);
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - instante.getTime();
}

/**
 * O caminho de volta: hora do relógio de parede naquele fuso → instante real.
 *
 * Duas passagens, e a segunda não é zelo. O deslocamento depende do instante,
 * e o instante é justamente o que se está procurando — então a primeira conta
 * usa o deslocamento do palpite. Quando o palpite cai do outro lado de uma
 * mudança de horário de verão, ele é o deslocamento errado, e a segunda
 * passagem corrige. O Brasil não tem mais horário de verão, mas o dev que
 * mudar de país teria posts saindo uma hora fora por seis meses do ano.
 */
export function instanteDe(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  fuso: string,
): Date {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const primeira = palpite - deslocamentoMs(new Date(palpite), fuso);
  return new Date(palpite - deslocamentoMs(new Date(primeira), fuso));
}

/**
 * Daqui a tantos dias, às 9h no fuso do dev.
 *
 * A conta é feita sobre a DATA local — dia do calendário, sem hora — e a hora
 * só é aplicada no fim, por `instanteDe`. É de lá que vem a resistência ao
 * horário de verão: o deslocamento é recalculado para o dia de destino, não
 * herdado do dia de hoje.
 *
 * (`calendario` é um marcador à meia-noite UTC, então somar dias ou somar
 * 86.400.000 ms dá no mesmo aqui. A diferença estaria em somar sobre um
 * instante local — que é justamente o que este desenho evita.)
 */
export function daquiADias(agora: Date, fuso: string, dias: number, hora = HORA_PADRAO): Date {
  const hoje = partesNoFuso(agora, fuso);

  const calendario = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia));
  calendario.setUTCDate(calendario.getUTCDate() + dias);

  return instanteDe(
    calendario.getUTCFullYear(),
    calendario.getUTCMonth() + 1,
    calendario.getUTCDate(),
    hora,
    0,
    fuso,
  );
}

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Como a data aparece para o dev: "qua 27/08 09h".
 *
 * Com o dia da semana porque o atalho é escolhido de relance, e "27/08" sozinho
 * não diz se cai num sábado. Sem o ano porque nada aqui passa de noventa dias.
 */
export function rotularInstante(quando: Date, fuso: string): string {
  const p = partesNoFuso(quando, fuso);
  const semana = DIAS_SEMANA[new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay()] ?? "";
  const minuto = p.minuto === 0 ? "" : doisDigitos(p.minuto);

  return `${semana} ${doisDigitos(p.dia)}/${doisDigitos(p.mes)} ${doisDigitos(p.hora)}h${minuto}`;
}

export interface OpcaoDeAgendamento {
  /** Vai no `callback_data` do botão. Curto porque lá cabem 64 bytes. */
  id: number;
  dias: number;
  rotulo: string;
  quando: Date;
}

/**
 * Os atalhos do Telegram.
 *
 * Um, três e sete dias — espaçados de propósito. Quem aprova três posts de uma
 * vez quer distribuí-los, e oferecer "amanhã, depois, terça" empilharia tudo na
 * mesma semana. Data exata fica no painel, onde existe um campo de verdade;
 * botão de Telegram não é lugar de escolher dia 14 às 17h30.
 */
export const DIAS_OFERECIDOS = [1, 3, 7] as const;

export function opcoesDeAgendamento(agora: Date, fuso: string): OpcaoDeAgendamento[] {
  return DIAS_OFERECIDOS.map((dias, indice) => {
    const quando = daquiADias(agora, fuso, dias);
    return { id: indice + 1, dias, rotulo: rotularInstante(quando, fuso), quando };
  });
}

/** Traduz o id que voltou do botão de volta para o instante. */
export function opcaoPorId(
  agora: Date,
  fuso: string,
  id: number,
): OpcaoDeAgendamento | null {
  return opcoesDeAgendamento(agora, fuso).find((o) => o.id === id) ?? null;
}

export type ProblemaDeAgendamento = "passado" | "longe-demais";

/**
 * O horário escolhido serve?
 *
 * Vale para o campo livre do painel, que é onde entra data digitada. O atalho
 * do Telegram nunca cai nestes casos — mas a checagem não vive lá, vive aqui,
 * porque quem valida precisa ser quem grava, e não quem desenha o botão.
 *
 * "Passado" recusa em vez de publicar na hora: a diferença entre agendar para
 * ontem e publicar agora é grande demais para o sistema decidir sozinho, e
 * quem digitou a data errada precisa saber disso.
 */
export function validarAgendamento(
  quando: Date,
  agora: Date = new Date(),
): ProblemaDeAgendamento | null {
  if (Number.isNaN(quando.getTime())) return "passado";
  if (quando.getTime() <= agora.getTime()) return "passado";
  if (quando.getTime() > agora.getTime() + HORIZONTE_DIAS * 86_400_000) return "longe-demais";
  return null;
}

export function textoDoProblema(problema: ProblemaDeAgendamento): string {
  return problema === "passado"
    ? "Esse horário já passou. Escolha um no futuro."
    : `Longe demais — o limite é ${String(HORIZONTE_DIAS)} dias.`;
}

/**
 * O fuso é conhecido?
 *
 * Fuso inválido faz `Intl` estourar, e isso aconteceria na hora de agendar —
 * longe do lugar onde o valor foi digitado. Aqui a resposta é o padrão, que
 * mantém o recurso funcionando enquanto alguém corrige.
 */
export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

export const FUSO_PADRAO = "America/Sao_Paulo";

export function fusoOuPadrao(fuso: string | null | undefined): string {
  return fuso !== null && fuso !== undefined && fusoValido(fuso) ? fuso : FUSO_PADRAO;
}
