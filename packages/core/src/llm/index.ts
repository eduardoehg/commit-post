/**
 * Geração dos posts — Fase 4.
 *
 * A entrada é SEMPRE `TechnicalFact[]`, nunca commits brutos. Isso não é
 * disciplina de quem chama: é o tipo. Um `TechnicalFact` só contém rótulos de
 * vocabulário fechado, então o modelo não tem como repetir um nome de cliente
 * — ele nunca viu nenhum.
 *
 * O que sobra de risco não é vazamento, é INVENÇÃO. Com tão pouca matéria-prima
 * — "bugfix, cache, lentidão" — a tentação de qualquer modelo é preencher o
 * vazio: "trabalhando num sistema bancário de alto volume...". Nada disso veio
 * dos dados, e uma frase dessas é ao mesmo tempo mentira e a forma exata de um
 * vazamento. Por isso o prompt gasta mais palavras proibindo invenção do que
 * pedindo qualidade, e por isso o modelo pode devolver ZERO candidatos.
 *
 * Depois da geração vem a barreira 2 (`scrubGeneratedText`). Candidato que a
 * atravessa sujo é DESCARTADO, nunca publicado com o marcador: se algo passou,
 * o problema está a montante e o texto não é confiável.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { scrubGeneratedText, type TechnicalFact } from "../redact/index";

export const MODEL = "claude-opus-5";

/** Entre 2 e 3 variações por lote, conforme regra de negócio. */
export const CANDIDATES_MIN = 2;
export const CANDIDATES_MAX = 3;

/** Limite de caracteres de um post no LinkedIn. */
export const LINKEDIN_MAX_CHARS = 3000;

/**
 * Teto do que pedimos. Post de LinkedIn que passa disso não é lido: o "ver
 * mais" corta por volta de 200 e o resto depende de o leitor querer.
 */
const ALVO_MAX_CHARS = 1300;

export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

const respostaSchema = z.object({
  candidatos: z
    .array(
      z.object({
        angulo: z.string().min(1).max(80),
        texto: z.string().min(1),
      }),
    )
    .max(CANDIDATES_MAX),
  /** Preenchido quando o modelo julga não haver material honesto. */
  motivo: z.string().nullable(),
});

export type Resposta = z.infer<typeof respostaSchema>;

export interface PostCandidate {
  /** Em que este texto difere dos outros. Ajuda o dev a escolher rápido. */
  angulo: string;
  texto: string;
}

export interface DescartadoPorFiltro {
  angulo: string;
  /** O que a barreira 2 encontrou. Não vazio = a barreira 1 falhou. */
  removidos: readonly string[];
}

export interface GenerateResult {
  candidatos: PostCandidate[];
  /** Reprovados na barreira 2. Precisa aparecer: é sinal de defeito grave. */
  descartados: DescartadoPorFiltro[];
  /** Por que vieram menos de dois, quando é o caso. */
  motivo: string | null;
}

export interface GenerateOptions {
  apiKey: string;
  facts: readonly TechnicalFact[];
  /**
   * Nomes reais a remover na barreira 2. Não protegem a entrada — ela já é
   * vocabulário fechado — mas pegam o caso de o modelo acertar um nome por
   * coincidência ou de um rótulo novo ter vindo torto.
   */
  deniedTerms?: readonly string[];
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * As instruções.
 *
 * Vale explicar por que a ordem é esta. O modelo obedece melhor o que vem
 * primeiro e o que vem por último; as duas pontas são as regras cuja violação
 * não tem conserto — inventar contexto e falar difícil. Qualidade de texto
 * está no meio de propósito: um post morno é um post recusado, um post que
 * inventa onde a pessoa trabalha é um problema com o empregador dela.
 */
export const SYSTEM_PROMPT = `Você escreve posts de LinkedIn em português do Brasil para um desenvolvedor, a partir de um resumo estruturado do trabalho técnico dele.

REGRA 1 — NÃO INVENTE NADA.
Você recebe pouca informação de propósito. É tudo que existe. Você NÃO sabe, e não deve sugerir que sabe:
- onde a pessoa trabalha, o setor, o porte da empresa, se é produto ou consultoria;
- para quem o trabalho foi feito, nome de cliente, de produto ou de sistema;
- números: usuários, requisições, tempo economizado, porcentagem de melhoria, tamanho de equipe, prazo;
- a história em volta: reunião, incidente, cliente irritado, madrugada, deadline.
Se faltar material para um post honesto, devolva menos candidatos — ou nenhum — e explique em "motivo". Um post a menos não custa nada. Um post que inventa o contexto profissional de alguém custa o emprego dessa pessoa.

REGRA 2 — LINGUAGEM DE GENTE.
Quem lê é misto: desenvolvedores, recrutadores, gestores, gente de outras áreas. Explique pelo EFEITO antes do mecanismo. "O sistema respondia devagar quando muita gente usava ao mesmo tempo" antes de "otimizamos o cache". Termo técnico pode aparecer, mas explicado na mesma frase em que aparece, e no máximo dois por post. Nada de sigla sem tradução.

REGRA 3 — TOM.
Primeira pessoa. Alguém contando o que resolveu e o que aprendeu, não se vendendo. Sem "estou muito feliz em compartilhar", sem chamada para engajamento, sem emoji decorativo, sem enxurrada de hashtag. No máximo três hashtags, e só se acrescentarem algo.

REGRA 4 — FORMA.
Entre 500 e ${String(ALVO_MAX_CHARS)} caracteres. Primeira linha curta e concreta, porque é a única que aparece antes do "ver mais". Parágrafos de duas ou três linhas.

REGRA 5 — VARIAÇÕES DE VERDADE.
De ${String(CANDIDATES_MIN)} a ${String(CANDIDATES_MAX)} candidatos, cada um com um ÂNGULO diferente — não a mesma coisa reescrita. Ângulos que funcionam: o problema e como ele se manifestava; o que você aprendeu e faria diferente; a decisão técnica e o que ela custou. O campo "angulo" descreve isso em poucas palavras, para quem vai escolher.

Nunca invente. Se não dá para escrever honestamente, diga que não dá.`;

/**
 * O texto que vai ao modelo.
 *
 * Público e puro porque é o que atravessa a rede: dá para testar que ele não
 * contém nada além de rótulos de vocabulário fechado, o que é exatamente a
 * garantia que interessa.
 */
export function buildUserPrompt(facts: readonly TechnicalFact[]): string {
  const linhas = facts.map((fato, i) => {
    const partes = [
      `${String(i + 1)}. tipo de mudança: ${fato.changeKind}`,
      `   tecnologias: ${fato.technologies.length > 0 ? fato.technologies.join(", ") : "não identificadas"}`,
    ];

    if (fato.problemClass !== null) partes.push(`   classe do problema: ${fato.problemClass}`);
    if (fato.outcome !== null) partes.push(`   resultado: ${fato.outcome}`);
    partes.push(`   commits agrupados: ${String(fato.sourceShas.length)}`);

    return partes.join("\n");
  });

  return [
    "Trabalho técnico do período, agrupado por tipo de mudança:",
    "",
    linhas.join("\n\n"),
    "",
    "Cada item acima é tudo que se sabe. Não há mais contexto disponível — nem para você, nem para ninguém.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

export async function generatePostCandidates(
  options: GenerateOptions,
): Promise<GenerateResult> {
  if (options.facts.length === 0) {
    return { candidatos: [], descartados: [], motivo: "nenhum fato técnico no período" };
  }

  const client = new Anthropic({ apiKey: options.apiKey });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(options.facts) }],
    output_config: {
      // A tarefa é de escrita, não de raciocínio pesado. `medium` gasta o que
      // precisa sem transformar uma execução semanal em conta cara.
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["candidatos", "motivo"],
          properties: {
            candidatos: {
              // Sem `maxItems`: a API recusa a palavra em schema de saída
              // estruturada. O teto vive no prompt e, de verdade, no zod que
              // valida a resposta — que é onde ele precisa estar de qualquer
              // forma, porque um schema não impede o modelo de exagerar.
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["angulo", "texto"],
                properties: {
                  angulo: { type: "string", description: "Em que este texto difere dos outros" },
                  texto: { type: "string", description: "O post, pronto para publicar" },
                },
              },
            },
            motivo: {
              type: ["string", "null"],
              description: "Por que vieram menos de dois candidatos, ou null",
            },
          },
        },
      },
    },
  });

  return aplicarBarreira2(extrairResposta(message), options.deniedTerms ?? []);
}

/**
 * Tira o JSON da resposta.
 *
 * Separado da chamada para poder ser testado sem rede — e porque a forma da
 * resposta é a parte que muda quando o SDK muda.
 */
export function extrairResposta(message: unknown): Resposta {
  const bruto = (message as { parsed_output?: unknown }).parsed_output ?? textoDaResposta(message);

  const dados = typeof bruto === "string" ? parseJson(bruto) : bruto;
  const resultado = respostaSchema.safeParse(dados);

  if (!resultado.success) {
    throw new LLMError(
      `O modelo devolveu algo fora do formato esperado: ${resultado.error.issues[0]?.message ?? "sem detalhe"}`,
    );
  }

  return resultado.data;
}

function textoDaResposta(message: unknown): string {
  const blocos = (message as { content?: { type: string; text?: string }[] }).content ?? [];
  const texto = blocos
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  if (texto === "") throw new LLMError("O modelo não devolveu texto.");
  return texto;
}

function parseJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    throw new LLMError("O modelo devolveu algo que não é JSON.");
  }
}

/**
 * A barreira 2, aplicada candidato a candidato.
 *
 * Descartar em vez de publicar com `[removido]` é o ponto: se um termo
 * proibido apareceu na saída, ou a barreira 1 falhou ou o modelo inventou. Nos
 * dois casos o texto inteiro perdeu a credibilidade — publicar a versão
 * censurada seria confiar no resto de um texto que já provou não ser confiável.
 */
export function aplicarBarreira2(
  resposta: Resposta,
  deniedTerms: readonly string[],
): GenerateResult {
  const candidatos: PostCandidate[] = [];
  const descartados: DescartadoPorFiltro[] = [];

  for (const candidato of resposta.candidatos) {
    const { text, removed } = scrubGeneratedText(candidato.texto, { deniedTerms });

    if (removed.length > 0) {
      descartados.push({ angulo: candidato.angulo, removidos: removed });
      continue;
    }

    if (text.length > LINKEDIN_MAX_CHARS) {
      descartados.push({ angulo: candidato.angulo, removidos: ["texto acima do limite do LinkedIn"] });
      continue;
    }

    candidatos.push({ angulo: candidato.angulo, texto: text });
  }

  const motivo =
    candidatos.length >= CANDIDATES_MIN
      ? null
      : (resposta.motivo ??
        (descartados.length > 0
          ? "candidatos reprovados na barreira de confidencialidade"
          : "o modelo não gerou variações suficientes"));

  return { candidatos, descartados, motivo };
}
