/**
 * Traz do GitHub tudo que a tela de introdução precisaria pedir na mão.
 *
 * Roda no callback do login, que é o único momento em que existe um token de
 * usuário do GitHub — e ele morre no fim desta função, sem tocar o banco. É o
 * que permite "Já instalei, atualizar" ser um simples ir-e-voltar pelo login,
 * em vez de exigir Setup URL configurada no App ou um token guardado.
 *
 * Três coisas vêm daqui: as instalações, os e-mails de autor e a sugestão de
 * denylist a partir dos nomes reais dos repositórios.
 */

import { and, eq, notInArray } from "drizzle-orm";
import {
  fetchCollaboratorRepos,
  fetchInstallationRepos,
  fetchVerifiedEmails,
  fetchViewerInstallations,
  noreplyEmail,
  type GitHubViewer,
} from "@commitpost/core/github";
import { deniedTerms, githubInstallations, userEmails } from "@commitpost/core/db";
import { proposeDeniedTerms } from "@commitpost/core/onboarding";
import { db } from "./runtime";

export interface SyncResult {
  installations: number;
  emailsAdded: number;
  suggestedTerms: number;
  /** Verdadeiro quando o App está sem a permissão de e-mail. */
  emailsUnavailable: boolean;
}

export async function syncFromGitHub(
  userId: number,
  viewer: GitHubViewer,
  userToken: string,
): Promise<SyncResult> {
  const database = db();
  const now = new Date();

  // --- Instalações -------------------------------------------------------
  const installations = await fetchViewerInstallations(userToken);

  for (const i of installations) {
    await database
      .insert(githubInstallations)
      .values({
        userId,
        installationId: i.installationId,
        accountLogin: i.accountLogin,
        accountType: i.accountType,
        suspendedAt: i.suspended ? now : null,
      })
      .onConflictDoUpdate({
        target: [githubInstallations.userId, githubInstallations.installationId],
        set: {
          accountLogin: i.accountLogin,
          accountType: i.accountType,
          suspendedAt: i.suspended ? now : null,
          updatedAt: now,
        },
      });
  }

  // Desinstalar no GitHub precisa sumir daqui também, senão a tela continua
  // dizendo que está tudo conectado enquanto a coleta devolve 404.
  const vistos = installations.map((i) => i.installationId);
  await database
    .delete(githubInstallations)
    .where(
      vistos.length === 0
        ? eq(githubInstallations.userId, userId)
        : and(
            eq(githubInstallations.userId, userId),
            notInArray(githubInstallations.installationId, vistos),
          ),
    );

  // --- E-mails de autor --------------------------------------------------
  let verificados: string[] = [];
  let emailsUnavailable = false;

  try {
    verificados = await fetchVerifiedEmails(userToken);
  } catch {
    // 403 aqui significa App sem a permissão Email addresses: Read-only. Não é
    // motivo para derrubar o login — a tela cai no preenchimento manual.
    emailsUnavailable = true;
  }

  const candidatos = [...new Set([...verificados, noreplyEmail(viewer)])];
  let emailsAdded = 0;

  for (const email of candidatos) {
    // `onConflictDoNothing` no índice global: se o e-mail já é de outro dev, a
    // linha simplesmente não entra. É a regra que impede o mesmo commit de
    // virar post de dois donos.
    const inseridos = await database
      .insert(userEmails)
      .values({ userId, email, source: "github" })
      .onConflictDoNothing()
      .returning({ id: userEmails.id });

    emailsAdded += inseridos.length;
  }

  // --- Sugestão de denylist ----------------------------------------------
  // O nome da conta onde o App foi instalado costuma ser o do empregador.
  const contas = installations.map((i) => i.accountLogin);
  const repos = [];

  for (const i of installations) {
    try {
      repos.push(...(await fetchInstallationRepos(i.installationId, userToken)));
    } catch {
      // Uma instalação inacessível não pode impedir as outras de contribuir.
    }
  }

  const termos = proposeDeniedTerms(repos, contas, viewer.login);

  return {
    installations: installations.length,
    emailsAdded,
    suggestedTerms: await gravarTermos(userId, termos),
    emailsUnavailable,
  };
}

/**
 * Propõe termos a partir dos repositórios de COLABORAÇÃO.
 *
 * Sem isto a proposta cobria exatamente os repositórios errados. A denylist
 * automática existe porque pedir que alguém *lembre* de todo nome de cliente é
 * a parte mais frágil do processo — e é nas colaborações, nos repositórios de
 * outras pessoas, que esses nomes moram. Cobrir só o que a instalação enxerga
 * era propor justamente onde não havia nada a esconder.
 *
 * Roda logo depois da concessão, com o token que acabou de chegar. Falhar aqui
 * não desfaz a concessão: o token já está gravado e serve à coleta; o que se
 * perde é a sugestão, que o dev pode preencher à mão.
 */
export async function proposeTermsFromCollaborations(
  userId: number,
  viewerLogin: string,
  oauthToken: string,
): Promise<number> {
  const repos = await fetchCollaboratorRepos(oauthToken);
  return gravarTermos(userId, proposeDeniedTerms(repos, [], viewerLogin));
}

async function gravarTermos(userId: number, termos: Iterable<string>): Promise<number> {
  const database = db();
  let gravados = 0;

  for (const term of termos) {
    const inseridos = await database
      .insert(deniedTerms)
      .values({ userId, term, source: "auto" })
      .onConflictDoNothing()
      .returning({ id: deniedTerms.id });

    gravados += inseridos.length;
  }

  return gravados;
}
