import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, createDatabase, type Database } from "./client";
import {
  decideAccess,
  grantAccess,
  listAccess,
  normalizeLogin,
  podeRevogar,
  revokeAccess,
} from "./access";
import { allowedLogins, users } from "./schema";

describe("normalizeLogin", () => {
  it("achata caixa e espaço — o GitHub não diferencia login por caixa", () => {
    expect(normalizeLogin("  EduardoEHG ")).toBe("eduardoehg");
  });
});

describe("podeRevogar", () => {
  it("protege o dono", () => {
    // Sem esta regra um clique deixaria o sistema sem ninguém capaz de
    // convidar, e o caminho de volta seria editar variável de ambiente.
    expect(podeRevogar({ papel: "owner" })).toBe(false);
    expect(podeRevogar({ papel: "dev" })).toBe(true);
    expect(podeRevogar({ papel: null })).toBe(true);
  });
});

// ---------------------------------------------------------------------------

const connectionString = process.env["DATABASE_URL"];
const suite = connectionString === undefined ? describe.skip : describe;

suite("acesso ao sistema", () => {
  let db: Database;
  const criados: number[] = [];
  const convites: string[] = [];
  const marca = `acesso-${String(process.pid)}-${String(Math.floor(performance.now()))}`;

  async function novoUsuario(login: string, papel = "dev"): Promise<number> {
    const [linha] = await db
      .insert(users)
      .values({
        githubUserId: Number(String(process.pid) + String(criados.length + 1)),
        githubLogin: login,
        role: papel,
      })
      .returning({ id: users.id });

    if (linha === undefined) throw new Error("insert falhou");
    criados.push(linha.id);
    return linha.id;
  }

  async function convidar(login: string, por: number): Promise<void> {
    convites.push(login);
    await grantAccess(db, login, por);
  }

  beforeAll(() => {
    db = createDatabase(connectionString ?? "");
  });

  afterAll(async () => {
    for (const login of convites) await db.delete(allowedLogins).where(eq(allowedLogins.login, login));
    for (const id of criados) await db.delete(users).where(eq(users.id, id));
    await closeDatabase(db);
  });

  it("recusa quem não está em lista nenhuma", async () => {
    // A única coisa que impede o sistema de virar cadastro aberto: sem isso,
    // qualquer conta do GitHub entraria e passaria a consumir a chave da
    // Anthropic do operador.
    const decisao = await decideAccess(db, `${marca}-estranho`, []);
    expect(decisao.permitido).toBe(false);
  });

  it("aceita quem está na variável de ambiente", async () => {
    // A escotilha: se o banco travar todo mundo do lado de fora, editar a
    // variável é o caminho de volta que não exige estar logado.
    const decisao = await decideAccess(db, `${marca}-semente`, [`${marca}-semente`]);
    expect(decisao.permitido).toBe(true);
  });

  it("aceita quem foi convidado no banco", async () => {
    const dono = await novoUsuario(`${marca}-dono`, "owner");
    await convidar(`${marca}-convidado`, dono);

    expect((await decideAccess(db, `${marca}-convidado`, [])).permitido).toBe(true);
  });

  it("não diferencia caixa em nenhum dos dois caminhos", async () => {
    const dono = await novoUsuario(`${marca}-caixa-dono`, "owner");
    await convidar(`${marca}-caixa`, dono);

    expect((await decideAccess(db, `${marca}-CAIXA`.toUpperCase(), [])).permitido).toBe(true);
    expect((await decideAccess(db, `${marca}-ENV`, [`${marca}-env`])).permitido).toBe(true);
  });

  it("só vira dono quando não existe usuário nenhum", async () => {
    // Já existe gente no banco desta suíte, então ninguém mais assume. É a
    // única forma de virar dono: não há tela que promova.
    const decisao = await decideAccess(db, `${marca}-tardio`, [`${marca}-tardio`]);
    expect(decisao.permitido).toBe(true);
    expect(decisao.seraDono).toBe(false);
  });

  it("convidar duas vezes não duplica", async () => {
    const dono = await novoUsuario(`${marca}-dup-dono`, "owner");
    await convidar(`${marca}-dup`, dono);
    await grantAccess(db, `${marca}-dup`, dono);

    const lista = (await listAccess(db)).filter((c) => c.login === `${marca}-dup`);
    expect(lista).toHaveLength(1);
  });

  it("remover tira o convite E desativa a conta", async () => {
    // Só apagar o convite não fecha porta nenhuma: quem já entrou tem sessão
    // aberta e continuaria entrando por catorze dias.
    const dono = await novoUsuario(`${marca}-rev-dono`, "owner");
    const alvo = `${marca}-rev-alvo`;
    await convidar(alvo, dono);
    const alvoId = await novoUsuario(alvo);

    await revokeAccess(db, alvo);

    const [conta] = await db.select({ active: users.active }).from(users).where(eq(users.id, alvoId));
    expect(conta?.active).toBe(false);
    expect((await decideAccess(db, alvo, [])).permitido).toBe(false);
  });

  it("remover NÃO desativa um dono", async () => {
    // A checagem de `podeRevogar` acontece antes, na ação; esta é a segunda
    // trava, na consulta — para o dia em que alguém chamar a função direto.
    const donoLogin = `${marca}-dono-protegido`;
    const donoId = await novoUsuario(donoLogin, "owner");

    await revokeAccess(db, donoLogin);

    const [conta] = await db.select({ active: users.active }).from(users).where(eq(users.id, donoId));
    expect(conta?.active).toBe(true);
  });

  it("mostra quem já entrou e quem só foi convidado", async () => {
    const dono = await novoUsuario(`${marca}-lista-dono`, "owner");
    const entrou = `${marca}-lista-entrou`;
    const soConvidado = `${marca}-lista-convidado`;

    await convidar(entrou, dono);
    await convidar(soConvidado, dono);
    await novoUsuario(entrou);

    const lista = await listAccess(db);
    expect(lista.find((c) => c.login === entrou)?.usuarioId).not.toBeNull();
    expect(lista.find((c) => c.login === soConvidado)?.usuarioId).toBeNull();
  });
});
