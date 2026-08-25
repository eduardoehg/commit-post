/**
 * Um post: ler, editar e decidir — Fase 6.
 *
 * A edição existe porque o modelo escreve bem e não escreve como você. Trocar
 * uma frase antes de aprovar é mais rápido do que recusar e esperar a semana
 * seguinte.
 *
 * O texto editado vai para `edited_body` e o original fica: comparar o que o
 * sistema escreveu com o que foi publicado é o único jeito de saber se o
 * prompt está melhorando.
 *
 * A decisão daqui é a MESMA do Telegram, pela mesma função. Duas
 * implementações da regra "aprovar encerra as irmãs" divergiriam, e a versão
 * errada seria a que ninguém testou.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { postBatches, postCandidates } from "@commitpost/core/db";
import { Botao, Cartao, Recado, Selo, TituloPagina, type EstadoSelo } from "@/components/ui";
import { aprovarPost, recusarPost, salvarTexto } from "@/app/(painel)/acoes";
import { db } from "@/lib/runtime";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";
import estilos from "./post.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post" };

const ROTULO: Record<string, { texto: string; estado: EstadoSelo }> = {
  pending: { texto: "esperando decisão", estado: "pendente" },
  approved: { texto: "aprovado", estado: "ok" },
  published: { texto: "publicado", estado: "ok" },
  rejected: { texto: "recusado", estado: "inativo" },
  superseded: { texto: "encerrado", estado: "inativo" },
};

export default async function PaginaPost({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await carregarContexto();
  const { id } = await params;

  const candidateId = Number(id);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) notFound();

  const linhas = await db()
    .select({
      id: postCandidates.id,
      body: postCandidates.body,
      editedBody: postCandidates.editedBody,
      status: postCandidates.status,
      variante: postCandidates.variantIndex,
      commits: postBatches.commitCount,
      janelaInicio: postBatches.windowStart,
      janelaFim: postBatches.windowEnd,
    })
    .from(postCandidates)
    .innerJoin(postBatches, eq(postBatches.id, postCandidates.batchId))
    // O `user_id` é a trava: um id de candidato é adivinhável, e sem ela
    // qualquer dev leria — e aprovaria — o post de outro.
    .where(and(eq(postCandidates.id, candidateId), eq(postCandidates.userId, user.id)))
    .limit(1);

  const post = linhas[0];
  if (post === undefined) notFound();

  const rotulo = ROTULO[post.status] ?? { texto: post.status, estado: "pendente" as const };
  const texto = post.editedBody ?? post.body;
  const editado = post.editedBody !== null && post.editedBody !== post.body;
  const decidivel = post.status === "pending";

  const sp = await searchParams;
  const erro = primeiroParam(sp["erro"]);
  const aviso = primeiroParam(sp["aviso"]);

  return (
    <>
      <TituloPagina
        titulo={`Opção ${String(post.variante + 1)}`}
        descricao={
          <>
            De {post.commits} commit(s), entre {formatar(post.janelaInicio)} e{" "}
            {formatar(post.janelaFim)}.
          </>
        }
        acao={<Selo estado={rotulo.estado}>{rotulo.texto}</Selo>}
      />

      {erro !== undefined && <Recado tom="erro">{erro}</Recado>}
      {aviso !== undefined && <Recado tom="aviso">{aviso}</Recado>}

      <Cartao
        titulo="O texto"
        descricao={
          decidivel
            ? "Ajuste o que quiser antes de aprovar. O original fica guardado."
            : "Este post já foi decidido — o texto fica como registro."
        }
      >
        <form action={salvarTexto}>
          <input type="hidden" name="id" value={post.id} />
          <textarea
            name="texto"
            className={estilos.editor}
            defaultValue={texto}
            rows={14}
            maxLength={3000}
            readOnly={!decidivel}
            aria-label="Texto do post"
          />

          <div className={estilos.rodapeEditor}>
            <span className={estilos.contagem}>
              {texto.length} de 3000 caracteres
              {editado && " · editado por você"}
            </span>
            {decidivel && (
              <Botao type="submit" tom="discreto">
                Salvar texto
              </Botao>
            )}
          </div>
        </form>
      </Cartao>

      {decidivel && (
        <Cartao
          titulo="Decidir"
          descricao="Aprovar encerra as outras versões deste mesmo lote — elas contam o mesmo trabalho."
        >
          <div className={estilos.decisao}>
            <form action={aprovarPost}>
              <input type="hidden" name="id" value={post.id} />
              <Botao type="submit" tom="principal">
                Aprovar
              </Botao>
            </form>

            <form action={recusarPost}>
              <input type="hidden" name="id" value={post.id} />
              <Botao type="submit" tom="perigo">
                Recusar
              </Botao>
            </form>
          </div>
        </Cartao>
      )}
    </>
  );
}

function formatar(d: Date): string {
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}
