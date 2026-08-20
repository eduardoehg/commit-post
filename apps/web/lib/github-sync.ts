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
  fetchInstallationRepos,
  fetchVerifiedEmails,
  fetchViewerInstallations,
  noreplyEmail,
  type GitHubViewer,
} from "@commitpost/core/github";
import { deniedTerms, githubInstallations, userEmails } from "@commitpost/core/db";
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
  const termos = new Set<string>();
  const meuLogin = viewer.login.toLowerCase();

  for (const i of installations) {
    // O nome da conta onde o App foi instalado costuma ser a empresa. O login
    // do próprio dev fica de fora: é a identidade pública dele, não cliente.
    if (i.accountLogin.toLowerCase() !== meuLogin) termos.add(i.accountLogin);

    try {
      for (const repo of await fetchInstallationRepos(i.installationId, userToken)) {
        termos.add(repo.name);
        if (repo.owner !== "" && repo.owner.toLowerCase() !== meuLogin) termos.add(repo.owner);
      }
    } catch {
      // Uma instalação inacessível não pode impedir as outras de contribuir.
    }
  }

  let suggestedTerms = 0;
  for (const term of termos) {
    const inseridos = await database
      .insert(deniedTerms)
      .values({ userId, term, source: "auto" })
      .onConflictDoNothing()
      .returning({ id: deniedTerms.id });

    suggestedTerms += inseridos.length;
  }

  return {
    installations: installations.length,
    emailsAdded,
    suggestedTerms,
    emailsUnavailable,
  };
}
