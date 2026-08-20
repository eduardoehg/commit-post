import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubCollectError,
  fileExtensionsOf,
  listCommits,
  listInstallationRepositories,
} from "./collect";

/**
 * `fileExtensionsOf` é a fronteira entre "caminho de arquivo" e "rótulo
 * seguro". Do outro lado dela existe `src/clients/acme-corp/faturamento.ts`;
 * deste lado só pode existir `ts`.
 *
 * Por isso os testes aqui afirmam sobre o que NÃO sai, não só sobre o que sai:
 * um teste que só confere `["ts"]` passaria mesmo se a função devolvesse
 * também o nome da pasta.
 */
describe("fileExtensionsOf", () => {
  it("devolve a extensão sem nada do caminho", () => {
    expect(fileExtensionsOf(["src/clients/acme-corp/faturamento.ts"])).toEqual(["ts"]);
  });

  it("nunca deixa passar pedaço de caminho, seja qual for o formato", () => {
    const caminhos = [
      "src/clients/acme-corp/faturamento.ts",
      "packages/produto-interno/cobranca.sql",
      "apps/portal-banco-x/index.tsx",
      "infra/terraform/cliente_y.tf",
      "C:\\projetos\\ClienteZ\\main.cs",
    ];

    const saida = fileExtensionsOf(caminhos).join(" ");
    for (const proibido of [
      "acme",
      "corp",
      "produto",
      "interno",
      "portal",
      "banco",
      "cliente",
      "ClienteZ",
      "src",
      "apps",
      "infra",
      "projetos",
      "faturamento",
      "cobranca",
    ]) {
      expect(saida.toLowerCase()).not.toContain(proibido.toLowerCase());
    }

    expect(fileExtensionsOf(caminhos)).toEqual(["cs", "sql", "tf", "ts", "tsx"]);
  });

  it("trata a barra invertida como separador", () => {
    // Sem isto, um `\` no nome faria o resto do caminho passar por extensão.
    expect(fileExtensionsOf(["dir\\sub\\arquivo.py"])).toEqual(["py"]);
  });

  it("ignora arquivo sem extensão em vez de usar o nome dele", () => {
    // Nome de arquivo é caminho. `Dockerfile.acme` viraria "acme" se a função
    // pegasse o começo em vez do fim.
    expect(fileExtensionsOf(["Dockerfile", "LICENSE", "Makefile"])).toEqual([]);
  });

  it("não confunde arquivo oculto com extensão", () => {
    expect(fileExtensionsOf([".gitignore", ".env"])).toEqual([]);
  });

  it("usa só o que vem depois do último ponto", () => {
    expect(fileExtensionsOf(["relatorio.cliente-x.pdf"])).toEqual(["pdf"]);
  });

  it("descarta o que não parece extensão", () => {
    // Um "extensão" com hífen, espaço ou 30 caracteres é resto de nome, não
    // linguagem. Descartar em silêncio é melhor do que virar rótulo.
    expect(
      fileExtensionsOf([
        "a.nome-com-hifen",
        "b.com espaco",
        "c." + "x".repeat(30),
        "d.cliente_interno",
        "e.",
      ]),
    ).toEqual([]);
  });

  it("normaliza a caixa e não repete", () => {
    expect(fileExtensionsOf(["a.TS", "b.ts", "c.Ts"])).toEqual(["ts"]);
  });

  it("devolve em ordem estável", () => {
    // Duas execuções da mesma coleta não podem gerar linhas diferentes no
    // banco só porque o GitHub devolveu os arquivos em outra ordem.
    expect(fileExtensionsOf(["z.sql", "a.ts"])).toEqual(fileExtensionsOf(["a.ts", "z.sql"]));
  });

  it("aguenta lista vazia", () => {
    expect(fileExtensionsOf([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/** Responde cada chamada de fetch conforme o caminho pedido. */
function mockGitHub(rotas: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const chamadas = vi.fn((url: string) => {
    const caminho = new URL(url).pathname;
    const corpo = rotas[caminho];

    if (corpo === undefined) {
      return Promise.resolve(new Response("não encontrado", { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  vi.stubGlobal("fetch", chamadas);
  return chamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = {
  externalId: 1,
  owner: "acme-corp",
  name: "faturamento",
  alias: "repo-1",
  private: true,
};

const JANELA = { since: new Date("2026-08-01"), until: new Date("2026-08-08") };

describe("listCommits", () => {
  it("devolve o alias, nunca o nome real do repositório", async () => {
    // O `RawCommit` é o que sobe para o filtro. Se o nome real viajasse aqui,
    // toda a decisão de não persistir nome de repo seria contornada.
    mockGitHub({
      "/repos/acme-corp/faturamento/commits": [
        { sha: "abc", commit: { author: { email: "eu@x.com", date: "2026-08-02" }, message: "fix" } },
      ],
      "/repos/acme-corp/faturamento/commits/abc": { files: [{ filename: "src/acme/a.ts" }] },
    });

    const [commit] = await listCommits({
      token: "t",
      repo: REPO,
      authorEmails: ["eu@x.com"],
      ...JANELA,
    });

    expect(commit?.repoAlias).toBe("repo-1");
    expect(JSON.stringify(commit)).not.toContain("faturamento");
    expect(JSON.stringify(commit)).not.toContain("acme");
  });

  it("descarta commit de outro autor mesmo se a API devolver", async () => {
    // A API aceita login OU e-mail no mesmo parâmetro `author`, e um login que
    // coincida traria commit alheio — que viraria post no nome de quem não o
    // escreveu. A conferência local é o que impede isso.
    mockGitHub({
      "/repos/acme-corp/faturamento/commits": [
        { sha: "meu", commit: { author: { email: "EU@x.com", date: "2026-08-02" }, message: "a" } },
        { sha: "alheio", commit: { author: { email: "outro@x.com", date: "2026-08-02" }, message: "b" } },
      ],
      "/repos/acme-corp/faturamento/commits/meu": { files: [] },
      "/repos/acme-corp/faturamento/commits/alheio": { files: [] },
    });

    const commits = await listCommits({
      token: "t",
      repo: REPO,
      authorEmails: ["eu@x.com"],
      ...JANELA,
    });

    expect(commits.map((c) => c.sha)).toEqual(["meu"]);
  });

  it("não repete o commit que aparece para dois e-mails do mesmo dev", async () => {
    mockGitHub({
      "/repos/acme-corp/faturamento/commits": [
        { sha: "unico", commit: { author: { email: "eu@x.com", date: "2026-08-02" }, message: "a" } },
      ],
      "/repos/acme-corp/faturamento/commits/unico": { files: [] },
    });

    const commits = await listCommits({
      token: "t",
      repo: REPO,
      authorEmails: ["eu@x.com", "eu@empresa.com"],
      ...JANELA,
    });

    expect(commits).toHaveLength(1);
  });

  it("leva a janela e o autor na consulta", async () => {
    const chamadas = mockGitHub({
      "/repos/acme-corp/faturamento/commits": [],
    });

    await listCommits({ token: "t", repo: REPO, authorEmails: ["eu@x.com"], ...JANELA });

    const url = new URL(String(chamadas.mock.calls[0]?.[0]));
    expect(url.searchParams.get("since")).toBe(JANELA.since.toISOString());
    expect(url.searchParams.get("until")).toBe(JANELA.until.toISOString());
    expect(url.searchParams.get("author")).toBe("eu@x.com");
  });

  it("guarda só extensões e contagem dos arquivos", async () => {
    mockGitHub({
      "/repos/acme-corp/faturamento/commits": [
        { sha: "abc", commit: { author: { email: "eu@x.com", date: "2026-08-02" }, message: "m" } },
      ],
      "/repos/acme-corp/faturamento/commits/abc": {
        files: [
          { filename: "src/clients/acme/a.ts" },
          { filename: "db/migrations/0001_cliente.sql" },
        ],
      },
    });

    const [commit] = await listCommits({
      token: "t",
      repo: REPO,
      authorEmails: ["eu@x.com"],
      ...JANELA,
    });

    expect(commit?.fileExtensions).toEqual(["sql", "ts"]);
    expect(commit?.fileCount).toBe(2);
  });

  it("trata repositório vazio como zero commits, não como falha", async () => {
    // 409 é o que o GitHub responde para repositório criado e nunca usado.
    // Tratar isso como erro enchia o log de aviso para uma situação normal —
    // e aviso que sempre aparece é aviso que ninguém lê.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 409 }))),
    );

    await expect(
      listCommits({ token: "t", repo: REPO, authorEmails: ["eu@x.com"], ...JANELA }),
    ).resolves.toEqual([]);
  });

  it("não engole outros erros junto com o do repositório vazio", async () => {
    // 404 significa token errado ou repo sumido, e precisa aparecer.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 404 }))),
    );

    await expect(
      listCommits({ token: "t", repo: REPO, authorEmails: ["eu@x.com"], ...JANELA }),
    ).rejects.toThrow(GitHubCollectError);
  });

  it("carrega o status HTTP no erro, para quem chama decidir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 451 }))),
    );

    await expect(
      listCommits({ token: "t", repo: REPO, authorEmails: ["eu@x.com"], ...JANELA }),
    ).rejects.toMatchObject({ status: 451 });
  });

  it("levanta erro sem citar o repositório", async () => {
    // A mensagem de erro vai para o log do runner, que é o lugar mais fácil de
    // esquecer que vaza.
    mockGitHub({});

    await expect(
      listCommits({ token: "t", repo: REPO, authorEmails: ["eu@x.com"], ...JANELA }),
    ).rejects.toThrow(/^(?!.*acme)(?!.*faturamento).*$/s);
  });
});

describe("listInstallationRepositories", () => {
  it("lê os repositórios da instalação", async () => {
    mockGitHub({
      "/installation/repositories": {
        repositories: [
          { id: 7, name: "faturamento", private: true, owner: { login: "acme-corp" } },
        ],
      },
    });

    expect(await listInstallationRepositories("t")).toEqual([
      { externalId: 7, owner: "acme-corp", name: "faturamento", private: true },
    ]);
  });
});
