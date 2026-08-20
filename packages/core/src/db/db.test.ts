import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase, type Database } from "./client.js";
import {
  commits,
  deniedTerms,
  postBatches,
  postCandidates,
  repos,
  userEmails,
  users,
} from "./schema.js";

/**
 * Teste de integração contra o banco real.
 *
 * Pula quando DATABASE_URL não está definida — é o caso do CI, que não recebe
 * o segredo. Rodar localmente com `npm test` depois de `db:migrate`.
 *
 * O que importa aqui não é "o Drizzle funciona", é que as restrições que
 * sustentam decisões de projeto realmente existem no banco: a que torna a
 * execução idempotente, a que impede dois devs de reivindicarem o mesmo
 * e-mail, e o cascade que faz apagar um usuário apagar tudo dele.
 */

const connectionString = process.env["DATABASE_URL"];
const suite = connectionString === undefined ? describe.skip : describe;

suite("schema — restrições que sustentam o projeto", () => {
  let db: Database;
  const criados: number[] = [];

  /** Sufixo por execução, para os testes não colidirem entre si. */
  const marca = `test-${process.pid}-${Math.floor(performance.now())}`;

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

  it("conecta e enxerga as tabelas migradas", async () => {
    const linhas = await db.select().from(users).limit(1);
    expect(Array.isArray(linhas)).toBe(true);
  });

  it("impede o mesmo commit de entrar duas vezes para o mesmo dev", async () => {
    // Esta é a restrição que torna re-executar o workflow seguro.
    const userId = await novoUsuario("sha");
    const [repo] = await db
      .insert(repos)
      .values({ userId, externalId: Date.now(), alias: "repo-teste" })
      .returning({ id: repos.id });
    if (repo === undefined) throw new Error("insert de repo falhou");

    const linha = {
      userId,
      repoId: repo.id,
      sha: "cafe1234",
      authoredAt: new Date(),
      fileExtensions: ["ts"],
      fileCount: 1,
    };

    await db.insert(commits).values(linha);
    await expect(db.insert(commits).values(linha)).rejects.toThrow();
  });

  it("permite o mesmo sha para devs diferentes", async () => {
    // Dois devs no mesmo repositório podem legitimamente coletar o mesmo
    // commit — a restrição é por usuário, não global.
    const a = await novoUsuario("sha-a");
    const b = await novoUsuario("sha-b");

    const shaCompartilhado = `feed${Date.now()}`;
    for (const userId of [a, b]) {
      const [repo] = await db
        .insert(repos)
        .values({ userId, externalId: Date.now() + userId, alias: "repo-teste" })
        .returning({ id: repos.id });
      if (repo === undefined) throw new Error("insert de repo falhou");

      await db.insert(commits).values({
        userId,
        repoId: repo.id,
        sha: shaCompartilhado,
        authoredAt: new Date(),
      });
    }

    const encontrados = await db.select().from(commits).where(eq(commits.sha, shaCompartilhado));
    expect(encontrados).toHaveLength(2);
  });

  it("impede dois devs de reivindicarem o mesmo e-mail de autor", async () => {
    // Sem isso o mesmo commit seria coletado duas vezes e viraria post duas
    // vezes, uma para cada dono.
    const a = await novoUsuario("email-a");
    const b = await novoUsuario("email-b");
    const email = `${marca}@exemplo.com`;

    await db.insert(userEmails).values({ userId: a, email });
    await expect(db.insert(userEmails).values({ userId: b, email })).rejects.toThrow();
  });

  it("guarda termos proibidos por dev, sem repetir", async () => {
    const userId = await novoUsuario("termos");
    await db.insert(deniedTerms).values({ userId, term: "Portal Meridiano", source: "manual" });
    await expect(
      db.insert(deniedTerms).values({ userId, term: "Portal Meridiano" }),
    ).rejects.toThrow();
  });

  it("cria candidato com status pending por padrão", async () => {
    const userId = await novoUsuario("lote");
    const [lote] = await db
      .insert(postBatches)
      .values({
        userId,
        windowStart: new Date("2026-08-01"),
        windowEnd: new Date("2026-08-08"),
        facts: [{ changeKind: "bugfix", technologies: ["cache"] }],
      })
      .returning({ id: postBatches.id });
    if (lote === undefined) throw new Error("insert de lote falhou");

    const [candidato] = await db
      .insert(postCandidates)
      .values({ batchId: lote.id, userId, variantIndex: 0, body: "texto do post" })
      .returning({ status: postCandidates.status });

    expect(candidato?.status).toBe("pending");
  });

  it("apaga tudo do dev junto com ele", async () => {
    const userId = await novoUsuario("cascata");
    await db.insert(deniedTerms).values({ userId, term: "algum termo" });
    await db.insert(userEmails).values({ userId, email: `${marca}-cascata@exemplo.com` });

    await db.delete(users).where(eq(users.id, userId));

    const termos = await db.select().from(deniedTerms).where(eq(deniedTerms.userId, userId));
    const emails = await db.select().from(userEmails).where(eq(userEmails.userId, userId));
    expect(termos).toEqual([]);
    expect(emails).toEqual([]);
  });

  it("separa os dados de um dev dos do outro", async () => {
    const a = await novoUsuario("iso-a");
    const b = await novoUsuario("iso-b");
    await db.insert(deniedTerms).values({ userId: a, term: `${marca}-so-do-a` });

    const doB = await db
      .select()
      .from(deniedTerms)
      .where(and(eq(deniedTerms.userId, b), eq(deniedTerms.term, `${marca}-so-do-a`)));

    expect(doB).toEqual([]);
  });
});
