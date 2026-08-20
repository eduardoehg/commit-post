import { describe, expect, it } from "vitest";
import { EnvValidationError, loadPipelineEnv, loadWebEnv } from "./env.js";

const SECRET = "a".repeat(64);

const validPipeline = {
  DATABASE_URL: "postgresql://u:p@host/db",
  GITHUB_TOKEN: "ghp_token",
  GITHUB_AUTHOR_EMAILS: "eu@pessoal.com, eu@empresa.com",
  ANTHROPIC_API_KEY: "sk-ant-key",
  TELEGRAM_BOT_TOKEN: "123:ABC",
  TELEGRAM_CHAT_ID: "999",
  PANEL_TOKEN_SECRET: SECRET,
  APP_BASE_URL: "https://commit-post.vercel.app",
};

const validWeb = {
  DATABASE_URL: "postgresql://u:p@host/db",
  TELEGRAM_BOT_TOKEN: "123:ABC",
  TELEGRAM_CHAT_ID: "999",
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  PANEL_TOKEN_SECRET: SECRET,
  APP_BASE_URL: "https://commit-post.vercel.app",
};

describe("loadPipelineEnv", () => {
  it("aceita um ambiente completo", () => {
    expect(() => loadPipelineEnv(validPipeline)).not.toThrow();
  });

  it("divide GITHUB_AUTHOR_EMAILS em lista, sem espaços sobrando", () => {
    const env = loadPipelineEnv(validPipeline);
    expect(env.GITHUB_AUTHOR_EMAILS).toEqual(["eu@pessoal.com", "eu@empresa.com"]);
  });

  it("rejeita e-mail malformado na lista", () => {
    expect(() =>
      loadPipelineEnv({ ...validPipeline, GITHUB_AUTHOR_EMAILS: "eu@pessoal.com,nao-e-email" }),
    ).toThrow(EnvValidationError);
  });

  it("usa 7 dias como janela padrão", () => {
    expect(loadPipelineEnv(validPipeline).GITHUB_LOOKBACK_DAYS).toBe(7);
  });

  it("converte GITHUB_LOOKBACK_DAYS para número", () => {
    const env = loadPipelineEnv({ ...validPipeline, GITHUB_LOOKBACK_DAYS: "14" });
    expect(env.GITHUB_LOOKBACK_DAYS).toBe(14);
  });

  it("rejeita janela de varredura zero ou não-numérica", () => {
    for (const bad of ["0", "-3", "sete", "7.5"]) {
      expect(() =>
        loadPipelineEnv({ ...validPipeline, GITHUB_LOOKBACK_DAYS: bad }),
      ).toThrow(EnvValidationError);
    }
  });

  it("rejeita segredo curto demais para assinar links", () => {
    expect(() =>
      loadPipelineEnv({ ...validPipeline, PANEL_TOKEN_SECRET: "curto" }),
    ).toThrow(EnvValidationError);
  });

  it("lista TODAS as variáveis faltantes de uma vez", () => {
    let message = "";
    try {
      loadPipelineEnv({ DATABASE_URL: "postgresql://u:p@host/db" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("GITHUB_TOKEN");
    expect(message).toContain("ANTHROPIC_API_KEY");
    expect(message).toContain("TELEGRAM_BOT_TOKEN");
  });
});

describe("loadWebEnv", () => {
  it("aceita um ambiente completo sem LinkedIn (opcional até a Fase 7)", () => {
    expect(() => loadWebEnv(validWeb)).not.toThrow();
  });

  it("exige TELEGRAM_WEBHOOK_SECRET — é o que prova que a chamada veio do Telegram", () => {
    const { TELEGRAM_WEBHOOK_SECRET: _omitted, ...semSecret } = validWeb;
    expect(() => loadWebEnv(semSecret)).toThrow(EnvValidationError);
  });

  it("exige TELEGRAM_CHAT_ID — é o que impede terceiros de aprovarem posts", () => {
    const { TELEGRAM_CHAT_ID: _omitted, ...semChat } = validWeb;
    expect(() => loadWebEnv(semChat)).toThrow(EnvValidationError);
  });

  it("rejeita APP_BASE_URL sem protocolo", () => {
    expect(() => loadWebEnv({ ...validWeb, APP_BASE_URL: "commit-post.vercel.app" })).toThrow(
      EnvValidationError,
    );
  });
});
