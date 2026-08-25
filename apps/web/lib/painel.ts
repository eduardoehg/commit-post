/**
 * O contexto que a casca do painel precisa em toda tela.
 *
 * Contagens, não linhas: a barra lateral só precisa saber SE falta alguma
 * conexão, e cada página busca por conta própria o que vai desenhar. Carregar
 * tudo aqui faria a tela de histórico pagar por consultas de repositório que
 * ela nunca usa.
 */

import { count, eq } from "drizzle-orm";
import type { SessionUser } from "@commitpost/core/auth";
import { deniedTerms, githubInstallations, oauthTokens, userEmails } from "@commitpost/core/db";
import { computeOnboarding, type OnboardingSummary } from "@commitpost/core/onboarding";
import { GITHUB_COLLAB_PROVIDER, LINKEDIN_PROVIDER } from "./providers";
import { db, env, requireUser } from "./runtime";

/**
 * Vira `true` quando a publicação automática existir. A conexão com o LinkedIn
 * já funciona; postar ainda não.
 */
export const CONEXAO_LINKEDIN_PRONTA = true;

export interface ContextoPainel {
  user: SessionUser;
  ehDono: boolean;
  resumo: OnboardingSummary;
  termosCount: number;
}

export async function carregarContexto(): Promise<ContextoPainel> {
  const user = await requireUser();
  const configuration = env();
  const database = db();

  const [instalacoes, emails, termos, tokens] = await Promise.all([
    database
      .select({ n: count() })
      .from(githubInstallations)
      .where(eq(githubInstallations.userId, user.id)),
    database.select({ n: count() }).from(userEmails).where(eq(userEmails.userId, user.id)),
    database.select({ n: count() }).from(deniedTerms).where(eq(deniedTerms.userId, user.id)),
    database
      .select({ provider: oauthTokens.provider })
      .from(oauthTokens)
      .where(eq(oauthTokens.userId, user.id)),
  ]);

  const providers = new Set(tokens.map((t) => t.provider));

  return {
    user,
    ehDono: user.role === "owner",
    termosCount: termos[0]?.n ?? 0,
    resumo: computeOnboarding({
      installationCount: instalacoes[0]?.n ?? 0,
      emailCount: emails[0]?.n ?? 0,
      telegramLinked: user.telegramChatId !== null,
      hasCollaborationGrant: providers.has(GITHUB_COLLAB_PROVIDER),
      hasLinkedIn: providers.has(LINKEDIN_PROVIDER),
      collaborationsAvailable: configuration.GITHUB_OAUTH_CLIENT_ID !== undefined,
      linkedInAvailable:
        CONEXAO_LINKEDIN_PRONTA && configuration.LINKEDIN_CLIENT_ID !== undefined,
    }),
  };
}
