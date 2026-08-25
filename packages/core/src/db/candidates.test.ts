import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase, type Database } from "./client";
import {
  candidatosVencidos,
  decideCandidate,
  desagendarCandidato,
  recordTelegramMessage,
} from "./candidates";
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

  /**
   * Um lote pendente. `grupos` diz a que ASSUNTO cada variação pertence — é o
   * que distingue "três redações do mesmo trabalho" de "três trabalhos".
   */
  async function novoLote(userId: number, grupos: readonly number[] = [0, 0, 0]): Promise<number[]> {
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
        grupos.map((grupo, i) => ({
          batchId: lote.id,
          userId,
          variantIndex: i,
          themeGroup: grupo,
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

  async function agendaDe(id: number): Promise<Date | null | undefined> {
    const linhas = await db
      .select({ quando: postCandidates.scheduledFor })
      .from(postCandidates)
      .where(eq(postCandidates.id, id));

    return linhas[0]?.quando;
  }

  beforeAll(() => {
    db = createDatabase(connectionString ?? "");
  });

  afterAll(async () => {
    for (const id of criados) await db.delete(users).where(eq(users.id, id));
    await closeDatabase(db);
  });

  it("aprovar uma variação encerra as irmãs DO MESMO assunto", async () => {
    // As versões de um mesmo trabalho contam a mesma história. Publicar duas
    // seria dizer a mesma coisa duas vezes no perfil de alguém.
    const userId = await novoUsuario("aprovar");
    const [escolhida, outra, terceira] = await novoLote(userId, [0, 0, 0]);

    const resultado = await decideCandidate(db, userId, escolhida ?? 0, "approve");

    expect(resultado.tipo).toBe("aplicada");
    expect(await statusDe(escolhida ?? 0)).toBe("approved");
    expect(await statusDe(outra ?? 0)).toBe("superseded");
    expect(await statusDe(terceira ?? 0)).toBe("superseded");
  });

  it("aprovar um assunto NÃO encerra os outros assuntos", async () => {
    // A razão de o agrupamento existir. Sem o `theme_group` no WHERE, aprovar
    // o post sobre a lentidão mataria em silêncio o post sobre a migração — e
    // o dev só descobriria olhando o histórico, sem entender o que houve.
    const userId = await novoUsuario("assuntos");
    const [assuntoA, assuntoB, assuntoC] = await novoLote(userId, [0, 1, 2]);

    await decideCandidate(db, userId, assuntoA ?? 0, "approve");

    expect(await statusDe(assuntoA ?? 0)).toBe("approved");
    expect(await statusDe(assuntoB ?? 0)).toBe("pending");
    expect(await statusDe(assuntoC ?? 0)).toBe("pending");
  });

  it("encerra só as versões do assunto decidido, num lote misto", async () => {
    // O caso completo: dois assuntos, o primeiro com duas versões. Aprovar uma
    // versão encerra a irmã dela e deixa o outro assunto intacto.
    const userId = await novoUsuario("misto");
    const [versaoA1, versaoA2, assuntoB] = await novoLote(userId, [0, 0, 1]);

    await decideCandidate(db, userId, versaoA1 ?? 0, "approve");

    expect(await statusDe(versaoA1 ?? 0)).toBe("approved");
    expect(await statusDe(versaoA2 ?? 0)).toBe("superseded");
    expect(await statusDe(assuntoB ?? 0)).toBe("pending");
  });

  it("recusar uma não diz nada sobre as outras", async () => {
    const userId = await novoUsuario("recusar");
    const [recusada, outra] = await novoLote(userId);

    const resultado = await decideCandidate(db, userId, recusada ?? 0, "reject");

    expect(resultado).toMatchObject({ tipo: "aplicada", decisao: "reject", encerradas: [] });
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
    const [alvo] = await novoLote(userId, [0, 0]);

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
    const [alvo] = await novoLote(dono, [0]);

    const alheio = await decideCandidate(db, intruso, alvo ?? 0, "approve");
    const inexistente = await decideCandidate(db, intruso, 2_000_000_000, "approve");

    expect(alheio).toEqual(inexistente);
  });

  it("devolve as mensagens das irmãs, para os botões delas sumirem", async () => {
    // Sem isto o banco encerrava as irmãs e o celular seguia mostrando botões
    // ativos nelas. O dev clicava achando que decidia e nada acontecia — foi o
    // que aconteceu no primeiro lote de verdade.
    const userId = await novoUsuario("mensagens");
    const [escolhida, outra] = await novoLote(userId, [0, 0]);

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
    const [escolhida, semId] = await novoLote(userId, [0, 0]);

    await recordTelegramMessage(db, escolhida ?? 0, 2001);

    const resultado = await decideCandidate(db, userId, escolhida ?? 0, "approve");

    expect(resultado.tipo).toBe("aplicada");
    if (resultado.tipo === "aplicada") expect(resultado.encerradas).toEqual([]);
    expect(await statusDe(semId ?? 0)).toBe("superseded");
  });

  it("encerra só as irmãs do mesmo lote", async () => {
    const userId = await novoUsuario("dois-lotes");
    const [primeiroLote] = await novoLote(userId, [0, 0]);
    const [outroLote] = await novoLote(userId, [0, 0]);

    await decideCandidate(db, userId, primeiroLote ?? 0, "approve");

    expect(await statusDe(outroLote ?? 0)).toBe("pending");
  });
  // -------------------------------------------------------------------------
  // Agendamento — Fase 8
  // -------------------------------------------------------------------------

  it("agendar grava a hora e tira o post da fila de decisão", async () => {
    const userId = await novoUsuario("agendar");
    const [alvo] = await novoLote(userId, [0]);
    const quando = new Date("2027-01-15T12:00:00Z");

    const resultado = await decideCandidate(db, userId, alvo ?? 0, "schedule", quando);

    expect(resultado).toMatchObject({ tipo: "aplicada", decisao: "schedule" });
    expect(await statusDe(alvo ?? 0)).toBe("scheduled");
    expect((await agendaDe(alvo ?? 0))?.getTime()).toBe(quando.getTime());
  });

  it("agendar também encerra as versões irmãs", async () => {
    // O dev já disse sim; só disse para depois. Se as irmãs continuassem
    // pendentes, ele poderia agendar duas do mesmo assunto sem nada avisando —
    // e descobriria pelos dois posts iguais saindo em dias diferentes.
    const userId = await novoUsuario("agendar-irmas");
    const [alvo, irma, outroAssunto] = await novoLote(userId, [0, 0, 1]);

    await decideCandidate(db, userId, alvo ?? 0, "schedule", new Date("2027-01-15T12:00:00Z"));

    expect(await statusDe(irma ?? 0)).toBe("superseded");
    expect(await statusDe(outroAssunto ?? 0)).toBe("pending");
  });

  it("recusa agendar sem horário em vez de gravar um post que nunca vence", async () => {
    // `scheduled` com `scheduled_for` nulo é invisível para o workflow, que
    // procura o que já venceu. O post esperaria para sempre, e o histórico
    // diria "agendado" sem dizer para quando.
    const userId = await novoUsuario("sem-hora");
    const [alvo] = await novoLote(userId, [0]);

    expect(await decideCandidate(db, userId, alvo ?? 0, "schedule")).toEqual({
      tipo: "sem-horario",
    });
    expect(await decideCandidate(db, userId, alvo ?? 0, "schedule", new Date("x"))).toEqual({
      tipo: "sem-horario",
    });
    expect(await statusDe(alvo ?? 0)).toBe("pending");
  });

  it("aprovar depois de agendar não passa por cima da hora marcada", async () => {
    const userId = await novoUsuario("agendado-decidido");
    const [alvo] = await novoLote(userId, [0]);

    await decideCandidate(db, userId, alvo ?? 0, "schedule", new Date("2027-01-15T12:00:00Z"));
    const segunda = await decideCandidate(db, userId, alvo ?? 0, "approve");

    expect(segunda).toEqual({ tipo: "ja-decidida", statusAtual: "scheduled" });
    expect(await statusDe(alvo ?? 0)).toBe("scheduled");
  });
});

/**
 * A fila do workflow de hora em hora.
 *
 * O que se verifica é a pergunta que ele faz ao banco. Trazer de menos deixa
 * post agendado sem sair; trazer de mais publica antes da hora — e os dois
 * acontecem sem ninguém olhando, que é o que torna esta consulta delicada.
 */
suite("candidatosVencidos", () => {
  let db: Database;
  const criados: number[] = [];
  const marca = `venc-${String(process.pid)}-${String(Math.floor(performance.now()))}`;

  /** Um dev novo com um post já agendado. Devolve o dono e o candidato. */
  async function novoAgendado(
    sufixo: string,
    quando: Date | null,
  ): Promise<{ userId: number; candidateId: number }> {
    const [usuario] = await db
      .insert(users)
      .values({
        githubUserId: Number(String(process.pid) + String(criados.length + 90)),
        githubLogin: `${marca}-${sufixo}`,
      })
      .returning({ id: users.id });

    if (usuario === undefined) throw new Error("insert de usuário não devolveu id");
    criados.push(usuario.id);

    const [lote] = await db
      .insert(postBatches)
      .values({
        userId: usuario.id,
        windowStart: new Date("2026-08-13"),
        windowEnd: new Date("2026-08-20"),
        facts: [],
      })
      .returning({ id: postBatches.id });

    if (lote === undefined) throw new Error("insert de lote não devolveu id");

    const [candidato] = await db
      .insert(postCandidates)
      .values({
        batchId: lote.id,
        userId: usuario.id,
        variantIndex: 0,
        body: sufixo,
        status: "scheduled",
        scheduledFor: quando,
      })
      .returning({ id: postCandidates.id });

    if (candidato === undefined) throw new Error("insert de candidato não devolveu id");
    return { userId: usuario.id, candidateId: candidato.id };
  }

  beforeAll(() => {
    db = createDatabase(connectionString ?? "");
  });

  afterAll(async () => {
    for (const id of criados) await db.delete(users).where(eq(users.id, id));
    await closeDatabase(db);
  });

  it("traz o que venceu e ignora o que ainda não chegou a hora", async () => {
    const agora = new Date("2027-03-10T12:00:00Z");
    const vencido = await novoAgendado("vencido", new Date("2027-03-10T11:00:00Z"));
    const futuro = await novoAgendado("futuro", new Date("2027-03-10T13:00:00Z"));

    const ids = (await candidatosVencidos(db, agora, 100)).map((c) => c.id);

    expect(ids).toContain(vencido.candidateId);
    expect(ids).not.toContain(futuro.candidateId);
  });

  it("ignora agendado sem hora em vez de publicá-lo na primeira execução", async () => {
    // `scheduled_for` nulo não pode ser lido como "já venceu": seria um post
    // indo ao ar sem que ninguém tivesse marcado uma hora para ele.
    const semHora = await novoAgendado("sem-hora", null);
    const ids = (await candidatosVencidos(db, new Date("2027-03-10T12:00:00Z"), 100)).map(
      (c) => c.id,
    );

    expect(ids).not.toContain(semHora.candidateId);
  });

  it("devolve o mais atrasado primeiro", async () => {
    // Numa fila represada — depois de o LinkedIn passar um dia fora do ar — o
    // que já devia ter saído tem prioridade sobre o que acabou de vencer. Com
    // o limite, quem fica de fora fica para a hora seguinte; sem a ordem, o
    // mais atrasado seria justamente o que nunca chega a sair.
    //
    // O RECENTE é criado primeiro de propósito. Criando na ordem esperada, uma
    // consulta sem `ORDER BY` passaria por acaso — a ordem natural das linhas
    // já seria a certa, e o teste não estaria afirmando nada.
    const agora = new Date("2027-04-10T12:00:00Z");
    const recente = await novoAgendado("recente", new Date("2027-04-10T11:00:00Z"));
    const antigo = await novoAgendado("antigo", new Date("2027-04-08T09:00:00Z"));

    const ids = (await candidatosVencidos(db, agora, 100)).map((c) => c.id);

    expect(ids.indexOf(antigo.candidateId)).toBeLessThan(ids.indexOf(recente.candidateId));
  });

  it("respeita o limite, para uma fila represada não virar uma enxurrada", async () => {
    const agora = new Date("2027-05-10T12:00:00Z");
    for (const n of [1, 2, 3]) {
      await novoAgendado(`limite-${String(n)}`, new Date("2027-05-09T09:00:00Z"));
    }

    expect(await candidatosVencidos(db, agora, 2)).toHaveLength(2);
  });

  it("leva o dono junto, porque é o token dele que publica", async () => {
    const criado = await novoAgendado("dono", new Date("2027-08-10T09:00:00Z"));
    const fila = await candidatosVencidos(db, new Date("2027-08-10T12:00:00Z"), 100);

    expect(fila.find((c) => c.id === criado.candidateId)?.userId).toBe(criado.userId);
  });

  it("desagendar devolve o post para a fila e apaga a hora", async () => {
    const criado = await novoAgendado("desagendar", new Date("2027-06-10T09:00:00Z"));

    expect(await desagendarCandidato(db, criado.userId, criado.candidateId)).toBe(true);

    const linhas = await db
      .select({ status: postCandidates.status, quando: postCandidates.scheduledFor })
      .from(postCandidates)
      .where(eq(postCandidates.id, criado.candidateId));

    expect(linhas[0]?.status).toBe("approved");
    expect(linhas[0]?.quando).toBeNull();
  });

  it("um dev não desagenda o post de outro", async () => {
    // A mesma trava da decisão, e pela mesma razão: o id do candidato é
    // adivinhável, e sem o dono no WHERE qualquer um adiaria o post alheio.
    const dono = await novoAgendado("alheio", new Date("2027-07-10T09:00:00Z"));
    const intruso = await novoAgendado("intruso", new Date("2027-07-10T09:00:00Z"));

    expect(await desagendarCandidato(db, intruso.userId, dono.candidateId)).toBe(false);

    const linhas = await db
      .select({ status: postCandidates.status })
      .from(postCandidates)
      .where(eq(postCandidates.id, dono.candidateId));

    expect(linhas[0]?.status).toBe("scheduled");
  });
});
