/**
 * Registro dos repositórios de um dev.
 *
 * Chamado de dois lugares, e isso é a razão de existir aqui em vez de dentro
 * de um deles: a tela de introdução precisa dos repositórios para o dev
 * escolher quais entram, e o pipeline precisa deles para coletar. Se cada um
 * tivesse a própria versão, a tela mostraria uma lista e a coleta usaria
 * outra.
 *
 * O que NÃO é gravado: o nome real. Guardamos o id numérico do GitHub, que
 * permite reencontrar o repositório na API, e um alias nosso. Um dump do banco
 * expõe "repo-3", não a carteira de clientes de quem usa o sistema.
 */

import { and, eq } from "drizzle-orm";
import type { Database } from "./client";
import { repos } from "./schema";

/** Como um repositório chega da API, antes de virar linha. */
export interface DiscoveredRepo {
  externalId: number;
  private: boolean;
  /** Linha de `github_installations`, ou null se veio pela colaboração. */
  installationId?: number | null;
}

export interface RepoRow {
  id: number;
  externalId: number;
  alias: string;
  active: boolean;
}

/**
 * Alias padrão: posição, e nada mais.
 *
 * Deliberadamente sem significado. Qualquer coisa derivada do nome real —
 * iniciais, abreviação, hash reversível — seria o nome real de volta com um
 * disfarce. O dev renomeia para algo que reconheça e que ele mesmo julgue
 * seguro; essa é uma decisão que só ele pode tomar.
 */
export function defaultAlias(position: number): string {
  return `repo-${String(position)}`;
}

/**
 * Grava os repositórios que ainda não existem e devolve TODOS os do dev.
 *
 * Não apaga o que sumiu da lista: um repositório pode ficar temporariamente
 * inacessível — instalação suspensa, token de colaboração revogado, SSO
 * expirado — e apagar a linha perderia junto a escolha do dev de tê-lo
 * desativado. Ela voltaria ativa na próxima execução, coletando o que ele
 * tinha pedido para não coletar.
 */
export async function upsertRepos(
  db: Database,
  userId: number,
  discovered: readonly DiscoveredRepo[],
): Promise<RepoRow[]> {
  const existentes = await listRepos(db, userId);
  const conhecidos = new Set(existentes.map((r) => r.externalId));
  let posicao = existentes.length;

  for (const repo of discovered) {
    if (conhecidos.has(repo.externalId)) continue;

    posicao += 1;
    await db
      .insert(repos)
      .values({
        userId,
        externalId: repo.externalId,
        alias: defaultAlias(posicao),
        private: repo.private,
        installationId: repo.installationId ?? null,
      })
      .onConflictDoNothing();

    conhecidos.add(repo.externalId);
  }

  return listRepos(db, userId);
}

export function listRepos(db: Database, userId: number): Promise<RepoRow[]> {
  return db
    .select({
      id: repos.id,
      externalId: repos.externalId,
      alias: repos.alias,
      active: repos.active,
    })
    .from(repos)
    .where(eq(repos.userId, userId));
}

/** Liga ou desliga um repositório da coleta. */
export async function setRepoActive(
  db: Database,
  userId: number,
  repoId: number,
  active: boolean,
): Promise<void> {
  await db
    .update(repos)
    .set({ active })
    .where(and(eq(repos.userId, userId), eq(repos.id, repoId)));
}

/**
 * Troca o apelido.
 *
 * Vazio volta ao padrão em vez de gravar string em branco — um alias vazio
 * apareceria como nada na mensagem de procedência, e procedência invisível é o
 * mesmo que não ter.
 */
export async function renameRepo(
  db: Database,
  userId: number,
  repoId: number,
  alias: string,
): Promise<void> {
  const limpo = alias.trim().slice(0, 60);
  if (limpo === "") return;

  await db
    .update(repos)
    .set({ alias: limpo })
    .where(and(eq(repos.userId, userId), eq(repos.id, repoId)));
}
