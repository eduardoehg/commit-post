import { describe, expect, it } from "vitest";
import {
  CryptoKeyError,
  DecryptionError,
  decryptSecret,
  encryptSecret,
  generateEncryptionKey,
  secretsMatch,
} from "./crypto.js";

const KEY = "a".repeat(64);
const OUTRA_KEY = "b".repeat(64);
const TOKEN = "ghu_AbCdEf0123456789xyzQWERTY";

describe("encryptSecret / decryptSecret", () => {
  it("volta ao valor original", () => {
    expect(decryptSecret(encryptSecret(TOKEN, KEY), KEY)).toBe(TOKEN);
  });

  it("preserva acentos e emoji", () => {
    const texto = "coração 🔐 ação";
    expect(decryptSecret(encryptSecret(texto, KEY), KEY)).toBe(texto);
  });

  it("preserva string vazia", () => {
    expect(decryptSecret(encryptSecret("", KEY), KEY)).toBe("");
  });

  it("nunca deixa o valor original aparecer no texto cifrado", () => {
    expect(encryptSecret(TOKEN, KEY)).not.toContain(TOKEN);
  });

  it("cifra o mesmo valor de formas diferentes a cada chamada", () => {
    // Sem isso, dois usuários com o mesmo token teriam linhas idênticas na
    // tabela — e quem olhasse saberia disso sem decifrar nada.
    expect(encryptSecret(TOKEN, KEY)).not.toBe(encryptSecret(TOKEN, KEY));
  });

  it("recusa decifrar com a chave errada", () => {
    expect(() => decryptSecret(encryptSecret(TOKEN, KEY), OUTRA_KEY)).toThrow(DecryptionError);
  });

  it("detecta adulteração do texto cifrado", () => {
    // É para isso que serve o GCM: sem a marca de autenticação, mexer nos bytes
    // devolveria lixo silenciosamente em vez de levantar erro.
    const payload = encryptSecret(TOKEN, KEY);
    const partes = payload.split(".");
    const dados = Buffer.from(partes[3] ?? "", "base64url");
    dados[0] = (dados[0] ?? 0) ^ 0xff;
    partes[3] = dados.toString("base64url");

    expect(() => decryptSecret(partes.join("."), KEY)).toThrow(DecryptionError);
  });

  it("detecta adulteração da marca de autenticação", () => {
    const partes = encryptSecret(TOKEN, KEY).split(".");
    const tag = Buffer.from(partes[2] ?? "", "base64url");
    tag[0] = (tag[0] ?? 0) ^ 0xff;
    partes[2] = tag.toString("base64url");

    expect(() => decryptSecret(partes.join("."), KEY)).toThrow(DecryptionError);
  });

  it("recusa formato irreconhecível", () => {
    for (const ruim of ["", "abc", "v1.só.duas", "v2.a.b.c", TOKEN]) {
      expect(() => decryptSecret(ruim, KEY)).toThrow(DecryptionError);
    }
  });

  it("recusa chave com tamanho ou formato errado", () => {
    for (const ruim of ["", "abc", "z".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      expect(() => encryptSecret(TOKEN, ruim)).toThrow(CryptoKeyError);
    }
  });

  it("não revela se a falha foi chave errada ou dado adulterado", () => {
    // Distinguir os dois ajudaria quem está tentando adivinhar a chave.
    let porChave = "";
    let porAdulteracao = "";

    try {
      decryptSecret(encryptSecret(TOKEN, KEY), OUTRA_KEY);
    } catch (e) {
      porChave = (e as Error).message;
    }

    const partes = encryptSecret(TOKEN, KEY).split(".");
    const dados = Buffer.from(partes[3] ?? "", "base64url");
    dados[0] = (dados[0] ?? 0) ^ 0xff;
    partes[3] = dados.toString("base64url");
    try {
      decryptSecret(partes.join("."), KEY);
    } catch (e) {
      porAdulteracao = (e as Error).message;
    }

    expect(porChave).toBe(porAdulteracao);
  });
});

describe("generateEncryptionKey", () => {
  it("gera chave no formato que parseKey aceita", () => {
    const chave = generateEncryptionKey();
    expect(chave).toMatch(/^[0-9a-f]{64}$/);
    expect(decryptSecret(encryptSecret(TOKEN, chave), chave)).toBe(TOKEN);
  });

  it("gera chaves diferentes", () => {
    expect(generateEncryptionKey()).not.toBe(generateEncryptionKey());
  });
});

describe("secretsMatch", () => {
  it("reconhece iguais e diferentes", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
  });

  it("não estoura com tamanhos diferentes", () => {
    expect(secretsMatch("abc", "abcdef")).toBe(false);
    expect(secretsMatch("", "x")).toBe(false);
  });
});
