import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COLLABORATION_SCOPE,
  GitHubAuthError,
  authorizeUrl,
  createAppJwt,
  exchangeCodeForToken,
  fetchVerifiedEmails,
  fetchViewerInstallations,
  installUrl,
  noreplyEmail,
} from "./app";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "pkcs1", format: "pem" },
});

const AGORA = 1_760_000_000_000;

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Responde a próxima chamada de fetch com este JSON. */
function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAppJwt", () => {
  it("emite o token com o iat no passado", () => {
    // O GitHub recusa token emitido no futuro, e o relógio do runner não é o
    // relógio deles. Sem a folga, o login falha de forma intermitente.
    const [, payload] = createAppJwt("4662011", privateKey, AGORA).split(".");
    const claims = decode(String(payload));

    expect(Number(claims["iat"])).toBeLessThan(Math.floor(AGORA / 1000));
    expect(Number(claims["exp"])).toBeGreaterThan(Math.floor(AGORA / 1000));
  });

  it("assina com RS256 e identifica o app", () => {
    const [header, payload] = createAppJwt("4662011", privateKey, AGORA).split(".");
    expect(decode(String(header))["alg"]).toBe("RS256");
    expect(decode(String(payload))["iss"]).toBe("4662011");
  });

  it("explica o que se esperava quando a chave não serve", () => {
    expect(() => createAppJwt("4662011", "não é um pem")).toThrow(GitHubAuthError);
  });
});

describe("authorizeUrl", () => {
  it("não pede escopo nenhum quando não recebe escopo", () => {
    // O GitHub App tira o alcance das permissões declaradas. Mandar `scope`
    // vazio aqui faria o GitHub tratar como pedido de escopo em branco.
    const url = new URL(
      authorizeUrl({ clientId: "Iv1", redirectUri: "https://x/cb", state: "abc" }),
    );
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x/cb");
  });

  it("leva o escopo quando é o caminho do OAuth clássico", () => {
    const url = new URL(
      authorizeUrl({
        clientId: "Ov23",
        redirectUri: "https://x/cb",
        state: "abc",
        scope: COLLABORATION_SCOPE,
      }),
    );
    expect(url.searchParams.get("scope")).toBe("repo");
  });
});

describe("installUrl", () => {
  it("aponta para a instalação do app pelo slug", () => {
    expect(installUrl("commit-post")).toBe("https://github.com/apps/commit-post/installations/new");
  });
});

describe("exchangeCodeForToken", () => {
  const options = {
    clientId: "Iv1",
    clientSecret: "segredo",
    code: "codigo",
    redirectUri: "https://x/cb",
  };

  it("levanta erro quando o GitHub devolve 200 com erro no corpo", async () => {
    // Este é o caso que morde: status 200, `access_token` ausente. Sem tratar
    // aqui, o undefined viaja três camadas antes de explodir longe da causa.
    mockFetch({ error: "bad_verification_code" });
    await expect(exchangeCodeForToken(options)).rejects.toThrow(/expirou ou já foi usado/);
  });

  it("levanta erro nomeando o motivo devolvido pelo GitHub", async () => {
    mockFetch({ error: "incorrect_client_credentials" });
    await expect(exchangeCodeForToken(options)).rejects.toThrow(/incorrect_client_credentials/);
  });

  it("converte expires_in em data absoluta", async () => {
    mockFetch({ access_token: "ghu_x", scope: "", expires_in: 28800 });
    const resultado = await exchangeCodeForToken(options);

    expect(resultado.accessToken).toBe("ghu_x");
    expect(resultado.expiresAt).toBeInstanceOf(Date);
  });

  it("aceita token sem prazo, que é o do OAuth clássico", async () => {
    mockFetch({ access_token: "gho_x", scope: "repo" });
    const resultado = await exchangeCodeForToken(options);

    expect(resultado.expiresAt).toBeNull();
    expect(resultado.scope).toBe("repo");
  });
});

describe("fetchVerifiedEmails", () => {
  it("descarta os não verificados", async () => {
    // Um e-mail não verificado pode ser de outra pessoa, e é por e-mail de
    // autor que decidimos de quem é cada commit.
    mockFetch([
      { email: "Eu@Exemplo.com", verified: true },
      { email: "chute@exemplo.com", verified: false },
    ]);

    await expect(fetchVerifiedEmails("token")).resolves.toEqual(["eu@exemplo.com"]);
  });

  it("propaga o 403 de App sem permissão de e-mail", async () => {
    mockFetch({ message: "Resource not accessible by integration" }, 403);
    await expect(fetchVerifiedEmails("token")).rejects.toThrow(GitHubAuthError);
  });
});

describe("fetchViewerInstallations", () => {
  it("marca instalação suspensa", async () => {
    mockFetch({
      installations: [
        { id: 1, account: { login: "acme", type: "Organization" }, suspended_at: "2026-01-01T00:00:00Z" },
        { id: 2, account: { login: "eu", type: "User" }, suspended_at: null },
      ],
    });

    const resultado = await fetchViewerInstallations("token");
    expect(resultado[0]?.suspended).toBe(true);
    expect(resultado[1]?.suspended).toBe(false);
    expect(resultado[0]?.accountType).toBe("Organization");
  });
});

describe("noreplyEmail", () => {
  it("monta o endereço que o GitHub usa em commits da interface web", () => {
    // Ele nunca aparece em /user/emails. Sem montá-lo, todo commit feito pelo
    // navegador ficaria órfão de dono.
    expect(
      noreplyEmail({ id: 12345, login: "EduardoEHG", name: null, avatarUrl: null }),
    ).toBe("12345+eduardoehg@users.noreply.github.com");
  });
});
