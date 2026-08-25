/**
 * Quem pode entrar no sistema.
 *
 * A lista saiu de `ALLOWED_GITHUB_LOGINS` e veio para o banco, porque liberar
 * um dev novo não pode exigir acesso ao painel da Vercel e um redeploy. A
 * variável de ambiente sobreviveu com outro papel: **semente e escotilha**.
 *
 *   - semente, porque no primeiro login o banco está vazio e alguém precisa
 *     conseguir entrar para virar dono;
 *   - escotilha, porque se o dono perder a conta do GitHub, editar a variável
 *     é o caminho de volta que não depende de estar logado.
 *
 * Os dois caminhos valem sempre, e é de propósito: uma lista que só existe no
 * banco tranca todo mundo para fora no dia em que o banco estiver vazio.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./client";
import { allowedLogins, users } from "./schema";

export type Papel = "owner" | "dev";

/** O GitHub não diferencia caixa em login; o banco também não deve. */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export interface DecisaoAcesso {
  permitido: boolean;
  /** Verdadeiro quando este login será o primeiro usuário — vira dono. */
  seraDono: boolean;
}

/**
 * Decide se um login pode entrar, e com qual papel.
 *
 * A contagem de usuários é o que define o dono: o primeiro a entrar assume, e
 * não existe outra forma de assumir. Uma tela que promovesse alguém a dono
 * seria a única coisa que um convidado precisaria achar para tomar o sistema.
 */
export async function decideAccess(
  db: Database,
  login: string,
  fromEnv: readonly string[],
): Promise<DecisaoAcesso> {
  const alvo = normalizeLogin(login);

  const naSemente = fromEnv.some((l) => normalizeLogin(l) === alvo);

  const convidados = await db
    .select({ id: allowedLogins.id })
    .from(allowedLogins)
    .where(eq(allowedLogins.login, alvo))
    .limit(1);

  const permitido = naSemente || convidados.length > 0;
  if (!permitido) return { permitido: false, seraDono: false };

  const existentes = await db.select({ id: users.id }).from(users).limit(1);

  return { permitido: true, seraDono: existentes.length === 0 };
}

export interface Convidado {
  id: number;
  login: string;
  /** Preenchido quando o convidado já entrou pelo menos uma vez. */
  usuarioId: number | null;
  papel: Papel | null;
  ativo: boolean | null;
  convidadoEm: Date;
}

/**
 * A lista para a tela do dono.
 *
 * Junta com `users` para mostrar quem já entrou e quem ainda não — a diferença
 * entre "convidado" e "entrou" é a única coisa que o dono precisa saber para
 * decidir se cobra a pessoa ou se o convite se perdeu.
 */
export function listAccess(db: Database): Promise<Convidado[]> {
  return db
    .select({
      id: allowedLogins.id,
      login: allowedLogins.login,
      usuarioId: users.id,
      papel: users.role,
      ativo: users.active,
      convidadoEm: allowedLogins.createdAt,
    })
    .from(allowedLogins)
    .leftJoin(users, eq(users.githubLogin, allowedLogins.login))
    .orderBy(desc(allowedLogins.createdAt)) as Promise<Convidado[]>;
}

export async function grantAccess(
  db: Database,
  login: string,
  invitedBy: number,
): Promise<void> {
  await db
    .insert(allowedLogins)
    .values({ login: normalizeLogin(login), invitedBy })
    .onConflictDoNothing();
}

/**
 * Tira o convite E desativa a conta, se ela existir.
 *
 * As duas coisas juntas porque só apagar o convite não fecha porta nenhuma:
 * quem já entrou tem sessão aberta e uma linha em `users`, e continuaria
 * entrando por catorze dias. `active = false` derruba as sessões na requisição
 * seguinte, que é o comportamento que alguém espera ao clicar em "remover".
 */
export async function revokeAccess(db: Database, login: string): Promise<void> {
  const alvo = normalizeLogin(login);

  await db.delete(allowedLogins).where(eq(allowedLogins.login, alvo));

  // O dono nunca é desativado por esta via — ver `podeRevogar`.
  await db
    .update(users)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(users.githubLogin, alvo), eq(users.role, "dev")));
}

/**
 * O dono não pode se remover, nem ser removido.
 *
 * Sem esta regra, um clique deixaria o sistema sem ninguém capaz de convidar —
 * e o caminho de volta seria editar variável de ambiente na Vercel, que é
 * justamente o que a tela existe para evitar.
 */
export function podeRevogar(alvo: { papel: Papel | null }): boolean {
  return alvo.papel !== "owner";
}
