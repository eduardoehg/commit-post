/**
 * Nomes usados na coluna `provider` de `oauth_tokens`.
 *
 * Em módulo separado porque um arquivo `route.ts` do Next só pode exportar os
 * símbolos que o framework reconhece — uma constante a mais quebra o build.
 */

/**
 * O OAuth App clássico, distinto do GitHub App. O sufixo diz para que serve:
 * alcançar repositórios de colaboração, e nada além disso.
 */
export const GITHUB_COLLAB_PROVIDER = "github-collab";

export const LINKEDIN_PROVIDER = "linkedin";
