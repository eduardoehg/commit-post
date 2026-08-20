/**
 * Coleta de commits — Fase 2.
 *
 * Estratégia: para cada instalação do GitHub App do dev, gerar um token de
 * instalação (vale uma hora) e enumerar os repositórios que ela expõe; para
 * quem concedeu o OAuth clássico, somar os repos de colaboração. Depois buscar
 * commits por repo com `since`/`until`, filtrando por e-mail de autor.
 *
 * Duas armadilhas conhecidas:
 *   - Identidade: commits de trabalho costumam ter e-mail de autor diferente
 *     do pessoal, e commits feitos pela interface web saem com o endereço
 *     `noreply`. O filtro é pela lista de `user_emails`, não por username.
 *   - Restrição de aplicativos de terceiros numa organização bloqueia App e
 *     OAuth do mesmo jeito; os repos simplesmente não aparecem.
 *
 * Do resultado guardamos apenas: sha, alias do repo, data, extensões e
 * contagem de arquivos. Nunca a mensagem, nunca caminhos, nunca o diff.
 */

export * from "./app";
export * from "./collect";

const NOT_IMPLEMENTED = "Fase 2 — ainda não implementado";

export interface CollectOptions {
  authorEmails: readonly string[];
  since: Date;
  until: Date;
}

export function collectCommits(_options: CollectOptions): Promise<never> {
  throw new Error(NOT_IMPLEMENTED);
}
