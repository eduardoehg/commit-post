/**
 * Geração dos posts — Fase 4.
 *
 * Modelo: claude-opus-5, via @anthropic-ai/sdk.
 *
 * Pontos definidos:
 *   - Structured outputs (`output_config.format`) para receber as variações
 *     como JSON validado, em vez de parsear prosa.
 *   - Thinking já vem ligado por padrão no Opus 5; `output_config.effort:
 *     "medium"` basta — a tarefa não é de raciocínio pesado.
 *   - Incluir o parâmetro `fallbacks` server-side para o caso de recusa por
 *     classificador.
 *   - Prompt caching não compensa a uma execução por dia.
 *
 * A entrada é SEMPRE TechnicalFact[], nunca commits brutos.
 */

const NOT_IMPLEMENTED = "Fase 4 — ainda não implementado";

/** Entre 2 e 3 variações por lote, conforme regra de negócio. */
export const CANDIDATES_MIN = 2;
export const CANDIDATES_MAX = 3;

/** Limite de caracteres de um post no LinkedIn. */
export const LINKEDIN_MAX_CHARS = 3000;

export function generatePostCandidates(): Promise<never> {
  throw new Error(NOT_IMPLEMENTED);
}
