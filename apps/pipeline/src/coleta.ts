/**
 * Coleta de commits de um dev — Fase 2.
 *
 * Junta as três credenciais possíveis e devolve os commits novos da janela,
 * já no formato `RawCommit`: sem caminho de arquivo e sem nome real de
 * repositório.
 *
 * O que sai daqui vai para o filtro e some. A tabela `commits` guarda apenas
 * o que serve para deduplicar e mostrar procedência — sha, alias, data,
 * extensões e contagem. **Não existe coluna de mensagem**, e é por isso que
 * `message` só existe em memória, entre esta função e o filtro.
 */

import { and, eq } from "drizzle-orm";
import {
  createAppJwt,
  createInstallationToken,
  fetchCollaboratorRepos,
  listCommits,
  listInstallationRepositories,
  refreshUserToken,
  GitHubCollectError,
  type RepoTarget,
} from "@commitpost/core/github";
import { decryptSecret, encryptSecret } from "@commitpost/core/crypto";
import {
  commits,
  deniedTerms,
  githubInstallations,
  oauthTokens,
  upsertRepos,
  userEmails,
  type Database,
  type RepoRow,
} from "@commitpost/core/db";
import type { RawCommit } from "@commitpost/core/redact";

/** O mesmo nome usado pelo app web ao gravar a concessão. */
const COLLAB_PROVIDER = "github-collab";

export interface ColetaOptions {
  db: Database;
  userId: number;
  since: Date;
  until: Date;
  appId: string;
  appPrivateKey: string;
  encryptionKey: string;
  /** Somados aos termos do dev. Vêm de REDACT_DENIED_TERMS. */
  extraDeniedTerms: readonly string[];
  /**
   * Credenciais do OAuth de colaborações, para RENOVAR o token quando ele
   * vence. Sem elas o pipeline lê enquanto o token vale e para depois — que
   * foi exatamente o que aconteceu na primeira semana.
   */
  oauthClientId?: string | undefined;
  oauthClientSecret?: string | undefined;
  /**
   * Ensaio: não grava nada e devolve TUDO que encontrou, inclusive o que já
   * está no banco.
   *
   * Existe porque a dedução de "novo" é o índice único em (user_id, sha) — o
   * que é ótimo em produção e péssimo para experimentar: depois da primeira
   * execução não sobra nada para ver, e a única forma de olhar de novo seria
   * apagar linhas do banco de alguém. Aqui a resposta é não gravar.
   */
  ensaio?: boolean;
}

export interface ColetaResult {
  /** Commits que ainda não estavam no banco. É o que segue para o filtro. */
  novos: RawCommit[];
  /** Quantos vieram da API mas já tinham sido coletados antes. */
  repetidos: number;
  reposVarridos: number;
  /** Nomes reais a remover, para passar em `FilterOptions.deniedTerms`. */
  termosProibidos: string[];
  /** Repositório inacessível não derruba a execução; vira aviso. */
  avisos: string[];
}

/**
 * Um repositório alcançável, com o token que o alcança.
 *
 * Cada instalação tem o próprio token, e o de colaboração é outro ainda. O par
 * anda junto porque usar o token errado devolve 404 — que é indistinguível de
 * "repositório não existe".
 */
interface Alvo {
  target: RepoTarget;
  token: string;
  /** Linha de `repos`. Já conhecida aqui, para a gravação não reconsultar. */
  repoId: number;
}

export async function coletarDoDev(options: ColetaOptions): Promise<ColetaResult> {
  const { db, userId, since, until } = options;
  const avisos: string[] = [];

  const emails = (
    await db.select({ email: userEmails.email }).from(userEmails).where(eq(userEmails.userId, userId))
  ).map((e) => e.email);

  if (emails.length === 0) {
    return {
      novos: [],
      repetidos: 0,
      reposVarridos: 0,
      termosProibidos: [],
      avisos: ["sem e-mail de autor cadastrado — nada a coletar"],
    };
  }

  const alvos = await descobrirAlvos(options, avisos);

  // Os nomes REAIS dos repositórios entram na denylist agora, em memória, e
  // não são gravados por causa disso: é o nome real que aparece numa mensagem
  // de commit ("merge branch x into faturamento-clientey"), não o nosso alias.
  const termosProibidos = [
    ...options.extraDeniedTerms,
    ...alvos.flatMap((a) => [a.target.name, a.target.owner]),
    ...(
      await db.select({ term: deniedTerms.term }).from(deniedTerms).where(eq(deniedTerms.userId, userId))
    ).map((t) => t.term),
  ].filter((t) => t !== "");

  const colhidos: RawCommit[] = [];

  for (const { target, token } of alvos) {
    try {
      colhidos.push(...(await listCommits({ token, repo: target, authorEmails: emails, since, until })));
    } catch (error) {
      // Um repositório inacessível — arquivado, SSO expirado, permissão
      // revogada — não pode derrubar a coleta dos outros. O aviso leva o alias
      // e o status; o nome real, não.
      const status = error instanceof GitHubCollectError ? ` (HTTP ${String(error.status)})` : "";
      avisos.push(`não foi possível ler ${target.alias}${status}`);
    }
  }

  const { novos, repetidos } =
    options.ensaio === true
      ? { novos: [...colhidos], repetidos: 0 }
      : await gravarNovos(db, userId, alvos, colhidos);

  return {
    novos,
    repetidos,
    reposVarridos: alvos.length,
    termosProibidos: [...new Set(termosProibidos)],
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Descoberta
// ---------------------------------------------------------------------------

/**
 * Todos os repositórios que este dev alcança, por instalação e por colaboração.
 *
 * Os repositórios são registrados antes de qualquer commit ser lido, porque é
 * o registro que carrega a escolha do dev: um repositório com `active = false`
 * some daqui e nem chega a ser consultado.
 */
async function descobrirAlvos(options: ColetaOptions, avisos: string[]): Promise<Alvo[]> {
  const { db, userId } = options;
  const bruto: { repo: Omit<RepoTarget, "alias">; token: string; installationId: number | null }[] = [];

  const instalacoes = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, userId));

  const jwt = createAppJwt(options.appId, options.appPrivateKey);

  for (const instalacao of instalacoes) {
    if (instalacao.suspendedAt !== null) {
      avisos.push(`instalação em ${instalacao.accountLogin} está suspensa`);
      continue;
    }

    try {
      const { token } = await createInstallationToken(instalacao.installationId, jwt);
      for (const repo of await listInstallationRepositories(token)) {
        bruto.push({ repo, token, installationId: instalacao.id });
      }
    } catch {
      avisos.push(`instalação em ${instalacao.accountLogin} não respondeu`);
    }
  }

  const colaboracao = await tokenDeColaboracao(options, avisos);
  if (colaboracao !== null) {
    try {
      for (const repo of await fetchCollaboratorRepos(colaboracao)) {
        // Um repo pode aparecer nos dois caminhos. O da instalação ganha: o
        // token dele é de leitura e expira em uma hora.
        if (bruto.some((b) => b.repo.externalId === repo.id)) continue;

        bruto.push({
          repo: { externalId: repo.id, owner: repo.owner, name: repo.name, private: repo.private },
          token: colaboracao,
          installationId: null,
        });
      }
    } catch {
      avisos.push("o acesso de colaboração não respondeu — pode ter sido revogado");
    }
  }

  const registrados = await upsertRepos(
    db,
    userId,
    bruto.map((b) => ({
      externalId: b.repo.externalId,
      private: b.repo.private,
      installationId: b.installationId,
    })),
  );

  const porExternalId = new Map<number, RepoRow>(registrados.map((r) => [r.externalId, r]));

  const alvos: Alvo[] = [];
  for (const b of bruto) {
    const linha = porExternalId.get(b.repo.externalId);
    if (linha === undefined || !linha.active) continue;
    alvos.push({ target: { ...b.repo, alias: linha.alias }, token: b.token, repoId: linha.id });
  }

  const desligados = registrados.filter((r) => !r.active).length;
  if (desligados > 0) avisos.push(`${String(desligados)} repositório(s) fora da coleta por escolha sua`);

  return alvos;
}

/**
 * Folga antes do vencimento.
 *
 * Um token que vence no meio da execução é pior do que um já vencido: metade
 * dos repositórios entra e a outra metade some, e o log não deixa isso óbvio.
 */
const FOLGA_MS = 10 * 60 * 1000;

/**
 * O token de colaboração, renovado se precisar.
 *
 * O GitHub devolve token de oito horas aqui — não "sem prazo", que era o que
 * eu esperava de um OAuth clássico. Sem renovação, a coleta deixaria de
 * enxergar os repositórios de colaboração de um dia para o outro, e o único
 * sintoma seria o número de repos varridos caindo no log.
 *
 * A renovação acontece ANTES de qualquer leitura, e o par novo é gravado na
 * mesma hora: o refresh token do GitHub é de uso único, e não gravar o novo
 * transformaria a renovação num desligamento adiado.
 */
async function tokenDeColaboracao(
  options: ColetaOptions,
  avisos: string[],
): Promise<string | null> {
  const linhas = await options.db
    .select({
      cifrado: oauthTokens.accessTokenEncrypted,
      refreshCifrado: oauthTokens.refreshTokenEncrypted,
      expiraEm: oauthTokens.expiresAt,
    })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, options.userId), eq(oauthTokens.provider, COLLAB_PROVIDER)))
    .limit(1);

  const linha = linhas[0];
  if (linha === undefined) return null;

  let token: string;
  try {
    token = decryptSecret(linha.cifrado, options.encryptionKey);
  } catch {
    // Chave trocada. Não dá para distinguir disso de dado adulterado, e a ação
    // é a mesma: o dev reautoriza.
    avisos.push("o acesso de colaboração não pôde ser decifrado — reautorize em Conexões");
    return null;
  }

  const vencido =
    linha.expiraEm !== null && linha.expiraEm.getTime() - FOLGA_MS <= Date.now();

  if (!vencido) return token;

  if (linha.refreshCifrado === null || options.oauthClientId === undefined) {
    avisos.push("o acesso de colaboração venceu e não há como renovar — reautorize em Conexões");
    return null;
  }

  try {
    const renovado = await refreshUserToken({
      clientId: options.oauthClientId,
      clientSecret: options.oauthClientSecret ?? "",
      refreshToken: decryptSecret(linha.refreshCifrado, options.encryptionKey),
    });

    await options.db
      .update(oauthTokens)
      .set({
        accessTokenEncrypted: encryptSecret(renovado.accessToken, options.encryptionKey),
        refreshTokenEncrypted:
          renovado.refreshToken === null
            ? null
            : encryptSecret(renovado.refreshToken, options.encryptionKey),
        expiresAt: renovado.expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(eq(oauthTokens.userId, options.userId), eq(oauthTokens.provider, COLLAB_PROVIDER)),
      );

    return renovado.accessToken;
  } catch (error) {
    avisos.push(
      `não foi possível renovar o acesso de colaboração (${error instanceof Error ? error.message : "motivo desconhecido"})`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/**
 * Grava o que ainda não existe e devolve só os novos.
 *
 * A dedução de "novo" é o índice único em (user_id, sha): `onConflictDoNothing`
 * com `returning` devolve exatamente as linhas que entraram. É isso que torna
 * re-executar o workflow inofensivo — dois disparos na mesma janela não geram
 * lote duplicado.
 *
 * Repare no `values`: não há `message`. A mensagem morre nesta fronteira.
 */
async function gravarNovos(
  db: Database,
  userId: number,
  alvos: readonly Alvo[],
  colhidos: readonly RawCommit[],
): Promise<{ novos: RawCommit[]; repetidos: number }> {
  if (colhidos.length === 0) return { novos: [], repetidos: 0 };

  const repoIdPorAlias = new Map(alvos.map((a) => [a.target.alias, a.repoId]));
  const novos: RawCommit[] = [];

  for (const commit of colhidos) {
    const repoId = repoIdPorAlias.get(commit.repoAlias);
    if (repoId === undefined) continue;

    const inseridos = await db
      .insert(commits)
      .values({
        userId,
        repoId,
        sha: commit.sha,
        authoredAt: commit.authoredAt,
        fileExtensions: [...commit.fileExtensions],
        fileCount: commit.fileCount,
      })
      .onConflictDoNothing()
      .returning({ id: commits.id });

    if (inseridos.length > 0) novos.push(commit);
  }

  return { novos, repetidos: colhidos.length - novos.length };
}
