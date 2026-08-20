/**
 * Coleta de commits — Fase 2.
 *
 * O que sai daqui já está no formato que o filtro aceita: `RawCommit`, sem
 * caminho de arquivo e sem nome real de repositório. Os dois são as maiores
 * fontes de vazamento — `src/clients/acme/faturamento.ts` entrega o cliente
 * inteiro numa string — e por isso a redução acontece AQUI, na borda, e não
 * mais adiante. O que a camada de cima nunca recebe, ela nunca vaza.
 *
 * A mensagem do commit atravessa esta camada porque o filtro precisa dela para
 * decidir rótulos, mas ela morre na mesma execução e nunca chega ao banco.
 */

import type { RawCommit } from "../redact/index";

const API = "https://api.github.com";
const ACCEPT = "application/vnd.github+json";
const API_VERSION = "2022-11-28";

/** Teto de páginas por consulta. Uma semana de commits não chega perto. */
const MAX_PAGES = 10;

export class GitHubCollectError extends Error {
  /** Status HTTP, para quem chama decidir se é falha ou situação normal. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubCollectError";
    this.status = status;
  }
}

/**
 * Identidade de um repositório DENTRO desta camada.
 *
 * `owner` e `name` existem porque a API do GitHub exige os dois na URL. Eles
 * não saem daqui: o que sobe é `alias`, e é ele que a camada de cima persiste
 * e mostra.
 */
export interface RepoTarget {
  externalId: number;
  owner: string;
  name: string;
  alias: string;
  private: boolean;
}

export interface CollectOptions {
  /** Token de instalação (1h) ou OAuth de colaboração, já decifrado. */
  token: string;
  repo: RepoTarget;
  authorEmails: readonly string[];
  since: Date;
  until: Date;
}

async function githubJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT,
      "X-GitHub-Api-Version": API_VERSION,
    },
  });

  if (!response.ok) {
    // O caminho é montado com owner/name reais. Fica de fora da mensagem: um
    // log de erro é o lugar mais fácil de esquecer que vaza.
    throw new GitHubCollectError(
      `GitHub respondeu ${String(response.status)} ao coletar commits.`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Extensões — a redução que impede caminho de vazar
// ---------------------------------------------------------------------------

/**
 * Extensões dos arquivos tocados, sem caminho e sem nome de arquivo.
 *
 * Esta função é a fronteira. Do outro lado dela existem strings como
 * `src/clients/acme-corp/faturamento.ts`; deste lado só existe `ts`. Ela é
 * pequena de propósito: quanto menos ela decide, menos chance de deixar passar
 * um pedaço de caminho por engano.
 *
 * Regras, todas por segurança e não por conveniência:
 *   - só o que vem depois do ÚLTIMO ponto do nome do arquivo;
 *   - arquivo sem extensão (`Dockerfile`, `LICENSE`) não vira termo nenhum, e
 *     o nome dele NÃO é usado como substituto — nome de arquivo é caminho;
 *   - só letras e números, até 10 caracteres. Qualquer outra coisa é descartada
 *     em silêncio em vez de virar rótulo;
 *   - ponto inicial não conta (`.gitignore` não tem extensão "gitignore").
 *
 * NOTA PARA QUEM FOR "LIMPAR" ISTO: a separação do caminho e o teste
 * `[a-z0-9]+` cobrem o mesmo caso, e um teste de mutação mostra que remover a
 * separação sozinha não quebra nada — o teste de formato barra qualquer coisa
 * com barra dentro. A redundância é deliberada e é a única do arquivo: aqui um
 * furo não devolve resultado errado, devolve o caminho de um cliente. Se um dia
 * o formato precisar aceitar mais caracteres, é a separação que segura.
 */
export function fileExtensionsOf(filenames: readonly string[]): string[] {
  const found = new Set<string>();

  for (const filename of filenames) {
    // Os dois separadores: o GitHub devolve `/`, mas um `\` num nome de
    // arquivo não pode fazer o resto do caminho passar por extensão.
    const base = filename.split(/[/\\]/).pop() ?? "";

    const dot = base.lastIndexOf(".");
    if (dot <= 0) continue; // sem ponto, ou ponto inicial (arquivo oculto)

    const extension = base.slice(dot + 1).toLowerCase();
    if (extension === "" || extension.length > 10) continue;
    if (!/^[a-z0-9]+$/.test(extension)) continue;

    found.add(extension);
  }

  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Repositórios
// ---------------------------------------------------------------------------

interface RawRepo {
  id: number;
  name: string;
  private: boolean;
  owner: { login: string } | null;
}

/**
 * Repositórios que uma instalação alcança, com o token dela.
 *
 * Diferente de `fetchInstallationRepos`, que pergunta com o token do USUÁRIO
 * durante o onboarding. Aqui, no runner, não existe usuário logado — só a
 * chave privada do app e o token de instalação que ela gera.
 */
export async function listInstallationRepositories(
  installationToken: string,
): Promise<Omit<RepoTarget, "alias">[]> {
  const found: Omit<RepoTarget, "alias">[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await githubJson<{ repositories: RawRepo[] }>(
      `/installation/repositories?per_page=100&page=${String(page)}`,
      installationToken,
    );

    for (const r of body.repositories) {
      found.push({
        externalId: r.id,
        owner: r.owner?.login ?? "",
        name: r.name,
        private: r.private,
      });
    }

    if (body.repositories.length < 100) break;
  }

  return found;
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

interface RawCommitListItem {
  sha: string;
  commit: {
    author: { email?: string; date?: string } | null;
    message: string;
  };
}

/** Compara e-mail de autor sem diferenciar caixa — o git não normaliza. */
function matchesAuthor(email: string | undefined, authorEmails: readonly string[]): boolean {
  if (email === undefined) return false;
  const alvo = email.toLowerCase();
  return authorEmails.some((e) => e.toLowerCase() === alvo);
}

/**
 * Commits de um repositório na janela, já filtrados por autor.
 *
 * O filtro por e-mail acontece duas vezes: o parâmetro `author` da API reduz o
 * tráfego, e a conferência local garante o resultado. A API aceita login OU
 * e-mail no mesmo parâmetro, e um login que por acaso coincida com o começo de
 * um e-mail alheio traria commits de outra pessoa — que virariam post no nome
 * de quem não os escreveu.
 */
export async function listCommits(options: CollectOptions): Promise<RawCommit[]> {
  const { token, repo, authorEmails, since, until } = options;
  const encontrados = new Map<string, RawCommit>();

  for (const authorEmail of authorEmails) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        since: since.toISOString(),
        until: until.toISOString(),
        author: authorEmail,
        per_page: "100",
        page: String(page),
      });

      let lote: RawCommitListItem[];
      try {
        lote = await githubJson<RawCommitListItem[]>(
          `/repos/${repo.owner}/${repo.name}/commits?${query.toString()}`,
          token,
        );
      } catch (error) {
        // 409 é o que o GitHub responde para repositório VAZIO. Não é falha:
        // é um repositório criado e nunca usado, e tratá-lo como erro enchia o
        // log de aviso para uma situação perfeitamente normal.
        if (error instanceof GitHubCollectError && error.status === 409) return [];
        throw error;
      }

      for (const item of lote) {
        if (encontrados.has(item.sha)) continue;
        if (!matchesAuthor(item.commit.author?.email, authorEmails)) continue;

        const { extensions, fileCount } = await fetchCommitFiles(token, repo, item.sha);

        encontrados.set(item.sha, {
          sha: item.sha,
          repoAlias: repo.alias,
          message: item.commit.message,
          authoredAt: new Date(item.commit.author?.date ?? Date.now()),
          fileExtensions: extensions,
          fileCount,
        });
      }

      if (lote.length < 100) break;
    }
  }

  return [...encontrados.values()];
}

/**
 * Extensões e contagem de arquivos de um commit.
 *
 * A resposta do GitHub traz `filename` com o caminho completo e o `patch` com
 * o diff inteiro. Nada disso sai desta função — só o que `fileExtensionsOf`
 * deixa passar e o número de arquivos.
 */
export async function fetchCommitFiles(
  token: string,
  repo: Pick<RepoTarget, "owner" | "name">,
  sha: string,
): Promise<{ extensions: string[]; fileCount: number }> {
  const detalhe = await githubJson<{ files?: { filename: string }[] }>(
    `/repos/${repo.owner}/${repo.name}/commits/${sha}`,
    token,
  );

  const filenames = (detalhe.files ?? []).map((f) => f.filename);

  return {
    extensions: fileExtensionsOf(filenames),
    fileCount: filenames.length,
  };
}
