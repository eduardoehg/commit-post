/**
 * Filtro de confidencialidade — Fase 3.
 *
 * A parte mais crítica do sistema. A abordagem é ALLOWLIST, e vale ser preciso
 * sobre o que isso significa aqui, porque há uma versão fraca e uma forte.
 *
 * A fraca seria limpar a mensagem do commit e repassar o resto — aí a
 * segurança inteira depende da qualidade das expressões regulares, e uma
 * expressão que não previu um caso vira um vazamento.
 *
 * A forte, que é a implementada: TODO campo do `TechnicalFact` vem de um
 * vocabulário fechado. `changeKind` é um enum. `technologies`, `problemClass`
 * e `outcome` só podem conter rótulos declarados em `vocabulary.ts`. Nenhum
 * pedaço de texto do commit é copiado para a saída — nem sanitizado, nem
 * truncado, nem nada. O commit só serve para DECIDIR quais rótulos se aplicam.
 *
 * Com isso "na dúvida descarta" deixa de ser uma regra que alguém precisa
 * lembrar de aplicar e passa a ser verdade por construção: um nome de cliente
 * não é filtrado, ele simplesmente não tem por onde sair.
 *
 * Três barreiras, nesta ordem:
 *   1. extractTechnicalFacts() — o commit bruto NUNCA chega ao LLM
 *   2. scrubGeneratedText()    — varre a saída do LLM, onde não há vocabulário
 *                                fechado possível
 *   3. aprovação humana no Telegram, com procedência visível
 */

import { maskSensitive } from "./sanitize.js";
import {
  EXTENSION_TECHNOLOGY,
  findVocabularyHits,
  normalize,
  OUTCOMES,
  PROBLEM_CLASSES,
  PROTECTED_LITERALS,
  rewriteDottedTerms,
  TECHNOLOGIES,
} from "./vocabulary.js";

/** Categoria da mudança, inferida da mensagem do commit. */
export type ChangeKind =
  | "feature"
  | "bugfix"
  | "refactor"
  | "performance"
  | "infra"
  | "test"
  | "docs"
  | "chore";

/**
 * Commit como sai da coleta (Fase 2).
 *
 * Note o que NÃO está aqui: nome real do repositório e caminhos de arquivo.
 * São as duas maiores fontes de vazamento (`src/clients/acme/`,
 * `packages/produto-interno/`) e por isso nunca são persistidos.
 */
export interface RawCommit {
  sha: string;
  /** Alias interno estável. Nunca o nome real do repositório. */
  repoAlias: string;
  message: string;
  authoredAt: Date;
  /** Só as extensões, sem caminho: ["ts", "tsx", "sql"] */
  fileExtensions: readonly string[];
  fileCount: number;
}

/** O único formato que pode ser enviado ao LLM. */
export interface TechnicalFact {
  changeKind: ChangeKind;
  /** Apenas rótulos declarados em `vocabulary.ts`. */
  technologies: readonly string[];
  /** Classe genérica do problema. Rótulo fechado ou nulo — nunca texto livre. */
  problemClass: string | null;
  /** Resultado genérico. Rótulo fechado ou nulo — nunca texto livre. */
  outcome: string | null;
  /** Shas de origem, para exibir procedência na aprovação. Não vai ao LLM. */
  sourceShas: readonly string[];
}

export interface ScrubResult {
  text: string;
  /** Termos removidos. Se não estiver vazio, algo passou pela barreira 1. */
  removed: readonly string[];
}

export interface FilterOptions {
  /**
   * Nomes de empresas, clientes, produtos internos — e os NOMES REAIS DOS
   * REPOSITÓRIOS — a remover.
   *
   * Entra por parâmetro, e não por constante neste arquivo, por dois motivos:
   * o repositório é público, então uma lista de clientes commitada seria ela
   * própria o vazamento; e a lista é específica de quem usa o sistema.
   *
   * ATENÇÃO PARA A FASE 2: o repoAlias do RawCommit é o nosso apelido
   * interno, e passá-lo aqui não protege quase nada — o que aparece de fato
   * numa mensagem de commit é o NOME REAL do repositório ("merge branch x
   * into faturamento-clientex"), e esse nome, por decisão de projeto, nunca
   * é persistido em lugar nenhum.
   *
   * Ou seja: quem coleta tem o nome real em memória e é o único que pode
   * passá-lo adiante. A coleta DEVE incluir os nomes reais dos repositórios
   * em deniedTerms ao chamar o filtro, sem gravá-los.
   */
  readonly deniedTerms?: readonly string[];
}

/** Teto de tecnologias por fato, para o post não virar lista de compras. */
export const MAX_TECHNOLOGIES = 6;

/** Marcador deixado no lugar do que a barreira 2 remove. */
export const REDACTION_MARKER = "[removido]";

// ---------------------------------------------------------------------------
// Classificação da mudança
// ---------------------------------------------------------------------------

const CONVENTIONAL_TYPES: Readonly<Record<string, ChangeKind>> = {
  feat: "feature",
  feature: "feature",
  fix: "bugfix",
  bugfix: "bugfix",
  hotfix: "bugfix",
  refactor: "refactor",
  perf: "performance",
  test: "test",
  tests: "test",
  docs: "docs",
  doc: "docs",
  build: "infra",
  ci: "infra",
  infra: "infra",
  deploy: "infra",
  chore: "chore",
  style: "chore",
  revert: "chore",
};

/**
 * Prefixo de conventional commit: `tipo(escopo)!: assunto`.
 *
 * O ESCOPO É DESCARTADO, e isso não é detalhe. `feat(faturamento-clientex):`
 * põe o nome do módulo interno logo na primeira linha de todo commit — é um
 * dos vazamentos mais prováveis do sistema inteiro.
 */
const CONVENTIONAL_PREFIX = /^\s*([a-zA-Z]+)\s*(?:\(([^)]*)\))?\s*!?\s*:\s*/;

interface ParsedPrefix {
  readonly kind: ChangeKind | null;
  readonly rest: string;
}

function parseConventionalPrefix(message: string): ParsedPrefix {
  const match = CONVENTIONAL_PREFIX.exec(message);
  if (match === null) return { kind: null, rest: message };

  const type = match[1];
  if (type === undefined) return { kind: null, rest: message };

  const kind = CONVENTIONAL_TYPES[normalize(type)];
  if (kind === undefined) return { kind: null, rest: message };

  // match[2] é o escopo e é deliberadamente ignorado.
  return { kind, rest: message.slice(match[0].length) };
}

/**
 * Palavras-chave para quando não há prefixo convencional.
 * A ordem decide o empate: o primeiro grupo que casar vence.
 */
const KEYWORDS: readonly (readonly [ChangeKind, readonly string[]])[] = [
  ["bugfix", ["corrige", "corrigido", "conserta", "arruma", "fix", "fixes", "bug", "erro", "falha", "quebrado", "regressao"]],
  ["performance", ["otimiza", "otimizacao", "performance", "desempenho", "acelera", "mais rapido", "faster", "lentidao", "gargalo"]],
  ["test", ["teste", "testes", "test", "tests", "cobertura", "coverage"]],
  ["docs", ["documenta", "documentacao", "readme", "docs", "changelog"]],
  ["infra", ["deploy", "docker", "kubernetes", "workflow", "esteira", "terraform", "provisiona"]],
  ["refactor", ["refatora", "refatoracao", "refactor", "simplifica", "limpa", "reorganiza", "extrai", "renomeia", "remove"]],
  ["feature", ["adiciona", "adicionado", "cria", "criado", "implementa", "introduz", "permite", "suporte", "nova", "novo"]],
];

function classifyByKeywords(text: string): ChangeKind | null {
  const haystack = normalize(text);
  for (const [kind, words] of KEYWORDS) {
    for (const word of words) {
      if (new RegExp(`(?<![\\w-])${word}`, "u").test(haystack)) return kind;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Barreira 1
// ---------------------------------------------------------------------------

interface Candidate {
  changeKind: ChangeKind;
  /** rótulo → número de ocorrências, para escolher as mais relevantes */
  technologies: Map<string, number>;
  problemClass: string | null;
  outcome: string | null;
  shas: string[];
}

function candidateFromCommit(commit: RawCommit, deniedTerms: readonly string[]): Candidate {
  const { kind, rest } = parseConventionalPrefix(commit.message);

  // Reescreve nomes com ponto ANTES de higienizar, senão "Node.js" é comido
  // pelo detector de domínios e a tecnologia se perde.
  const rewritten = rewriteDottedTerms(rest);

  const { text } = maskSensitive(rewritten, {
    extraTerms: [commit.repoAlias, ...deniedTerms],
  });

  const technologies = new Map<string, number>();
  for (const hit of findVocabularyHits(text, TECHNOLOGIES)) {
    technologies.set(hit.label, hit.count);
  }

  // Extensões de arquivo são um conjunto fechado e não carregam caminho, então
  // são uma fonte de sinal segura — e frequentemente a única, já que muita
  // mensagem de commit não nomeia a tecnologia.
  for (const extension of commit.fileExtensions) {
    const label = EXTENSION_TECHNOLOGY.get(normalize(extension).replace(/^\./, ""));
    if (label !== undefined && !technologies.has(label)) technologies.set(label, 1);
  }

  return {
    changeKind: kind ?? classifyByKeywords(text) ?? "chore",
    technologies,
    problemClass: findVocabularyHits(text, PROBLEM_CLASSES)[0]?.label ?? null,
    outcome: findVocabularyHits(text, OUTCOMES)[0]?.label ?? null,
    shas: [commit.sha],
  };
}

/**
 * Dois candidatos viram um só quando são do mesmo tipo e falam do mesmo
 * assunto — mesma tecnologia ou mesma classe de problema.
 */
function canMerge(a: Candidate, b: Candidate): boolean {
  if (a.changeKind !== b.changeKind) return false;

  for (const label of b.technologies.keys()) {
    if (a.technologies.has(label)) return true;
  }

  return a.problemClass !== null && a.problemClass === b.problemClass;
}

function absorb(target: Candidate, source: Candidate): void {
  for (const [label, count] of source.technologies) {
    target.technologies.set(label, (target.technologies.get(label) ?? 0) + count);
  }
  target.problemClass ??= source.problemClass;
  target.outcome ??= source.outcome;
  target.shas.push(...source.shas);
}

/**
 * Agrupa até estabilizar. Uma passada só não basta: um commit posterior pode
 * ser a ponte entre dois grupos já formados.
 */
function mergeCandidates(candidates: readonly Candidate[]): Candidate[] {
  let current = [...candidates];

  for (;;) {
    const next: Candidate[] = [];
    for (const candidate of current) {
      const target = next.find((existing) => canMerge(existing, candidate));
      if (target === undefined) next.push(candidate);
      else absorb(target, candidate);
    }
    if (next.length === current.length) return next;
    current = next;
  }
}

/**
 * Um fato sem tecnologia e sem classe de problema não tem sobre o que gerar
 * post — só diria "mexi em alguma coisa". Descartar é o comportamento certo.
 */
function isPublishable(candidate: Candidate): boolean {
  return candidate.technologies.size > 0 || candidate.problemClass !== null;
}

function toFact(candidate: Candidate): TechnicalFact {
  const technologies = [...candidate.technologies.entries()]
    .sort(([labelA, countA], [labelB, countB]) => countB - countA || labelA.localeCompare(labelB, "pt-BR"))
    .slice(0, MAX_TECHNOLOGIES)
    .map(([label]) => label);

  return {
    changeKind: candidate.changeKind,
    technologies,
    problemClass: candidate.problemClass,
    outcome: candidate.outcome,
    sourceShas: [...candidate.shas],
  };
}

/**
 * Barreira 1: reduz commits brutos a fatos técnicos publicáveis.
 *
 * Nada do texto original atravessa — a saída é montada exclusivamente a partir
 * dos vocabulários fechados.
 */
export function extractTechnicalFacts(
  commits: readonly RawCommit[],
  options: FilterOptions = {},
): TechnicalFact[] {
  const deniedTerms = options.deniedTerms ?? [];
  const candidates = commits.map((commit) => candidateFromCommit(commit, deniedTerms));
  return mergeCandidates(candidates).filter(isPublishable).map(toFact);
}

// ---------------------------------------------------------------------------
// Barreira 2
// ---------------------------------------------------------------------------

/**
 * Barreira 2: varre o texto gerado pelo LLM.
 *
 * Aqui não dá para usar vocabulário fechado — a saída precisa ser português
 * corrente. Então esta camada é uma denylist, com a limitação que toda
 * denylist tem, e existe como rede de segurança e não como garantia.
 *
 * Política de uso: `removed` não vazio significa que a barreira 1 falhou ou
 * que o modelo inventou algo. O candidato deve ser DESCARTADO, não publicado
 * com o marcador — o marcador serve para inspecionar o que aconteceu.
 */
export function scrubGeneratedText(text: string, options: FilterOptions = {}): ScrubResult {
  const { text: scrubbed, removed } = maskSensitive(text, {
    replacement: REDACTION_MARKER,
    extraTerms: options.deniedTerms ?? [],
    protectedTerms: PROTECTED_LITERALS,
    phase: "output",
  });

  return { text: scrubbed.replace(/[ \t]{2,}/g, " ").trim(), removed };
}

export { maskSensitive } from "./sanitize.js";
export { normalize } from "./vocabulary.js";
