"use server";

/**
 * As ações da tela de introdução.
 *
 * São Server Actions, e não rotas de API, para que cada `<form>` funcione
 * mesmo com JavaScript desligado — o que aqui não é purismo: é o que faz a
 * tela ser testável abrindo o navegador, sem estado de cliente para depurar
 * quando algo não grava.
 *
 * Toda ação começa por `requireUser()`. Nenhuma delas aceita um id de usuário
 * vindo do formulário, justamente para não existir o campo escondido que um
 * dia alguém trocaria pelo id de outra pessoa.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { deniedTerms, userEmails, users } from "@commitpost/core/db";
import { db, requireUser } from "@/lib/runtime";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Um termo curto demais viraria censura de sílaba solta no texto do post. */
const MIN_TERM_LENGTH = 2;
const MAX_TERM_LENGTH = 120;

function done(params: Record<string, string> = {}): never {
  revalidatePath("/onboarding");
  const query = new URLSearchParams(params).toString();
  redirect(query === "" ? "/onboarding" : `/onboarding?${query}`);
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function adicionarEmail(formData: FormData): Promise<void> {
  const user = await requireUser();
  const email = field(formData, "email").toLowerCase();

  if (!EMAIL_RE.test(email)) done({ erro: "Isso não parece um e-mail." });

  const inserted = await db()
    .insert(userEmails)
    .values({ userId: user.id, email, source: "manual" })
    .onConflictDoNothing()
    .returning({ id: userEmails.id });

  // O índice é global. Não inserir aqui significa que o e-mail já pertence a
  // alguém — a este dev (inofensivo) ou a outro (o que precisa ser dito, senão
  // ele fica clicando sem entender por que nada aparece).
  if (inserted.length === 0) {
    const meus = await db()
      .select({ id: userEmails.id })
      .from(userEmails)
      .where(and(eq(userEmails.userId, user.id), eq(userEmails.email, email)));

    if (meus.length === 0) {
      done({
        erro:
          "Este e-mail já está registrado para outro dev. Cada e-mail de autor " +
          "pertence a uma pessoa só — senão o mesmo commit viraria post duas vezes.",
      });
    }
  }

  done();
}

export async function removerEmail(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(field(formData, "id"));
  if (!Number.isInteger(id)) done({ erro: "Registro inválido." });

  await db()
    .delete(userEmails)
    .where(and(eq(userEmails.userId, user.id), eq(userEmails.id, id)));

  done();
}

export async function adicionarTermo(formData: FormData): Promise<void> {
  const user = await requireUser();
  const term = field(formData, "termo");

  if (term.length < MIN_TERM_LENGTH) {
    done({ erro: `Use ao menos ${String(MIN_TERM_LENGTH)} caracteres.` });
  }
  if (term.length > MAX_TERM_LENGTH) {
    done({ erro: "Termo longo demais — use o nome, não a frase inteira." });
  }

  await db()
    .insert(deniedTerms)
    .values({ userId: user.id, term, source: "manual" })
    .onConflictDoNothing();

  done();
}

export async function removerTermo(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(field(formData, "id"));
  if (!Number.isInteger(id)) done({ erro: "Registro inválido." });

  await db()
    .delete(deniedTerms)
    .where(and(eq(deniedTerms.userId, user.id), eq(deniedTerms.id, id)));

  done();
}

/**
 * "Não tenho nada a esconder", dito de propósito.
 *
 * Existe para que uma lista vazia seja uma escolha e não um passo pulado sem
 * querer. Quem só tem repositório pessoal aberto realmente não tem termos a
 * proibir, e exigir uma lista fingida seria teatro.
 */
export async function confirmarDenylistVazia(): Promise<void> {
  const user = await requireUser();

  await db()
    .update(users)
    .set({ denylistAcknowledgedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  done();
}

export async function desvincularTelegram(): Promise<void> {
  const user = await requireUser();

  await db()
    .update(users)
    .set({ telegramChatId: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  done({ aviso: "Telegram desvinculado. Você não receberá posts até vincular de novo." });
}
