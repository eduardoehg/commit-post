import { describe, expect, it } from "vitest";
import {
  CALLBACK_DATA_MAX_BYTES,
  TelegramError,
  buildCallbackData,
  buildKeyboard,
  buildScheduleKeyboard,
  formatProvenance,
  parseCallbackData,
  type CandidatoParaEnvio,
} from "./index";

/** Um candidato de teste; o grupo é o que muda de caso para caso. */
function candidato(over: Partial<CandidatoParaEnvio> = {}): CandidatoParaEnvio {
  return { id: 1, grupo: 0, tema: "um assunto", angulo: "o problema", texto: "t", ...over };
}

describe("buildCallbackData / parseCallbackData", () => {
  it("fecha o ciclo para todas as ações", () => {
    for (const acao of ["publish", "reject", "menu", "voltar"] as const) {
      expect(parseCallbackData(buildCallbackData(acao, 42))).toEqual({
        action: acao,
        candidateId: 42,
        slot: null,
      });
    }
  });

  it("leva e devolve o slot do agendamento", () => {
    expect(parseCallbackData(buildCallbackData("schedule", 42, 3))).toEqual({
      action: "schedule",
      candidateId: 42,
      slot: 3,
    });
  });

  it("recusa agendar sem dizer para quando", () => {
    // Seguir com o slot nulo publicaria na hora um post que a pessoa quis
    // adiar — o pior desfecho possível deste botão.
    expect(parseCallbackData("s:42")).toBeNull();
  });

  it("cabe no limite do Telegram mesmo com id enorme e slot", () => {
    // O Telegram CORTA em 64 bytes em vez de recusar, e um payload cortado
    // vira uma decisão aplicada no candidato errado.
    const dados = buildCallbackData("schedule", Number.MAX_SAFE_INTEGER, 99);
    expect(Buffer.byteLength(dados, "utf8")).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
  });

  it("recusa o que não saiu daqui", () => {
    for (const ruim of [
      "",
      "x",
      "p:",
      ":42",
      "p:0",
      "p:-1",
      "p:abc",
      "z:42",
      "p:42:extra",
      "p:1e3",
      " p:42",
      "s:42:abc",
      "x", // a legenda dos botões já decididos
    ]) {
      expect(parseCallbackData(ruim), ruim).toBeNull();
    }
  });

  it("recusa id que não é inteiro seguro", () => {
    // Um id além de 2^53 volta de `Number` arredondado — e arredondado aponta
    // para outra linha.
    expect(parseCallbackData("p:99999999999999999")).toBeNull();
  });

  it("não leva o dono nem a data no botão", () => {
    // Quem confere se o candidato é de quem clicou é o banco. E a data é
    // recalculada no servidor a partir do slot: uma data aqui seria um dado de
    // fora decidindo quando um post vai ao ar.
    expect(buildCallbackData("publish", 7)).toBe("p:7");
    expect(buildCallbackData("schedule", 7, 2)).toBe("s:7:2");
  });
});

describe("buildKeyboard", () => {
  it("separa recusar dos outros dois", () => {
    // Publicar e recusar lado a lado seriam alvos do mesmo tamanho num
    // celular, e o que separa "vai ao meu perfil" de "some para sempre" seria
    // meio centímetro de polegar.
    const teclado = buildKeyboard(9);

    expect(teclado.inline_keyboard).toHaveLength(2);
    expect(teclado.inline_keyboard[0]?.map((b) => b.callback_data)).toEqual(["p:9", "g:9"]);
    expect(teclado.inline_keyboard[1]?.map((b) => b.callback_data)).toEqual(["r:9"]);
  });
});

describe("buildScheduleKeyboard", () => {
  const opcoes = [
    { id: 1, rotulo: "qua 27/08 09h" },
    { id: 2, rotulo: "sex 29/08 09h" },
  ];

  it("um horário por linha, e uma saída sem decidir", () => {
    // Quem tocou em agendar sem querer não pode ser obrigado a escolher uma
    // data para escapar.
    const teclado = buildScheduleKeyboard(9, opcoes);

    expect(teclado.inline_keyboard).toHaveLength(3);
    expect(teclado.inline_keyboard[0]?.[0]?.callback_data).toBe("s:9:1");
    expect(teclado.inline_keyboard[1]?.[0]?.callback_data).toBe("s:9:2");
    expect(teclado.inline_keyboard[2]?.[0]?.callback_data).toBe("v:9");
  });

  it("mostra o rótulo com dia da semana, não o número do slot", () => {
    expect(buildScheduleKeyboard(9, opcoes).inline_keyboard[0]?.[0]?.text).toContain("qua 27/08");
  });
});

describe("formatProvenance", () => {
  const base = {
    aliases: ["repo-3", "repo-7"],
    commitCount: 12,
    shas: ["a1b2c3d4e5f6a7b8", "0f9e8d7c6b5a4938"],
    windowStart: new Date("2026-08-13T00:00:00Z"),
    windowEnd: new Date("2026-08-20T00:00:00Z"),
  };

  const umAssunto = [
    candidato({ id: 1, grupo: 0, angulo: "o problema" }),
    candidato({ id: 2, grupo: 0, angulo: "o que aprendi" }),
  ];

  const variosAssuntos = [
    candidato({ id: 1, grupo: 0, tema: "a lentidão" }),
    candidato({ id: 2, grupo: 1, tema: "os relatórios" }),
  ];

  it("mostra alias, contagem e sha — a procedência inteira", () => {
    // Sem isto o gate humano é decorativo: não há como perceber um vazamento
    // que passou pelas duas barreiras se o dev não sabe do que o post fala.
    const texto = formatProvenance(base, umAssunto);

    expect(texto).toContain("repo-3, repo-7");
    expect(texto).toContain("12 commit(s)");
    expect(texto).toContain("a1b2c3d");
    expect(texto).toContain("13/08/2026");
    expect(texto).toContain("20/08/2026");
  });

  it("avisa que só UMA sai quando os textos são do mesmo assunto", () => {
    // Sem esta frase o dev aprova um, vê os outros dois virarem "encerrada" e
    // acha que perdeu dois posts.
    const texto = formatProvenance(base, umAssunto);

    expect(texto).toContain("só uma vai ao ar");
    expect(texto).toContain("1. o problema");
    expect(texto).toContain("2. o que aprendi");
  });

  it("avisa que dá para publicar TODOS quando os assuntos diferem", () => {
    // O erro simétrico, e o mais caro: sem esta frase o dev escolhe um e joga
    // fora trabalho bom, achando que a regra é a mesma de antes.
    const texto = formatProvenance(base, variosAssuntos);

    expect(texto).toContain("2 assuntos diferentes");
    expect(texto).toContain("pode publicar todos");
    expect(texto).toContain("1. a lentidão");
    expect(texto).toContain("2. os relatórios");
  });

  it("lista o TEMA quando há vários assuntos e o ÂNGULO quando há um só", () => {
    // São perguntas diferentes: com vários assuntos o dev escolhe do que
    // falar; com um assunto só, escolhe como falar. Trocar os dois faria a
    // lista repetir a mesma palavra três vezes.
    expect(formatProvenance(base, variosAssuntos)).not.toContain("o problema");
    expect(formatProvenance(base, umAssunto)).not.toContain("um assunto\n");
  });

  it("encurta o sha e limita quantos aparecem", () => {
    const muitos = {
      ...base,
      shas: Array.from({ length: 20 }, (_, i) => `sha${String(i)}`.repeat(8)),
    };
    const texto = formatProvenance(muitos, umAssunto);

    expect(texto).toContain("(+12)");
    // Sha inteiro tem 40 caracteres; mostrar todos vira parede de texto e o
    // olho pula — que é o mesmo que não mostrar.
    expect(texto).not.toContain(muitos.shas[0]);
  });

  it("aguenta lote sem sha nenhum", () => {
    expect(() => formatProvenance({ ...base, shas: [] }, umAssunto)).not.toThrow();
  });

  it("repete a regra que não pode ser esquecida", () => {
    expect(formatProvenance(base, umAssunto)).toContain("Nada é publicado sem você decidir");
  });
});

describe("TelegramError", () => {
  it("existe para o chamador distinguir falha do Telegram de falha nossa", () => {
    expect(new TelegramError("x")).toBeInstanceOf(Error);
    expect(new TelegramError("x").name).toBe("TelegramError");
  });
});
