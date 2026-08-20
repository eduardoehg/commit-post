/**
 * Filtro de confidencialidade — Fase 3.
 *
 * A parte mais crítica do sistema. A abordagem é ALLOWLIST, não blocklist:
 * em vez de remover o que se sabe ser sensível, extraímos apenas o que é
 * comprovadamente público e descartamos todo o resto por padrão.
 *
 * Motivo: uma blocklist só pega o que já se sabe ser perigoso. O vazamento
 * real vem do nome que ninguém previu — o cliente que entrou mês passado,
 * o produto interno novo, a sigla. Allowlist falha para o lado seguro.
 *
 * Três barreiras, nesta ordem:
 *   1. extractTechnicalFacts() — o commit bruto NUNCA chega ao LLM
 *   2. scrubGeneratedText()    — roda de novo na saída do LLM
 *   3. aprovação humana no Telegram, com procedência visível
 */

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
  /** Apenas termos presentes no vocabulário público curado. */
  technologies: readonly string[];
  /** Classe genérica do problema, ex.: "race condition", "cache invalidation". */
  problemClass: string | null;
  /** Resultado genérico, ex.: "reduziu tempo de resposta". */
  outcome: string | null;
  /** Shas de origem, para exibir procedência na aprovação. Não vai ao LLM. */
  sourceShas: readonly string[];
}

export interface ScrubResult {
  text: string;
  /** Termos removidos. Se não estiver vazio, algo passou pela barreira 1. */
  removed: readonly string[];
}

const NOT_IMPLEMENTED = "Fase 3 — ainda não implementado";

/**
 * Barreira 1: reduz commits brutos a fatos técnicos publicáveis.
 * Tudo que não estiver no vocabulário público é descartado.
 */
export function extractTechnicalFacts(_commits: readonly RawCommit[]): TechnicalFact[] {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Barreira 2: varre o texto gerado pelo LLM em busca de qualquer coisa que
 * tenha escapado. Roda sempre, mesmo que a barreira 1 tenha rodado.
 */
export function scrubGeneratedText(_text: string): ScrubResult {
  throw new Error(NOT_IMPLEMENTED);
}
