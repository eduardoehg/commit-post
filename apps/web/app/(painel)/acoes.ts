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
import {
  decideCandidate,
  deniedTerms,
  grantAccess,
  listAccess,
  normalizeLogin,
  podeRevogar,
  postCandidates,
  renameRepo,
  revokeAccess,
  setRepoActive,
  userEmails,
  users,
} from "@commitpost/core/db";
import { publicarNoLinkedIn } from "@/lib/publicar";
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

export async function desvincularTelegram(): Promise<void> {
  const user = await requireUser();

  await db()
    .update(users)
    .set({ telegramChatId: null, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  done({ aviso: "Telegram desvinculado. Você não receberá posts até vincular de novo." });
}

export async function alternarRepo(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(field(formData, "id"));
  if (!Number.isInteger(id)) done({ erro: "Registro inválido." });

  await setRepoActive(db(), user.id, id, field(formData, "ativo") === "1");
  done();
}

export async function renomearRepo(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(field(formData, "id"));
  if (!Number.isInteger(id)) done({ erro: "Registro inválido." });

  const apelido = field(formData, "apelido");
  if (apelido === "") done({ erro: "O apelido não pode ficar vazio." });

  await renameRepo(db(), user.id, id, apelido);
  done();
}

// ---------------------------------------------------------------------------
// Acesso de outros devs — só o dono
// ---------------------------------------------------------------------------

/**
 * A checagem de papel acontece AQUI, no servidor, e não em quem desenha a
 * tela. Esconder a aba no menu esconde na aparência; isto é o que fecha a
 * porta. Uma Server Action é um endpoint como qualquer outro — quem souber o
 * nome dela pode chamá-la sem nunca ter visto o menu.
 */
async function exigirDono(): Promise<{ id: number }> {
  const user = await requireUser();
  if (user.role !== "owner") {
    done({ erro: "Só o dono do sistema pode liberar acesso." });
  }
  return { id: user.id };
}

export async function liberarDev(formData: FormData): Promise<void> {
  const dono = await exigirDono();
  const login = normalizeLogin(field(formData, "login"));

  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/.test(login)) {
    // A regra é a do próprio GitHub: letras, números e hífen que não repete
    // nem fica na ponta, até 39 caracteres. Validar aqui evita convidar um
    // login que nunca poderá existir e ficar esperando alguém que não vem.
    done({ erro: "Isso não parece um login do GitHub." });
  }

  await grantAccess(db(), login, dono.id);
  done({ aviso: `${login} pode entrar. Mande o link do sistema para ele.` });
}

export async function revogarDev(formData: FormData): Promise<void> {
  await exigirDono();
  const login = normalizeLogin(field(formData, "login"));

  const alvo = (await listAccess(db())).find((c) => c.login === login);
  if (alvo === undefined) done({ erro: "Este login não está na lista." });

  if (!podeRevogar(alvo)) {
    // Sem esta regra um clique deixaria o sistema sem ninguém capaz de
    // convidar, e o caminho de volta seria editar variável de ambiente na
    // Vercel — que é justamente o que esta tela existe para evitar.
    done({ erro: "O dono do sistema não pode ser removido." });
  }

  await revokeAccess(db(), login);
  done({ aviso: `${login} perdeu o acesso e as sessões dele caem na próxima requisição.` });
}

// ---------------------------------------------------------------------------
// Um post: editar e decidir
// ---------------------------------------------------------------------------

/**
 * Guarda o texto ajustado em `edited_body`, deixando `body` intacto.
 *
 * O original fica porque comparar o que o sistema escreveu com o que foi
 * publicado é o único jeito de saber se o prompt está melhorando. Sobrescrever
 * apagaria essa comparação para sempre.
 */
export async function salvarTexto(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(field(formData, "id"));
  if (!Number.isSafeInteger(id) || id <= 0) done({ erro: "Post inválido." });

  const texto = field(formData, "texto");
  if (texto === "") done({ erro: "O texto não pode ficar vazio." });
  if (texto.length > 3000) done({ erro: "O LinkedIn não aceita mais de 3000 caracteres." });

  const alterados = await db()
    .update(postCandidates)
    .set({ editedBody: texto })
    // Só enquanto pendente: editar um post já decidido mudaria o registro do
    // que foi aprovado, e o registro é o que dá sentido à aprovação.
    .where(
      and(
        eq(postCandidates.id, id),
        eq(postCandidates.userId, user.id),
        eq(postCandidates.status, "pending"),
      ),
    )
    .returning({ id: postCandidates.id });

  if (alterados.length === 0) done({ erro: "Este post não está mais aberto para edição." });
  done({ aviso: "Texto salvo." });
}

async function decidirPeloPainel(formData: FormData, decisao: "approve" | "reject"): Promise<void> {
  const user = await requireUser();
  const id = Number(field(formData, "id"));
  if (!Number.isSafeInteger(id) || id <= 0) done({ erro: "Post inválido." });

  // A MESMA função que o webhook do Telegram usa. Duas implementações da regra
  // "aprovar encerra as irmãs" divergiriam, e a errada seria a menos testada.
  const resultado = await decideCandidate(db(), user.id, id, decisao);

  if (resultado.tipo === "nao-encontrada") done({ erro: "Este post não está mais disponível." });
  if (resultado.tipo === "ja-decidida") done({ erro: "Este post já tinha sido decidido." });

  if (decisao === "reject") done({ aviso: "Recusado. As outras versões continuam esperando." });

  const outras =
    resultado.tipo === "aplicada" && resultado.encerradas.length > 0
      ? ` As outras ${String(resultado.encerradas.length)} foram encerradas.`
      : "";

  // A publicação usa o mesmo caminho do Telegram. Duas implementações de
  // "aprovar publica" divergiriam, e a errada seria a menos usada.
  const publicacao = await publicarNoLinkedIn(user.id, id);

  if (publicacao.tipo === "publicado") {
    done({ aviso: `Publicado no LinkedIn.${outras} ${publicacao.url}` });
  }

  if (publicacao.tipo === "falhou") {
    // Aprovado continua aprovado: o LinkedIn estar fora não é motivo para
    // desfazer a decisão de quem aprovou. O texto segue disponível para
    // copiar, e a tela diz o que houve.
    done({ erro: `Aprovado, mas não saiu no LinkedIn: ${publicacao.motivo}` });
  }

  done({ aviso: `Aprovado.${outras} Copie o texto e publique no LinkedIn.` });
}

export async function aprovarPost(formData: FormData): Promise<void> {
  await decidirPeloPainel(formData, "approve");
}

export async function recusarPost(formData: FormData): Promise<void> {
  await decidirPeloPainel(formData, "reject");
}
