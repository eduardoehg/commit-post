import { describe, expect, it } from "vitest";
import {
  extractTechnicalFacts,
  MAX_TECHNOLOGIES,
  scrubGeneratedText,
  type RawCommit,
  type TechnicalFact,
} from "./index.js";

/**
 * Contrato do filtro de confidencialidade.
 *
 * O teste que mais importa aqui não é nenhum dos casos individuais, é
 * `nada que não esteja no vocabulário atravessa` mais abaixo: ele pega uma
 * mensagem carregada de dado sensível e verifica que NENHUM pedaço dela
 * aparece na saída serializada. É a propriedade que o desenho inteiro existe
 * para garantir.
 */

function commit(message: string, overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    sha: "abc1234",
    repoAlias: "repo-alfa",
    message,
    authoredAt: new Date("2026-08-01T12:00:00Z"),
    fileExtensions: [],
    fileCount: 1,
    ...overrides,
  };
}

/** Tudo que a saída contém, como uma string — para busca de vazamento. */
function serialize(facts: readonly TechnicalFact[]): string {
  return JSON.stringify(facts);
}

function first(facts: readonly TechnicalFact[]): TechnicalFact {
  const fact = facts[0];
  if (fact === undefined) throw new Error("esperava ao menos um fato técnico");
  return fact;
}

// ---------------------------------------------------------------------------

describe("extractTechnicalFacts — classificação", () => {
  it.each([
    ["feat: adiciona cache de sessão", "feature"],
    ["fix: corrige timeout no Postgres", "bugfix"],
    ["refactor: simplifica a validação", "refactor"],
    ["perf: otimiza consulta lenta", "performance"],
    ["test: cobre o caso de retry", "test"],
    ["docs: atualiza readme da API", "docs"],
    ["ci: ajusta o deploy do Docker", "infra"],
    ["build: atualiza Vite", "infra"],
    ["chore: sobe versão do TypeScript", "chore"],
  ])("lê o tipo do prefixo convencional em %j", (message, expected) => {
    expect(first(extractTechnicalFacts([commit(message)])).changeKind).toBe(expected);
  });

  it.each([
    ["Corrige erro no cálculo com cache", "bugfix"],
    ["Otimiza a consulta que estava lenta no Postgres", "performance"],
    ["Adiciona suporte a webhook", "feature"],
    ["Documenta a API de autenticação", "docs"],
  ])("cai nas palavras-chave quando não há prefixo: %j", (message, expected) => {
    expect(first(extractTechnicalFacts([commit(message)])).changeKind).toBe(expected);
  });

  it("classifica como chore quando nada indica outra coisa", () => {
    const facts = extractTechnicalFacts([commit("mexe no cache")]);
    expect(first(facts).changeKind).toBe("chore");
  });
});

describe("extractTechnicalFacts — o que sobrevive", () => {
  it("mantém termos do vocabulário público", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige invalidação de cache no Redis com Postgres"),
    ]);
    expect(first(facts).technologies).toEqual(expect.arrayContaining(["Redis", "Postgres", "cache"]));
  });

  it("reconhece o termo mesmo escrito com acento e caixa diferente", () => {
    const facts = extractTechnicalFacts([commit("feat: melhora a AUTENTICAÇÃO")]);
    expect(first(facts).technologies).toContain("autenticação");
  });

  it("preserva Node.js, que o detector de domínio comeria", () => {
    const facts = extractTechnicalFacts([commit("chore: atualiza o Node.js")]);
    expect(first(facts).technologies).toContain("Node");
  });

  it("deriva tecnologia das extensões de arquivo", () => {
    const facts = extractTechnicalFacts([
      commit("Corrige o cálculo do total", { fileExtensions: ["ts", "sql"] }),
    ]);
    expect(first(facts).technologies).toEqual(expect.arrayContaining(["TypeScript", "SQL"]));
  });

  it("identifica a classe do problema a partir de vocabulário fechado", () => {
    const facts = extractTechnicalFacts([
      commit("fix: resolve race condition na fila de envio"),
    ]);
    expect(first(facts).problemClass).toBe("condição de corrida");
  });

  it("identifica o resultado a partir de vocabulário fechado", () => {
    const facts = extractTechnicalFacts([
      commit("perf: deixa a listagem do Postgres mais rapido"),
    ]);
    expect(first(facts).outcome).toBe("melhora de desempenho");
  });

  it("preserva sourceShas para exibir procedência na aprovação", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige cache", { sha: "aaa1111" }),
      commit("fix: ajusta cache de novo", { sha: "bbb2222" }),
    ]);
    expect(first(facts).sourceShas).toEqual(["aaa1111", "bbb2222"]);
  });

  it("limita a quantidade de tecnologias por fato", () => {
    const facts = extractTechnicalFacts([
      commit(
        "feat: mexe em React, Vue, Angular, Svelte, Astro, Postgres, Redis, Docker, Kubernetes e Terraform",
      ),
    ]);
    expect(first(facts).technologies.length).toBeLessThanOrEqual(MAX_TECHNOLOGIES);
  });
});

describe("extractTechnicalFacts — o que NÃO sobrevive", () => {
  it("descarta o escopo do conventional commit antes de qualquer análise", () => {
    // O escopo põe o nome do módulo interno na primeira linha de todo commit
    // (`feat(faturamento-clientex):`), e é um dos vazamentos mais prováveis.
    //
    // Asserir sobre a saída aqui não testaria nada: o vocabulário fechado já
    // impediria "clientex" de sair mesmo que o escopo fosse mantido. O que
    // distingue de verdade é um escopo que CONTÉM um termo do vocabulário —
    // se ele fosse considerado, viraria tecnologia e o fato seria publicável.
    const facts = extractTechnicalFacts([commit("feat(redis): adiciona um contador")]);

    expect(serialize(facts)).not.toContain("Redis");
    expect(facts).toEqual([]);
  });

  it("o escopo também não influencia a classificação do tipo", () => {
    const facts = extractTechnicalFacts([commit("chore(corrige-bug): sobe versão do Postgres")]);
    expect(first(facts).changeKind).toBe("chore");
  });

  it("descarta nomes próprios desconhecidos", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige o cache no Zarvox e no Blimbo"),
    ]);
    expect(serialize(facts)).not.toContain("Zarvox");
    expect(serialize(facts)).not.toContain("Blimbo");
  });

  it("descarta domínios, IPs e URLs", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige timeout em api.interno.acme.com.br (10.0.14.3) via https://wiki.acme.com/x"),
    ]);
    const output = serialize(facts);
    expect(output).not.toContain("acme");
    expect(output).not.toContain("10.0.14.3");
    expect(output).not.toContain("wiki");
  });

  it("não colhe tecnologia de dentro de um host interno", () => {
    // Sem a higienização, "redis" seria colhido daqui e o commit contaria
    // como relevante por causa de um nome de máquina.
    const facts = extractTechnicalFacts([commit("chore: aponta para redis.cliente-x.internal")]);
    expect(serialize(facts)).not.toContain("cliente-x");
  });

  it("descarta nomes de variáveis de ambiente e credenciais", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige leitura de ACME_BILLING_API_KEY e do token ghp_AbCdEf0123456789xyz"),
    ]);
    const output = serialize(facts);
    expect(output).not.toContain("ACME_BILLING_API_KEY");
    expect(output).not.toContain("ghp_");
  });

  it("descarta trecho entre aspas na mensagem do commit", () => {
    // Texto citado em commit costuma ser mensagem de UI ou nome literal de
    // produto. Se as aspas fossem mantidas, "Postgres" seria colhido daqui.
    const facts = extractTechnicalFacts([
      commit(`fix: corrige a mensagem "erro no Postgres do Meridiano"`),
    ]);
    expect(serialize(facts)).not.toContain("Postgres");
    expect(serialize(facts)).not.toContain("Meridiano");
  });

  it("descarta identificadores de chamado interno", () => {
    const facts = extractTechnicalFacts([commit("fix: resolve ACME-4821 no cache")]);
    expect(serialize(facts)).not.toContain("ACME-4821");
  });

  it("descarta trailers com nome e e-mail de pessoas", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige cache\n\nCo-authored-by: Fulano Silva <fulano@empresa.com.br>"),
    ]);
    const output = serialize(facts);
    expect(output).not.toContain("Fulano");
    expect(output).not.toContain("empresa.com.br");
  });

  it("descarta linhas de trailer inteiras, não só o e-mail", () => {
    // Um trailer pode trazer descrição junto do nome. Se a linha não fosse
    // removida por inteiro, "Postgres" seria colhido de dentro dela e o post
    // passaria a falar de algo que este commit não fez.
    const facts = extractTechnicalFacts([
      commit("fix: corrige o calculo do total\n\nRefs: migracao do Postgres feita por Fulano"),
    ]);
    expect(serialize(facts)).not.toContain("Postgres");
    expect(serialize(facts)).not.toContain("Fulano");
  });

  it("nunca trata o alias do repositório como sinal técnico", () => {
    const facts = extractTechnicalFacts([
      commit("chore: ajusta o redis do projeto", { repoAlias: "redis" }),
    ]);
    expect(serialize(facts)).not.toContain("Redis");
  });

  it("nunca inclui o alias do repositório", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige cache no repo-alfa", { repoAlias: "repo-alfa" }),
    ]);
    expect(serialize(facts)).not.toContain("repo-alfa");
  });

  it("remove os termos da denylist configurada", () => {
    const facts = extractTechnicalFacts(
      [commit("feat: integra o cache com o Portal Meridiano")],
      { deniedTerms: ["Portal Meridiano", "Meridiano"] },
    );
    expect(serialize(facts)).not.toContain("Meridiano");
  });

  it("devolve lista vazia quando nada sobrevive ao filtro", () => {
    expect(extractTechnicalFacts([commit("wip")])).toEqual([]);
    expect(extractTechnicalFacts([commit("ajustes finais para o Zarvox")])).toEqual([]);
    expect(extractTechnicalFacts([])).toEqual([]);
  });

  it("nada que não esteja no vocabulário atravessa", () => {
    const segredos = [
      "Meridiano",
      "faturamento-clientex",
      "ACME-4821",
      "ACME_BILLING_API_KEY",
      "api.interno.acme.com.br",
      "10.0.14.3",
      "fulano@empresa.com.br",
      "ghp_AbCdEf0123456789xyzQ",
      "src/clientes/meridiano/cobranca.ts",
      "Zarvox",
    ];

    const facts = extractTechnicalFacts([
      commit(
        `feat(faturamento-clientex): integra cache do Redis com o Portal Meridiano\n\n` +
          `Resolve ACME-4821. Lê ACME_BILLING_API_KEY apontando para\n` +
          `api.interno.acme.com.br (10.0.14.3). Token ghp_AbCdEf0123456789xyzQ.\n` +
          `Arquivo principal: src/clientes/meridiano/cobranca.ts\n` +
          `Revisado por Zarvox.\n\n` +
          `Co-authored-by: Fulano <fulano@empresa.com.br>`,
        { fileExtensions: ["ts"] },
      ),
    ]);

    const output = serialize(facts);
    for (const segredo of segredos) {
      expect(output, `vazou: ${segredo}`).not.toContain(segredo);
    }

    // E ainda assim sobrou sinal técnico útil.
    expect(first(facts).technologies).toEqual(expect.arrayContaining(["Redis", "cache"]));
  });
});

describe("extractTechnicalFacts — agrupamento", () => {
  it("junta commits do mesmo tipo que falam da mesma tecnologia", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige cache do Redis", { sha: "aaa" }),
      commit("fix: ajusta expiração no Redis", { sha: "bbb" }),
    ]);
    expect(facts).toHaveLength(1);
    expect(first(facts).sourceShas).toEqual(["aaa", "bbb"]);
  });

  it("mantém separados commits de tipos diferentes", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige cache do Redis"),
      commit("feat: adiciona cache no Redis"),
    ]);
    expect(facts).toHaveLength(2);
  });

  it("agrupa transitivamente quando um commit posterior faz a ponte", () => {
    const facts = extractTechnicalFacts([
      commit("fix: corrige o Redis", { sha: "aaa" }),
      commit("fix: corrige o Postgres", { sha: "bbb" }),
      commit("fix: corrige Redis e Postgres juntos", { sha: "ccc" }),
    ]);
    expect(facts).toHaveLength(1);
    expect(first(facts).sourceShas).toHaveLength(3);
  });

  it("é determinístico: a mesma entrada dá exatamente a mesma saída", () => {
    const entrada = [
      commit("fix: corrige cache do Redis", { sha: "aaa" }),
      commit("perf: otimiza consulta no Postgres", { sha: "bbb" }),
      commit("feat: adiciona webhook", { sha: "ccc" }),
    ];
    expect(serialize(extractTechnicalFacts(entrada))).toBe(serialize(extractTechnicalFacts(entrada)));
  });
});

// ---------------------------------------------------------------------------

describe("scrubGeneratedText — barreira 2", () => {
  it("remove nome de empresa ou cliente que o modelo tenha reintroduzido", () => {
    const result = scrubGeneratedText(
      "Essa semana resolvi um problema de cache no Portal Meridiano.",
      { deniedTerms: ["Portal Meridiano"] },
    );
    expect(result.text).not.toContain("Meridiano");
    expect(result.removed).toContain("Portal Meridiano");
  });

  it("remove caminho de arquivo que apareça no texto gerado", () => {
    const result = scrubGeneratedText("O ajuste foi em src/clientes/cobranca.ts e resolveu.");
    expect(result.text).not.toContain("src/clientes/cobranca.ts");
    expect(result.removed).toContain("src/clientes/cobranca.ts");
  });

  it("remove domínio, e-mail e credencial", () => {
    const result = scrubGeneratedText(
      "Detalhes em wiki.acme.com.br, fale com fulano@acme.com.br, chave ghp_AbCdEf0123456789xyzQ.",
    );
    expect(result.text).not.toContain("acme");
    expect(result.text).not.toContain("ghp_");
    expect(result.removed.length).toBeGreaterThanOrEqual(3);
  });

  it("sinaliza nome de variável de ambiente no texto gerado", () => {
    const result = scrubGeneratedText("Bastou ajustar a DATABASE_URL do serviço.");
    expect(result.text).not.toContain("DATABASE_URL");
    expect(result.removed).toContain("DATABASE_URL");
  });

  it("deixa o texto intacto quando não há nada suspeito", () => {
    const limpo =
      "Essa semana resolvi um problema de cache que fazia a listagem demorar. " +
      "A solução foi guardar o resultado por alguns minutos em vez de recalcular sempre.";
    const result = scrubGeneratedText(limpo);
    expect(result.text).toBe(limpo);
    expect(result.removed).toEqual([]);
  });

  it("não destrói nomes de tecnologia legítimos com ponto ou barra", () => {
    // Sem proteção, "Node.js" casaria como domínio e "CI/CD" como caminho —
    // e um post perfeitamente publicável seria descartado.
    const texto = "Migrei o serviço para Node.js e ajustei o CI/CD.";
    const result = scrubGeneratedText(texto);
    expect(result.text).toBe(texto);
    expect(result.removed).toEqual([]);
  });

  it("não destrói aspas legítimas no texto gerado", () => {
    // O detector de trecho citado é agressivo de propósito na ENTRADA, onde o
    // texto só serve de insumo. Rodá-lo aqui destruiria prosa publicável e
    // faria um post bom ser descartado por engano.
    const texto = `O time chamava isso de "bug fantasma" porque ninguém achava a causa.`;
    const result = scrubGeneratedText(texto);
    expect(result.text).toBe(texto);
    expect(result.removed).toEqual([]);
  });

  it("é idempotente: passar duas vezes dá o mesmo resultado", () => {
    const texto = "Ajuste em src/interno/cobranca.ts para o cliente Meridiano.";
    const uma = scrubGeneratedText(texto, { deniedTerms: ["Meridiano"] });
    const duas = scrubGeneratedText(uma.text, { deniedTerms: ["Meridiano"] });
    expect(duas.text).toBe(uma.text);
    expect(duas.removed).toEqual([]);
  });

  it("reporta em removed tudo que foi retirado", () => {
    const result = scrubGeneratedText("Contato: fulano@acme.com.br e ticket ACME-99.");
    expect(result.removed).toContain("fulano@acme.com.br");
    expect(result.removed).toContain("ACME-99");
  });
});
