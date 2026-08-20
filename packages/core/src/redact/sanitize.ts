/**
 * Higienização: apaga trechos estruturalmente perigosos de um texto.
 *
 * Isto é uma DENYLIST, e denylist sozinha não é garantia de nada — por isso
 * ela não é a defesa principal do sistema. A defesa principal é o vocabulário
 * fechado em `vocabulary.ts`: nada que não esteja lá é copiado para a saída.
 *
 * Esta camada tem dois papéis bem menores, e nenhum deles é "garantir que o
 * texto é seguro":
 *
 *   1. Na barreira 1, impedir que um termo do vocabulário seja colhido de
 *      dentro de um trecho sensível. Sem ela, `redis.cliente-x.internal`
 *      renderia a tecnologia "Redis" e o commit passaria a contar como
 *      relevante por causa de um host interno.
 *   2. Na barreira 2, varrer o texto que o LLM gerou — onde não existe
 *      vocabulário fechado possível, porque a saída precisa ser português
 *      corrente.
 */

import { escapeForRegExp } from "./vocabulary";

/**
 * `input`  — mensagem de commit; pode ser destruída à vontade, só serve de
 *            insumo para casar vocabulário.
 * `output` — texto gerado pelo LLM; precisa continuar legível, então padrões
 *            que destroem prosa legítima ficam de fora.
 */
export type MaskPhase = "input" | "output";

export interface MaskOptions {
  /** O que colocar no lugar. Padrão: um espaço. */
  readonly replacement?: string;
  /**
   * Termos literais a remover além dos padrões: alias do repositório, nomes de
   * empresas e clientes. Esta lista é ela própria confidencial — ela nunca
   * deve ser commitada, e por isso entra por parâmetro em vez de ficar aqui.
   */
  readonly extraTerms?: readonly string[];
  /**
   * Termos legítimos que os detectores comeriam por engano e que devem sair
   * intactos. Ver `PROTECTED_LITERALS` em `vocabulary.ts`.
   */
  readonly protectedTerms?: readonly string[];
  /** Padrão: `input`, o modo mais agressivo. */
  readonly phase?: MaskPhase;
}

export interface MaskResult {
  readonly text: string;
  /** O que foi retirado, sem repetição, na ordem em que apareceu. */
  readonly removed: readonly string[];
}

/** Teto para a lista de reporte; o texto é sempre limpo por inteiro. */
const MAX_REPORTED = 50;

/** Delimitadores de área de uso privado — não casam com nenhum padrão abaixo. */
const SLOT_OPEN = "\uE000";
const SLOT_CLOSE = "\uE001";

interface PatternSpec {
  readonly name: string;
  readonly pattern: RegExp;
  /** `input` = agressivo demais para texto que pessoas vão ler. */
  readonly phases: readonly MaskPhase[];
}

const BOTH: readonly MaskPhase[] = ["input", "output"];
const INPUT_ONLY: readonly MaskPhase[] = ["input"];

/**
 * A ordem importa. Os padrões mais específicos vêm antes para que o reporte
 * mostre a categoria certa: um IP casaria também no detector de domínio, e
 * "conexão com 10.0.0.1" fica mais legível reportado como IP.
 */
const PATTERNS: readonly PatternSpec[] = [
  // Trailers de commit carregam nome e e-mail de gente real.
  {
    name: "trailer",
    phases: BOTH,
    pattern: /^(?:co-authored-by|signed-off-by|reviewed-by|reported-by|tested-by|refs|closes|fixes|resolves)\s*:.*$/gim,
  },

  // Credenciais com prefixo conhecido. Primeiro de todos: se vazou uma chave,
  // ela não pode sobrar por ter casado antes em outro padrão mais frouxo.
  {
    name: "credencial",
    phases: BOTH,
    pattern: /\b(?:sk-ant-|sk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|npg_|xox[baprs]-|AKIA|ASIA|WPL_)[A-Za-z0-9_.\-]{8,}/g,
  },

  { name: "url", phases: BOTH, pattern: /\bhttps?:\/\/[^\s<>"')\]]+/gi },
  { name: "email", phases: BOTH, pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  { name: "ip", phases: BOTH, pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },

  // Caminho de arquivo. Segmentos de 2+ caracteres para não comer "e/ou".
  {
    name: "caminho",
    phases: BOTH,
    pattern: /(?<![\w:])(?:\.{0,2}\/)?[\w.@-]{2,}(?:\/[\w.@-]{2,})+\/?/g,
  },

  // Nome de variável de ambiente costuma revelar serviço interno.
  { name: "variavel de ambiente", phases: BOTH, pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g },

  // Chamado interno: ACME-1234, PROJ-88.
  { name: "chamado", phases: BOTH, pattern: /\b[A-Z]{2,10}-\d{1,6}\b/g },

  // Cadeia opaca e longa: token, hash, id. Exige letra e dígito para não
  // engolir uma palavra comprida do português.
  {
    name: "cadeia opaca",
    phases: BOTH,
    pattern: /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g,
  },

  // Domínio. Roda depois de URL e IP, então o que sobra aqui é host solto.
  {
    name: "dominio",
    phases: BOTH,
    pattern: /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}\b/gi,
  },

  // Texto entre aspas ou crases costuma ser mensagem de UI ou nome literal.
  // Agressivo de propósito na entrada; fora da saída, onde destruiria prosa
  // legítima e faria um post bom ser descartado à toa.
  {
    name: "trecho citado",
    phases: INPUT_ONLY,
    pattern: /"[^"\n]{1,200}"|`[^`\n]{1,200}`|“[^”\n]{1,200}”/g,
  },
];

/** Monta o padrão dos termos extras, com bordas que respeitam hífen. */
function literalPattern(terms: readonly string[]): RegExp | null {
  const usable = terms.map((term) => term.trim()).filter((term) => term.length >= 3);
  if (usable.length === 0) return null;

  // Mais longos primeiro: "acme corp" deve casar antes de "acme".
  const alternatives = [...usable]
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegExp)
    .join("|");

  return new RegExp(`(?<![\\w-])(?:${alternatives})(?![\\w-])`, "gi");
}

/**
 * Troca termos protegidos por marcadores antes dos padrões rodarem, e devolve
 * como restaurá-los depois. Cada ocorrência ganha seu próprio slot para que a
 * caixa original ("Node.js" vs "node.js") volte exatamente como estava.
 */
function protect(text: string, terms: readonly string[]): { text: string; restore: (s: string) => string } {
  const pattern = literalPattern(terms);
  if (pattern === null) return { text, restore: (s) => s };

  const slots: string[] = [];
  const masked = text.replace(pattern, (match) => {
    slots.push(match);
    return `${SLOT_OPEN}${slots.length - 1}${SLOT_CLOSE}`;
  });

  const restore = (s: string): string =>
    s.replace(new RegExp(`${SLOT_OPEN}(\\d+)${SLOT_CLOSE}`, "g"), (_, index: string) => slots[Number(index)] ?? "");

  return { text: masked, restore };
}

/**
 * Apaga trechos sensíveis e devolve o que foi apagado.
 *
 * O `replacement` padrão é um espaço porque na barreira 1 o texto só serve de
 * insumo para casar vocabulário. Na barreira 2 o chamador passa um marcador
 * visível, já que ali o texto vai ser lido por gente.
 */
export function maskSensitive(text: string, options: MaskOptions = {}): MaskResult {
  const replacement = options.replacement ?? " ";
  const phase = options.phase ?? "input";
  const removed: string[] = [];
  const seen = new Set<string>();

  const record = (match: string): string => {
    const trimmed = match.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      if (removed.length < MAX_REPORTED) removed.push(trimmed);
    }
    return replacement;
  };

  const { text: guarded, restore } = protect(text, options.protectedTerms ?? []);
  let out = guarded;

  const extra = literalPattern(options.extraTerms ?? []);
  if (extra !== null) out = out.replace(extra, record);

  for (const spec of PATTERNS) {
    if (!spec.phases.includes(phase)) continue;
    // `replace` com flag global zera o lastIndex sozinho, então reusar o
    // literal entre chamadas é seguro.
    out = out.replace(spec.pattern, record);
  }

  return { text: restore(out), removed };
}

/** Nomes das categorias, para teste e diagnóstico. */
export const PATTERN_NAMES: readonly string[] = PATTERNS.map((spec) => spec.name);
