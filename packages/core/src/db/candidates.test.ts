import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase, type Database } from "./client";
import { decideCandidate, recordTelegramMessage } from "./candidates";
import { postBatches, postCandidates, users } from "./schema";

/**
 * Integração contra o banco real, pulada sem DATABASE_URL — o caso do CI.
 *
 * O que se verifica aqui é a terceira barreira: que a decisão humana valha uma
 * vez só, que aprovar uma variação encerre as irmãs, e — a que mais importa —
 * que ninguém decida no lugar de outra pessoa.
 */

const connectionString = process.env["DATABASE_URL"];
const suite = connectionString === undefined ? describe.skip : describe;

suite("decideCandidate", () => {
  let db: Database;
  const criados: number[] = [];
  const marca = `cand-${String(process.pid)}-${String(Math.floor(performance.now()))}`;

  async function novoUsuario(sufixo: string): Promise<number> {
    const [linha] = await db
      .insert(users)
      .values({
        githubUserId: Number(String(process.pid) + String(criados.length + 1)),
        githubLogin: `${marca}-${sufixo}`,
      })
      .returning({ id: users.id });

    if (linha === undefined) throw new Error("insert de usuário não devolveu id");
    criados.push(linha.id);
    return linha.id;
  }

  /** Um lote com três variações pendentes, como o pipeline produz. */
  async function novoLote(userId: number, quantas = 3): Promise<number[]> {
    const [lote] = await db
      .insert(postBatches)
      .values({
        userId,
        windowStart: new Date("2026-08-13"),
        windowEnd: new Date("2026-08-20"),
        facts: [],
      })
      .returning({ id: postBatches.id });

    if (lote === undefined) throw new Error("insert de lote não devolveu id");

    const linhas = await db
      .insert(postCandidates)
      .values(
        Array.from({ length: quantas }, (_, i) => ({
          batchId: lote.id,
          userId,
          variantIndex: i,
          body: `variação ${String(i)}`,
        })),
      )
      .returning({ id: postCandidates.id });

    return linhas.map((l) => l.id);
  }

  async function statusDe(id: number): Promise<string | undefined> {
    const linhas = await db
      .select({ status: postCandidates.status })
      .from(postCandidates)
      .where(eq(postCandidates.id, id));

    return linhas[0]?.status;
  }

  beforeAll(() => {
    db = createDatabase(connectionString ?? "");
  });

  afterAll(async () => {
    for (const id of criados) await db.delete(users).where(eq(users.id, id));
    await closeDatabase(db);
  });

  it("aprovar uma variação encerra as irmãs", async () => {
    // As 2 ou 3 variações são do mesmo trabalho. Publicar duas seria contar a
    // mesma história duas vezes no perfil de alguém.
    const userId = await novoUsuario("aprovar");
    const [escolhida, outra, terceira] = await novoLote(userId);

    const resultado = await decideCandidate(db, userId, escolhida ?? 0, "approve");

    expect(resultado.tipo).toBe("aplicada");
    expect(await statusDe(escolhida ?? 0)).toBe("approved");
    expect(await statusDe(outra ?? 0)).toBe("superseded");
    expect(await statusDe(terceira ?? 0)).toBe("superseded");
  });

  it("recusar uma não diz nada sobre as outras", async () => {
    const userId = await novoUsuario("recusar");
    const [recusada, outra] = await novoLote(userId);

    const resultado = await decideCandidate(db, userId, recusada ?? 0, "reject");

    expect(resultado).toEqual({ tipo: "aplicada", decisao: "reject", encerradas: [] });
    expect(await statusDe(recusada ?? 0)).toBe("rejected");
    expect(await statusDe(outra ?? 0)).toBe("pending");
  });

  it("não deixa decidir duas vezes", async () => {
    // O Telegram reenvia updates, e o dev clica de novo quando acha que não
    // pegou. A segunda decisão não pode desfazer a primeira.
    const userId = await novoUsuario("duas-vezes");
    const [alvo] = await novoLote(userId);

    await decideCandidate(db, userId, alvo ?? 0, "approve");
    const segunda = await decideCandidate(db, userId, alvo ?? 0, "reject");

    expect(segunda).toEqual({ tipo: "ja-decidida", statusAtual: "approved" });
    expect(await statusDe(alvo ?? 0)).toBe("approved");
  });

  it("dois cliques ao mesmo tempo produzem uma decisão só", async () => {
    // A checagem de status ANTES da transação não cobre isto: duas requisições
    // simultâneas leem "pending" as duas. Quem decide de verdade é a condição
    // `status = pending` dentro do UPDATE, e é ela que este teste segura.
    //
    // O caso é real: o Telegram reenvia updates, e um duplo-toque no celular
    // dispara os dois cliques dentro do mesmo instante.
    const userId = await novoUsuario("corrida");
    const [alvo] = await novoLote(userId, 2);

    const [a, b] = await Promise.all([
      decideCandidate(db, userId, alvo ?? 0, "approve"),
      decideCandidate(db, userId, alvo ?? 0, "approve"),
    ]);

    const aplicadas = [a, b].filter((r) => r.tipo === "aplicada");
    expect(aplicadas).toHaveLength(1);
    expect(await statusDe(alvo ?? 0)).toBe("approved");
  });

  it("um dev NÃO decide o candidato de outro", async () => {
    // A trava mais importante do arquivo. O `callback_data` do botão carrega
    // só o id do candidato, e id é adivinhável — sem a checagem de dono,
    // qualquer chat vinculado publicaria no perfil de outra pessoa.
    const dono = await novoUsuario("dono");
    const intruso = await novoUsuario("intruso");
    const [alvo] = await novoLote(dono);

    const resultado = await decideCandidate(db, intruso, alvo ?? 0, "approve");

    expect(resultado).toEqual({ tipo: "nao-encontrada" });
    expect(await statusDe(alvo ?? 0)).toBe("pending");
  });

  it("responde igual para candidato de outro e para inexistente", async () => {
    // Distinguir os dois transformaria o botão num oráculo de quais ids
    // existem no sistema.
    const dono = await novoUsuario("oraculo-dono");
    const intruso = await novoUsuario("oraculo-intruso");
    const [alvo] = await novoLote(dono, 1);

    const alheio = await decideCandidate(db, intruso, alvo ?? 0, "approve");
    const inexistente = await decideCandidate(db, intruso, 2_000_000_000, "approve");

    expect(alheio).toEqual(inexistente);
  });

  it("devolve as mensagens das irmãs, para os botões delas sumirem", async () => {
    // Sem isto o banco encerrava as irmãs e o celular seguia mostrando botões
    // ativos nelas. O dev clicava achando que decidia e nada acontecia — foi o
    // que aconteceu no primeiro lote de verdade.
    const userId = await novoUsuario("mensagens");
    const [escolhida, outra] = await novoLote(userId, 2);

    await recordTelegramMessage(db, escolhida ?? 0, 1001);
    await recordTelegramMessage(db, outra ?? 0, 1002);

    const resultado = await decideCandidate(db, userId, escolhida ?? 0, "approve");

    expect(resultado.tipo).toBe("aplicada");
    if (resultado.tipo === "aplicada") expect(resultado.encerradas).toEqual([1002]);
  });

  it("ignora irmã que nunca chegou ao Telegram", async () => {
    // Lote gravado antes de a coluna existir, ou envio que falhou no meio.
    // Editar contra uma mensagem inexistente só geraria erro.
    const userId = await novoUsuario("sem-mensagem");
    const [escolhida, semId] = await novoLote(userId, 2);

    await recordTelegramMessage(db, escolhida ?? 0, 2001);

    const resultado = await decideCandidate(db, userId, escolhida ?? 0, "approve");

    expect(resultado.tipo).toBe("aplicada");
    if (resultado.tipo === "aplicada") expect(resultado.encerradas).toEqual([]);
    expect(await statusDe(semId ?? 0)).toBe("superseded");
  });

  it("encerra só as irmãs do mesmo lote", async () => {
    const userId = await novoUsuario("dois-lotes");
    const [primeiroLote] = await novoLote(userId, 2);
    const [outroLote] = await novoLote(userId, 2);

    await decideCandidate(db, userId, primeiroLote ?? 0, "approve");

    expect(await statusDe(outroLote ?? 0)).toBe("pending");
  });
});
