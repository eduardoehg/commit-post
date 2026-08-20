import { describe, expect, it } from "vitest";
import { STATE_TTL_SECONDS, signState, verifyState } from "./state";

const SECRET = "s".repeat(64);
const OUTRO = "t".repeat(64);
const AGORA = 1_760_000_000_000;

describe("signState / verifyState", () => {
  it("devolve o payload original, sem os campos internos", () => {
    const token = signState({ k: "app", b: "impressao" }, SECRET, AGORA);
    expect(verifyState(token, SECRET, AGORA)).toEqual({ k: "app", b: "impressao" });
  });

  it("recusa assinatura de outro segredo", () => {
    // É o que impede alguém de forjar um `state` sem conhecer o segredo.
    const token = signState({ k: "app" }, OUTRO, AGORA);
    expect(verifyState(token, SECRET, AGORA)).toBeNull();
  });

  it("recusa quando o payload foi trocado depois de assinado", () => {
    const token = signState({ k: "app" }, SECRET, AGORA);
    const [, assinatura] = token.split(".");
    const forjado = Buffer.from(JSON.stringify({ k: "collab", n: "x", e: "99999999999" })).toString(
      "base64url",
    );

    expect(verifyState(`${forjado}.${String(assinatura)}`, SECRET, AGORA)).toBeNull();
  });

  it("recusa quando a assinatura foi mexida", () => {
    const token = signState({ k: "app" }, SECRET, AGORA);
    expect(verifyState(`${token}x`, SECRET, AGORA)).toBeNull();
  });

  it("vence depois do prazo", () => {
    const token = signState({ k: "app" }, SECRET, AGORA);
    const umPouoDepois = AGORA + STATE_TTL_SECONDS * 1000 - 1000;
    const depoisDoPrazo = AGORA + STATE_TTL_SECONDS * 1000 + 1000;

    expect(verifyState(token, SECRET, umPouoDepois)).not.toBeNull();
    expect(verifyState(token, SECRET, depoisDoPrazo)).toBeNull();
  });

  it("gera tokens diferentes para o mesmo payload", () => {
    // Sem o nonce, dois logins seguidos produziriam o mesmo `state` — e um
    // `state` previsível não prova nada sobre de onde o retorno partiu.
    expect(signState({ k: "app" }, SECRET, AGORA)).not.toBe(signState({ k: "app" }, SECRET, AGORA));
  });

  it("devolve null em vez de estourar com entrada malformada", () => {
    for (const ruim of ["", ".", "semponto", "a.b", "!!!.???"]) {
      expect(verifyState(ruim, SECRET, AGORA)).toBeNull();
    }
  });
});
