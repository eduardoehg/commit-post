import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_VERSION,
  REQUIRED_SCOPES,
  TOKEN_EXPIRY_WARNING_DAYS,
  authorizeUrl,
  avaliarExpiracao,
  memberUrn,
  publishPost,
  textoExpiracao,
} from "./index";

const AGORA = new Date("2026-08-25T12:00:00Z");
const DIA = 86_400_000;

function daquiA(dias: number): Date {
  return new Date(AGORA.getTime() + dias * DIA);
}

describe("authorizeUrl", () => {
  it("pede os três escopos — os dois de identidade não são opcionais", () => {
    // Sem `openid profile` não há URN do autor, e sem URN o token publica em
    // nome de ninguém.
    const url = new URL(
      authorizeUrl({ clientId: "77kx", redirectUri: "https://x/cb", state: "abc" }),
    );

    expect(url.searchParams.get("scope")).toBe(REQUIRED_SCOPES.join(" "));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("abc");
  });
});

describe("memberUrn", () => {
  it("monta o formato que a API de posts exige em `author`", () => {
    expect(memberUrn("abc123")).toBe("urn:li:person:abc123");
  });
});

describe("avaliarExpiracao", () => {
  it("não inventa aviso para token sem prazo", () => {
    // Um aviso permanente sobre algo que não vence é ruído que ensina o dev a
    // ignorar avisos.
    expect(avaliarExpiracao(null, AGORA)).toBeNull();
  });

  it("fica quieto enquanto falta muito", () => {
    const estado = avaliarExpiracao(daquiA(60), AGORA);
    expect(estado?.precisaAvisar).toBe(false);
    expect(estado?.diasRestantes).toBe(60);
  });

  it("avisa a partir do limiar", () => {
    // Aqui não há renovação automática: o refresh token não é concedido no
    // tier padrão do LinkedIn. Avisar antes é a única defesa.
    expect(avaliarExpiracao(daquiA(TOKEN_EXPIRY_WARNING_DAYS + 1), AGORA)?.precisaAvisar).toBe(false);
    expect(avaliarExpiracao(daquiA(TOKEN_EXPIRY_WARNING_DAYS), AGORA)?.precisaAvisar).toBe(true);
    expect(avaliarExpiracao(daquiA(1), AGORA)?.precisaAvisar).toBe(true);
  });

  it("continua avisando depois de vencer", () => {
    // É o único momento em que o dev DEVE agir; silenciar aí seria silenciar
    // justamente quando importa.
    const estado = avaliarExpiracao(daquiA(-3), AGORA);
    expect(estado?.vencido).toBe(true);
    expect(estado?.precisaAvisar).toBe(true);
  });

  it("trata o que vence hoje como ainda não vencido", () => {
    const estado = avaliarExpiracao(new Date(AGORA.getTime() + 6 * 3600_000), AGORA);
    expect(estado?.vencido).toBe(false);
    expect(estado?.diasRestantes).toBe(0);
  });
});

describe("textoExpiracao", () => {
  it("diz o que fazer, não só o que aconteceu", () => {
    // "Token expirado" sozinho não é aviso, é diagnóstico. Quem lê precisa
    // saber para onde ir.
    for (const dias of [-5, 0, 3, 7]) {
      const estado = avaliarExpiracao(daquiA(dias), AGORA);
      expect(estado).not.toBeNull();
      expect(textoExpiracao(estado!)).toMatch(/Conexões/);
    }
  });

  it("distingue vencido de a vencer", () => {
    expect(textoExpiracao(avaliarExpiracao(daquiA(-1), AGORA)!)).toMatch(/venceu/);
    expect(textoExpiracao(avaliarExpiracao(daquiA(5), AGORA)!)).toMatch(/vence em 5/);
  });

  it("não escreve 'vence em 0 dias'", () => {
    // O caso das últimas horas: o número certo é inútil, a frase é o que vale.
    expect(textoExpiracao(avaliarExpiracao(new Date(AGORA.getTime() + 3600_000), AGORA)!)).toMatch(
      /hoje/,
    );
  });
});

describe("publishPost", () => {
  const base = {
    accessToken: "t",
    authorUrn: "urn:li:person:abc",
    texto: "Resolvi uma condição de corrida.",
  };

  function responder(status: number, headers: Record<string, string> = {}, corpo = ""): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(corpo, { status, headers }))),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publica como PUBLICADO e PÚBLICO, sem rascunho", async () => {
    // O padrão de rascunho transformaria "aprovei" em "não saiu", e o dev só
    // descobriria olhando o próprio perfil.
    const chamada = vi.fn(() =>
      Promise.resolve(new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:1" } })),
    );
    vi.stubGlobal("fetch", chamada);

    await publishPost(base);

    const corpo = JSON.parse(String(chamada.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(corpo["lifecycleState"]).toBe("PUBLISHED");
    expect(corpo["visibility"]).toBe("PUBLIC");
    expect(corpo["author"]).toBe("urn:li:person:abc");
  });

  it("manda o texto exatamente como foi aprovado", async () => {
    // Ele já atravessou as três barreiras. Reformatar aqui significaria
    // publicar algo diferente do que a pessoa leu e aprovou.
    const texto = "Linha 1.\n\nLinha 2 com <sinal> & \"aspas\".";
    const chamada = vi.fn(() =>
      Promise.resolve(new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:1" } })),
    );
    vi.stubGlobal("fetch", chamada);

    await publishPost({ ...base, texto });

    const corpo = JSON.parse(String(chamada.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(corpo["commentary"]).toBe(texto);
  });

  it("devolve o urn do cabeçalho e monta o link", async () => {
    // A resposta de criação do LinkedIn é vazia: o id vem no cabeçalho. Sem
    // ele não há link nem registro do que foi ao ar.
    responder(201, { "x-restli-id": "urn:li:share:7123" });
    const r = await publishPost(base);

    expect(r.urn).toBe("urn:li:share:7123");
    expect(r.url).toContain("urn:li:share:7123");
  });

  it("recusa quando o LinkedIn aceita mas não devolve identificador", async () => {
    responder(201);
    await expect(publishPost(base)).rejects.toThrow(/identificador/);
  });

  it("aponta a versão da API quando é ela que está errada", async () => {
    // 426 é o jeito do LinkedIn dizer "essa versão não existe mais". Sem
    // nomear a constante, sobra um número e uma tarde de tentativa e erro.
    responder(426, {}, "unsupported version");
    await expect(publishPost(base)).rejects.toThrow(new RegExp(API_VERSION));
  });

  it("carrega o status para quem chama distinguir token vencido", async () => {
    responder(401, {}, "invalid token");
    await expect(publishPost(base)).rejects.toMatchObject({ status: 401 });
  });
});
