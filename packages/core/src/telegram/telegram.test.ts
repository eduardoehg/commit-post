import { describe, expect, it } from "vitest";
import {
  CALLBACK_DATA_MAX_BYTES,
  TelegramError,
  buildCallbackData,
  buildKeyboard,
  formatProvenance,
  parseCallbackData,
} from "./index";

describe("buildCallbackData / parseCallbackData", () => {
  it("fecha o ciclo para as duas ações", () => {
    for (const acao of ["approve", "reject"] as const) {
      expect(parseCallbackData(buildCallbackData(acao, 42))).toEqual({
        action: acao,
        candidateId: 42,
      });
    }
  });

  it("cabe no limite do Telegram mesmo com id enorme", () => {
    // O Telegram CORTA em 64 bytes em vez de recusar, e um payload cortado
    // vira uma decisão aplicada no candidato errado.
    const dados = buildCallbackData("approve", Number.MAX_SAFE_INTEGER);
    expect(Buffer.byteLength(dados, "utf8")).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES);
  });

  it("recusa o que não saiu daqui", () => {
    for (const ruim of [
      "",
      "x",
      "a:",
      ":42",
      "a:0",
      "a:-1",
      "a:abc",
      "z:42",
      "a:42:extra",
      "a:1e3",
      " a:42",
      "x", // a legenda dos botões já decididos
    ]) {
      expect(parseCallbackData(ruim), ruim).toBeNull();
    }
  });

  it("recusa id que não é inteiro seguro", () => {
    // Um id além de 2^53 volta de `Number` arredondado — e arredondado aponta
    // para outra linha.
    expect(parseCallbackData("a:99999999999999999")).toBeNull();
  });

  it("não leva o dono no botão", () => {
    // Quem confere se o candidato é de quem clicou é o banco. Levar o id do
    // dono no payload convidaria alguém a trocá-lo.
    expect(buildCallbackData("approve", 7)).toBe("a:7");
  });
});

describe("buildKeyboard", () => {
  it("dá dois botões, um por ação, amarrados ao mesmo candidato", () => {
    const teclado = buildKeyboard(9, 2);
    const linha = teclado.inline_keyboard[0];

    expect(linha).toHaveLength(2);
    expect(linha?.[0]?.callback_data).toBe("a:9");
    expect(linha?.[1]?.callback_data).toBe("r:9");
    expect(linha?.[0]?.text).toContain("2");
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

  it("mostra alias, contagem e sha — a procedência inteira", () => {
    // Sem isto o gate humano é decorativo: não há como perceber um vazamento
    // que passou pelas duas barreiras se o dev não sabe do que o post fala.
    const texto = formatProvenance(base, ["o problema", "o que aprendi"]);

    expect(texto).toContain("repo-3, repo-7");
    expect(texto).toContain("12 commit(s)");
    expect(texto).toContain("a1b2c3d");
    expect(texto).toContain("13/08/2026");
    expect(texto).toContain("20/08/2026");
  });

  it("numera os ângulos para casar com os botões", () => {
    const texto = formatProvenance(base, ["o problema", "o que aprendi"]);
    expect(texto).toContain("1. o problema");
    expect(texto).toContain("2. o que aprendi");
  });

  it("encurta o sha e limita quantos aparecem", () => {
    const muitos = { ...base, shas: Array.from({ length: 20 }, (_, i) => `sha${String(i)}`.repeat(8)) };
    const texto = formatProvenance(muitos, ["a"]);

    expect(texto).toContain("(+12)");
    // Sha inteiro tem 40 caracteres; mostrar todos vira parede de texto e o
    // olho pula — que é o mesmo que não mostrar.
    expect(texto).not.toContain(muitos.shas[0]);
  });

  it("aguenta lote sem sha nenhum", () => {
    expect(() => formatProvenance({ ...base, shas: [] }, ["a"])).not.toThrow();
  });

  it("repete a regra que não pode ser esquecida", () => {
    expect(formatProvenance(base, ["a"])).toContain("Nada é publicado sem você aprovar");
  });
});

describe("TelegramError", () => {
  it("existe para o chamador distinguir falha do Telegram de falha nossa", () => {
    expect(new TelegramError("x")).toBeInstanceOf(Error);
    expect(new TelegramError("x").name).toBe("TelegramError");
  });
});
