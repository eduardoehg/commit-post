import { describe, expect, it } from "vitest";
import { EnvValidationError, loadPipelineEnv, loadWebEnv } from "./env";

const SECRET = "a".repeat(64);
const HEX_KEY = "0123456789abcdef".repeat(4);

/** Não é uma chave de verdade; o validador só exige que o PEM se anuncie. */
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n";

const validPipeline = {
  DATABASE_URL: "postgresql://u:p@host/db",
  GITHUB_APP_ID: "4662011",
  GITHUB_APP_PRIVATE_KEY: PEM,
  ANTHROPIC_API_KEY: "sk-ant-key",
  TELEGRAM_BOT_TOKEN: "123:ABC",
  TELEGRAM_CHAT_ID: "999",
  PANEL_TOKEN_SECRET: SECRET,
  TOKEN_ENCRYPTION_KEY: HEX_KEY,
  APP_BASE_URL: "https://commit-post.vercel.app",
};

const validWeb = {
  DATABASE_URL: "postgresql://u:p@host/db",
  TELEGRAM_BOT_TOKEN: "123:ABC",
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  PANEL_TOKEN_SECRET: SECRET,
  ALLOWED_GITHUB_LOGINS: "eduardoehg,outrodev",
  TOKEN_ENCRYPTION_KEY: HEX_KEY,
  GITHUB_APP_ID: "4662011",
  GITHUB_APP_SLUG: "commit-post",
  GITHUB_APP_CLIENT_ID: "Iv23li000000000",
  GITHUB_APP_CLIENT_SECRET: "segredo-do-app",
  GITHUB_APP_PRIVATE_KEY: PEM,
  APP_BASE_URL: "https://commit-post.vercel.app",
};

describe("loadPipelineEnv", () => {
  it("aceita um ambiente completo", () => {
    expect(() => loadPipelineEnv(validPipeline)).not.toThrow();
  });

  it("não conhece mais token pessoal nem lista global de e-mails", () => {
    // Mudança da Fase 2. Cada dev tem as próprias instalações e os próprios
    // e-mails de autor, no banco. Um PAT do operador e uma lista única de
    // e-mails eram de quando o sistema atendia uma pessoa só — se sobrassem
    // aqui, um deles voltaria a ser usado sem ninguém notar.
    const env = loadPipelineEnv(validPipeline);
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_AUTHOR_EMAILS");
  });

  it("exige as credenciais do GitHub App, que substituíram o token pessoal", () => {
    for (const chave of ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"] as const) {
      const { [chave]: _omitida, ...incompleto } = validPipeline;
      expect(() => loadPipelineEnv(incompleto), `faltando ${chave}`).toThrow(EnvValidationError);
    }
  });

  it("recusa o Client ID no lugar do App ID, aqui também", () => {
    // A mesma trava do app web. Precisa de teste próprio: uma regra repetida
    // em dois schemas é uma regra que pode ser afrouxada em um só, e a
    // mutação passaria despercebida no outro.
    expect(() => loadPipelineEnv({ ...validPipeline, GITHUB_APP_ID: "Iv23li000000" })).toThrow(
      EnvValidationError,
    );
  });

  it("aceita a chave privada em base64 no runner", () => {
    const emBase64 = Buffer.from(PEM).toString("base64");
    expect(
      loadPipelineEnv({ ...validPipeline, GITHUB_APP_PRIVATE_KEY: emBase64 })
        .GITHUB_APP_PRIVATE_KEY,
    ).toContain("-----BEGIN");
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

  it("aceita denylist vazia — nem todo mundo tem nome de cliente a esconder", () => {
    expect(loadPipelineEnv(validPipeline).REDACT_DENIED_TERMS).toEqual([]);
  });

  it("divide REDACT_DENIED_TERMS em lista, sem espaços sobrando", () => {
    const env = loadPipelineEnv({
      ...validPipeline,
      REDACT_DENIED_TERMS: "Portal Meridiano, acme-billing , Zarvox",
    });
    expect(env.REDACT_DENIED_TERMS).toEqual(["Portal Meridiano", "acme-billing", "Zarvox"]);
  });

  it("rejeita chave de cifra que não seja 32 bytes em hex", () => {
    for (const ruim of ["", "abc", "z".repeat(64), "a".repeat(63)]) {
      expect(() => loadPipelineEnv({ ...validPipeline, TOKEN_ENCRYPTION_KEY: ruim })).toThrow(
        EnvValidationError,
      );
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
    expect(message).toContain("GITHUB_APP_ID");
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

  it("não exige TELEGRAM_CHAT_ID — com vários devs a allowlist mora no banco", () => {
    // Mudança da Fase 1.5. Quem pode aprovar um post não é mais "o chat desta
    // variável", e sim qualquer chat vinculado a um usuário ativo. A variável
    // sobreviveu só como destino de aviso do operador.
    expect(() => loadWebEnv(validWeb)).not.toThrow();
    expect(loadWebEnv(validWeb).TELEGRAM_CHAT_ID).toBeUndefined();
  });

  it("exige as credenciais do GitHub App — sem elas não há como entrar", () => {
    for (const chave of [
      "GITHUB_APP_ID",
      "GITHUB_APP_SLUG",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_PRIVATE_KEY",
    ] as const) {
      const { [chave]: _omitida, ...incompleto } = validWeb;
      expect(() => loadWebEnv(incompleto), `faltando ${chave}`).toThrow(EnvValidationError);
    }
  });

  it("recusa o Client ID no lugar do App ID", () => {
    // Os dois ficam lado a lado na mesma tela do GitHub e são trocados o
    // tempo todo. O App ID é numérico; o Client ID começa com "Iv".
    expect(() => loadWebEnv({ ...validWeb, GITHUB_APP_ID: "Iv23li000000000" })).toThrow(
      EnvValidationError,
    );
  });

  it("aceita a chave privada em base64, que é como ela cabe numa variável", () => {
    const emBase64 = Buffer.from(PEM).toString("base64");
    expect(loadWebEnv({ ...validWeb, GITHUB_APP_PRIVATE_KEY: emBase64 }).GITHUB_APP_PRIVATE_KEY)
      .toContain("-----BEGIN");
  });

  it("desfaz o \\n literal que painéis de deploy deixam no PEM", () => {
    const comEscape = PEM.replace(/\n/g, String.raw`\n`);
    expect(
      loadWebEnv({ ...validWeb, GITHUB_APP_PRIVATE_KEY: comEscape }).GITHUB_APP_PRIVATE_KEY,
    ).toBe(PEM);
  });

  it("recusa uma chave que não é PEM nem base64 de PEM", () => {
    expect(() => loadWebEnv({ ...validWeb, GITHUB_APP_PRIVATE_KEY: "cole aqui" })).toThrow(
      EnvValidationError,
    );
  });

  it("trata variável opcional declarada vazia como ausente", () => {
    // `FOO=` é como o .env.example distribui tudo que ainda não foi
    // preenchido. Tratar isso como "presente porém inválida" quebraria o boot
    // exatamente para quem copiou o exemplo à risca — que foi o que aconteceu.
    const env = loadWebEnv({
      ...validWeb,
      TELEGRAM_CHAT_ID: "",
      GITHUB_OAUTH_CLIENT_ID: "",
      GITHUB_OAUTH_CLIENT_SECRET: "  ",
      LINKEDIN_CLIENT_ID: "",
      LINKEDIN_REDIRECT_URI: "",
    });

    expect(env.TELEGRAM_CHAT_ID).toBeUndefined();
    expect(env.GITHUB_OAUTH_CLIENT_ID).toBeUndefined();
    expect(env.GITHUB_OAUTH_CLIENT_SECRET).toBeUndefined();
    expect(env.LINKEDIN_REDIRECT_URI).toBeUndefined();
  });

  it("continua recusando valor opcional preenchido errado", () => {
    // Vazio vale como ausente; errado continua sendo errado.
    expect(() => loadWebEnv({ ...validWeb, LINKEDIN_REDIRECT_URI: "commitpost.app/cb" })).toThrow(
      EnvValidationError,
    );
  });

  it("mantém o OAuth de colaborações opcional", () => {
    expect(loadWebEnv(validWeb).GITHUB_OAUTH_CLIENT_ID).toBeUndefined();
    expect(
      loadWebEnv({ ...validWeb, GITHUB_OAUTH_CLIENT_ID: "Ov23", GITHUB_OAUTH_CLIENT_SECRET: "s" })
        .GITHUB_OAUTH_CLIENT_ID,
    ).toBe("Ov23");
  });

  it("divide a allowlist de logins do GitHub em lista", () => {
    expect(loadWebEnv(validWeb).ALLOWED_GITHUB_LOGINS).toEqual(["eduardoehg", "outrodev"]);
  });

  it("exige a allowlist — esquecê-la deve quebrar no boot, não trancar todos para fora", () => {
    const { ALLOWED_GITHUB_LOGINS: _omitida, ...semAllowlist } = validWeb;
    expect(() => loadWebEnv(semAllowlist)).toThrow(EnvValidationError);
  });

  it("aceita allowlist deliberadamente vazia", () => {
    const env = loadWebEnv({ ...validWeb, ALLOWED_GITHUB_LOGINS: "" });
    expect(env.ALLOWED_GITHUB_LOGINS).toEqual([]);
  });

  it("rejeita APP_BASE_URL sem protocolo", () => {
    expect(() => loadWebEnv({ ...validWeb, APP_BASE_URL: "commit-post.vercel.app" })).toThrow(
      EnvValidationError,
    );
  });
});
