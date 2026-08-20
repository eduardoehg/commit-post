import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase, type Database } from "../db/client";
import { users } from "../db/schema";
import {
  LINK_CODE_TTL_MS,
  SESSION_TTL_MS,
  bindTelegramChat,
  createSession,
  currentOrNewLinkCode,
  destroySession,
  issueLinkCode,
  redeemLinkCode,
  resolveSession,
} from "./index";

/**
 * Integração contra o banco real, pulada quando DATABASE_URL não existe — o
 * caso do CI.
 *
 * O que se verifica aqui não é "o Drizzle grava". É que sessão vencida não
 * abre porta, que dev desativado perde acesso sem ninguém caçar as sessões
 * dele, e que um código de vínculo serve uma vez só. Cada um desses é a
 * diferença entre uma trava existir e existir só no comentário.
 */

const connectionString = process.env["DATABASE_URL"];
const suite = connectionString === undefined ? describe.skip : describe;

suite("sessão e vínculos", () => {
  let db: Database;
  const criados: number[] = [];
  const marca = `auth-${String(process.pid)}-${String(Math.floor(performance.now()))}`;

  async function novoUsuario(sufixo: string): Promise<number> {
    const [linha] = await db
      .insert(users)
      .values({
        githubUserId: Number(String(process.pid) + String(criados.length + 1)),
        githubLogin: `${marca}-${sufixo}`,
        displayName: "Usuário de teste",
      })
      .returning({ id: users.id });

    if (linha === undefined) throw new Error("insert de usuário não devolveu id");
    criados.push(linha.id);
    return linha.id;
  }

  beforeAll(() => {
    db = createDatabase(connectionString ?? "");
  });

  afterAll(async () => {
    for (const id of criados) await db.delete(users).where(eq(users.id, id));
    await closeDatabase(db);
  });

  it("abre e fecha uma sessão", async () => {
    const userId = await novoUsuario("sessao");
    const { token } = await createSession(db, userId);

    expect((await resolveSession(db, token))?.id).toBe(userId);

    await destroySession(db, token);
    expect(await resolveSession(db, token)).toBeNull();
  });

  it("não abre com token vencido", async () => {
    // O prazo é conferido na consulta, não depois de ler a linha: não existe
    // caminho de código onde alguém esqueça de olhar a data.
    const userId = await novoUsuario("vencida");
    const { token } = await createSession(db, userId);

    const depois = Date.now() + SESSION_TTL_MS + 1000;
    expect(await resolveSession(db, token, depois)).toBeNull();
  });

  it("desativar o dev derruba as sessões abertas dele", async () => {
    // Sem isto, tirar o acesso de alguém exigiria caçar as sessões na mão.
    const userId = await novoUsuario("inativo");
    const { token } = await createSession(db, userId);
    expect(await resolveSession(db, token)).not.toBeNull();

    await db.update(users).set({ active: false }).where(eq(users.id, userId));
    expect(await resolveSession(db, token)).toBeNull();
  });

  it("ignora token inexistente sem estourar", async () => {
    expect(await resolveSession(db, "token-que-nunca-existiu")).toBeNull();
    expect(await resolveSession(db, undefined)).toBeNull();
  });

  it("resgata o código de vínculo uma vez só", async () => {
    const userId = await novoUsuario("codigo");
    const code = await issueLinkCode(db, userId);

    expect(await redeemLinkCode(db, code)).toBe(userId);
    expect(await redeemLinkCode(db, code)).toBeNull();
  });

  it("não resgata código vencido", async () => {
    const userId = await novoUsuario("codigo-vencido");
    const code = await issueLinkCode(db, userId);

    expect(await redeemLinkCode(db, code, "telegram", Date.now() + LINK_CODE_TTL_MS + 1000)).toBeNull();
  });

  it("reaproveita o código em vez de encher a tabela a cada recarga", async () => {
    const userId = await novoUsuario("codigo-reuso");
    const primeiro = await currentOrNewLinkCode(db, userId);
    expect(await currentOrNewLinkCode(db, userId)).toBe(primeiro);
  });

  it("emite código novo depois que o anterior foi usado", async () => {
    const userId = await novoUsuario("codigo-novo");
    const primeiro = await currentOrNewLinkCode(db, userId);
    await redeemLinkCode(db, primeiro);

    expect(await currentOrNewLinkCode(db, userId)).not.toBe(primeiro);
  });

  it("um chat do Telegram pertence a um dev só", async () => {
    // Um chat apontando para dois devs mandaria os posts de um para o outro
    // aprovar — e o índice único no banco recusaria a segunda gravação.
    const a = await novoUsuario("chat-a");
    const b = await novoUsuario("chat-b");
    const chat = `${marca}-chat`;

    await bindTelegramChat(db, a, chat);
    await bindTelegramChat(db, b, chat);

    const linhas = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramChatId, chat));

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.id).toBe(b);
  });
});
