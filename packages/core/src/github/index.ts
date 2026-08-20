/**
 * Coleta de commits — Fase 2.
 *
 * Estratégia: enumerar repositórios via `GET /user/repos` (affiliation:
 * owner,collaborator,organization_member), depois buscar commits por repo com
 * `since`/`until`.
 *
 * Duas armadilhas conhecidas:
 *   - SAML SSO: um PAT clássico precisa ser explicitamente autorizado para
 *     cada org que usa SSO, senão os repos simplesmente não aparecem.
 *   - Identidade: commits de trabalho costumam ter e-mail de autor diferente
 *     do pessoal. O filtro é por GITHUB_AUTHOR_EMAILS (lista), não por
 *     username.
 *
 * Do resultado guardamos apenas: sha, alias do repo, mensagem, data,
 * extensões e contagem de arquivos. Nunca caminhos, nunca o diff.
 */

const NOT_IMPLEMENTED = "Fase 2 — ainda não implementado";

export interface CollectOptions {
  authorEmails: readonly string[];
  since: Date;
  until: Date;
}

export function collectCommits(_options: CollectOptions): Promise<never> {
  throw new Error(NOT_IMPLEMENTED);
}
