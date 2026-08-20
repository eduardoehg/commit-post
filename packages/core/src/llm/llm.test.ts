import { describe, expect, it } from "vitest";
import {
  CANDIDATES_MAX,
  LINKEDIN_MAX_CHARS,
  LLMError,
  aplicarBarreira2,
  buildUserPrompt,
  extrairResposta,
  type Resposta,
} from "./index";
import type { TechnicalFact } from "../redact/index";

const FATO: TechnicalFact = {
  changeKind: "bugfix",
  technologies: ["cache", "TypeScript"],
  problemClass: "lentidão",
  outcome: null,
  sourceShas: ["a1b2c3d4e5f6", "0f9e8d7c6b5a"],
};

describe("buildUserPrompt", () => {
  it("não leva os shas ao modelo, só a contagem", () => {
    // `sourceShas` existe para mostrar procedência na aprovação. O tipo diz
    // "não vai ao LLM", e é isto que faz a afirmação valer alguma coisa: um
    // sha é a chave para reencontrar o commit — e a mensagem dele — no GitHub.
    const prompt = buildUserPrompt([FATO]);

    for (const sha of FATO.sourceShas) expect(prompt).not.toContain(sha);
    expect(prompt).toContain("commits agrupados: 2");
  });

  it("leva o que o modelo precisa para escrever", () => {
    const prompt = buildUserPrompt([FATO]);

    expect(prompt).toContain("bugfix");
    expect(prompt).toContain("cache, TypeScript");
    expect(prompt).toContain("lentidão");
  });

  it("omite campo nulo em vez de escrever a palavra null", () => {
    // "resultado: null" faria o modelo tratar "null" como informação — e
    // inventar em cima dela, que é exatamente o que o prompt proíbe.
    const prompt = buildUserPrompt([FATO]);

    expect(prompt).not.toContain("null");
    expect(prompt).not.toContain("resultado:");
  });

  it("diz explicitamente que não há mais contexto", () => {
    // Sem esta frase o modelo assume que o resto do contexto existe em algum
    // lugar e escreve como se soubesse dele.
    expect(buildUserPrompt([FATO])).toContain("tudo que se sabe");
  });

  it("numera vários fatos sem misturá-los", () => {
    const prompt = buildUserPrompt([FATO, { ...FATO, changeKind: "feature" }]);
    expect(prompt).toContain("1. tipo de mudança: bugfix");
    expect(prompt).toContain("2. tipo de mudança: feature");
  });

  it("aguenta fato sem tecnologia identificada", () => {
    const prompt = buildUserPrompt([{ ...FATO, technologies: [] }]);
    expect(prompt).toContain("não identificadas");
  });
});

// ---------------------------------------------------------------------------

function resposta(textos: string[], motivo: string | null = null): Resposta {
  return {
    candidatos: textos.map((texto, i) => ({ angulo: `ângulo ${String(i)}`, texto })),
    motivo,
  };
}

describe("aplicarBarreira2", () => {
  it("descarta o candidato sujo em vez de publicar a versão censurada", () => {
    // O ponto da fase inteira. Se um termo proibido chegou à saída, ou a
    // barreira 1 falhou ou o modelo inventou — e nos dois casos o texto INTEIRO
    // perdeu a credibilidade. Publicar a versão com [removido] seria confiar no
    // resto de um texto que já provou não ser confiável.
    const resultado = aplicarBarreira2(
      resposta(["Resolvi a lentidão do sistema.", "Trabalhando na Acme Corp, resolvi a lentidão."]),
      ["Acme Corp"],
    );

    expect(resultado.candidatos).toHaveLength(1);
    expect(resultado.candidatos[0]?.texto).toBe("Resolvi a lentidão do sistema.");
    expect(resultado.descartados).toHaveLength(1);
    expect(resultado.descartados[0]?.removidos).toContain("Acme Corp");
  });

  it("descarta o candidato que traz e-mail, sem depender de denylist", () => {
    // A barreira 2 tem detectores próprios — e-mail, domínio, URL — que valem
    // mesmo com a lista de termos vazia.
    const resultado = aplicarBarreira2(resposta(["Falei com cliente@empresa.com hoje."]), []);

    expect(resultado.candidatos).toHaveLength(0);
    expect(resultado.descartados).toHaveLength(1);
  });

  it("publica o texto que SAIU da barreira, não o que entrou", () => {
    // Este teste existe por causa de uma mutação que sobreviveu: trocar o
    // texto higienizado pelo original passava despercebido, porque os outros
    // testes só olhavam casos em que o candidato acabava descartado — e
    // afirmar sobre uma lista vazia não afirma nada.
    //
    // A diferença observável sem descarte é a normalização de espaço, e é o
    // que prova que o texto atravessou o filtro em vez de contorná-lo.
    const sujo = "  Primeira linha.   Com   espaço sobrando.  ";
    const resultado = aplicarBarreira2(resposta([sujo, "segundo candidato"]), []);

    expect(resultado.candidatos[0]?.texto).toBe("Primeira linha. Com espaço sobrando.");
    expect(resultado.candidatos[0]?.texto).not.toBe(sujo);
  });

  it("descarta texto acima do limite do LinkedIn", () => {
    // Um post que não cabe é um post que o dev aprova e não consegue publicar.
    const resultado = aplicarBarreira2(resposta(["a".repeat(LINKEDIN_MAX_CHARS + 1)]), []);

    expect(resultado.candidatos).toHaveLength(0);
    expect(resultado.descartados).toHaveLength(1);
  });

  it("aceita texto exatamente no limite", () => {
    const resultado = aplicarBarreira2(resposta(["a".repeat(LINKEDIN_MAX_CHARS)]), []);
    expect(resultado.candidatos).toHaveLength(1);
  });

  it("explica por que vieram menos de dois", () => {
    // Sem motivo, um lote vazio chega ao Telegram como silêncio — e silêncio é
    // indistinguível de sistema quebrado.
    expect(aplicarBarreira2(resposta(["um só"]), []).motivo).not.toBeNull();
    expect(aplicarBarreira2(resposta([]), []).motivo).not.toBeNull();
  });

  it("não inventa motivo quando o lote está completo", () => {
    expect(aplicarBarreira2(resposta(["um", "dois"]), []).motivo).toBeNull();
  });

  it("preserva o motivo que o próprio modelo deu", () => {
    const resultado = aplicarBarreira2(resposta([], "material insuficiente"), []);
    expect(resultado.motivo).toBe("material insuficiente");
  });

  it("diz que o descarte foi da barreira quando foi", () => {
    const resultado = aplicarBarreira2(resposta(["Trabalho na Acme."]), ["Acme"]);
    expect(resultado.motivo).toMatch(/confidencialidade/);
  });
});

// ---------------------------------------------------------------------------

describe("extrairResposta", () => {
  const valida = { candidatos: [{ angulo: "a", texto: "t" }], motivo: null };

  it("aceita a saída estruturada do SDK", () => {
    expect(extrairResposta({ parsed_output: valida })).toEqual(valida);
  });

  it("aceita JSON num bloco de texto, se a saída estruturada faltar", () => {
    const message = { content: [{ type: "text", text: JSON.stringify(valida) }] };
    expect(extrairResposta(message)).toEqual(valida);
  });

  it("recusa resposta fora do formato em vez de seguir com undefined", () => {
    // O `undefined` viajaria até virar um post vazio no Telegram, e aí a causa
    // estaria três camadas atrás.
    expect(() => extrairResposta({ parsed_output: { candidatos: "não é lista" } })).toThrow(LLMError);
    expect(() => extrairResposta({ content: [{ type: "text", text: "não é json" }] })).toThrow(
      LLMError,
    );
    expect(() => extrairResposta({ content: [] })).toThrow(LLMError);
  });

  it("recusa mais candidatos do que a regra de negócio permite", () => {
    const demais = {
      candidatos: Array.from({ length: CANDIDATES_MAX + 1 }, () => ({ angulo: "a", texto: "t" })),
      motivo: null,
    };

    expect(() => extrairResposta({ parsed_output: demais })).toThrow(LLMError);
  });
});
