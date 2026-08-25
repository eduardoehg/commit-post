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
import {
  agendarPost,
  aprovarPost,
  desagendarPost,
  publicarAgora,
  recusarPost,
  salvarTexto,
} from "@/app/(painel)/acoes";
import { daquiADias, fusoOuPadrao, rotularInstante } from "@commitpost/core/agenda";
import { db } from "@/lib/runtime";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";
import estilos from "./post.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post" };

const ROTULO: Record<string, { texto: string; estado: EstadoSelo }> = {
  pending: { texto: "esperando decisão", estado: "pendente" },
  approved: { texto: "aprovado", estado: "ok" },
  scheduled: { texto: "agendado", estado: "pendente" },
  published: { texto: "publicado", estado: "ok" },
  rejected: { texto: "recusado", estado: "inativo" },
  superseded: { texto: "encerrado", estado: "inativo" },
};

/**
 * O valor inicial do campo de data, na hora local do dev.
 *
 * `datetime-local` só entende "AAAA-MM-DDTHH:MM" sem fuso, então o padrão
 * precisa ser montado no fuso DELE — usar o do servidor mostraria um horário
 * que não é o que a pessoa vê no relógio.
 */
function sugestaoDeHorario(fuso: string): string {
  const quando = daquiADias(new Date(), fuso, 1);
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(quando);

  const m: Record<string, string> = {};
  for (const p of partes) m[p.type] = p.value;

  return `${m["year"] ?? ""}-${m["month"] ?? ""}-${m["day"] ?? ""}T${(m["hour"] ?? "00").padStart(2, "0")}:${m["minute"] ?? "00"}`;
}

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
      tema: postCandidates.theme,
      angulo: postCandidates.angle,
      agendadoPara: postCandidates.scheduledFor,
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
  // Aprovado e não publicado: ou a publicação falhou, ou o LinkedIn não estava
  // conectado na hora. Nos dois casos o post fica sem nenhum botão que o
  // empurre — este é ele.
  const publicavel = post.status === "approved";
  const agendado = post.status === "scheduled";
  const voltar = `/post/${String(post.id)}`;

  const fuso = fusoOuPadrao(user.timezone);

  const sp = await searchParams;
  const erro = primeiroParam(sp["erro"]);
  const aviso = primeiroParam(sp["aviso"]);

  return (
    <>
      <TituloPagina
        titulo={post.tema ?? `Opção ${String(post.variante + 1)}`}
        descricao={
          <>
            De {post.commits} commit(s), entre {formatar(post.janelaInicio)} e{" "}
            {formatar(post.janelaFim)}.
            {post.angulo !== null && ` Esta versão fala pelo ângulo: ${post.angulo}.`}
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
          <input type="hidden" name="voltar" value={voltar} />
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
          titulo="Publicar agora"
          descricao="Vai ao ar no seu LinkedIn imediatamente. As outras versões DESTE assunto são encerradas — elas contam o mesmo trabalho. Os posts dos outros assuntos continuam esperando."
        >
          <div className={estilos.decisao}>
            <form action={aprovarPost}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="voltar" value={voltar} />
              <Botao type="submit" tom="principal">
                Publicar agora
              </Botao>
            </form>

            <form action={recusarPost}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="voltar" value={voltar} />
              <Botao type="submit" tom="perigo">
                Recusar
              </Botao>
            </form>
          </div>
        </Cartao>
      )}

      {decidivel && (
        <Cartao
          titulo="Ou marcar uma hora"
          descricao="O post sai sozinho no horário escolhido. É o caminho quando o lote tem vários assuntos e você não quer tudo saindo no mesmo dia."
        >
          <form action={agendarPost} className={estilos.agendamento}>
            <input type="hidden" name="id" value={post.id} />
            <input type="hidden" name="voltar" value={voltar} />
            <input
              type="datetime-local"
              name="quando"
              className={estilos.campoData}
              defaultValue={sugestaoDeHorario(fuso)}
              aria-label="Data e hora da publicação"
              required
            />
            <Botao type="submit" tom="discreto">
              Agendar
            </Botao>
          </form>

          <p className={estilos.nota}>
            No seu fuso ({fuso}). A publicação roda de hora em hora, então o post
            sai dentro da hora marcada, não no minuto exato.
          </p>
        </Cartao>
      )}

      {agendado && (
        <Cartao
          titulo="Agendado"
          descricao={
            post.agendadoPara === null
              ? "Este post está agendado, mas sem hora — avise o operador."
              : `Vai ao ar em ${rotularInstante(post.agendadoPara, fuso)}. Você não precisa fazer mais nada.`
          }
        >
          <div className={estilos.decisao}>
            <form action={publicarAgora}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="voltar" value={voltar} />
              <Botao type="submit" tom="principal">
                Publicar agora, sem esperar
              </Botao>
            </form>

            <form action={desagendarPost}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="voltar" value={voltar} />
              <Botao type="submit" tom="discreto">
                Cancelar o agendamento
              </Botao>
            </form>
          </div>
        </Cartao>
      )}

      {publicavel && (
        <Cartao
          titulo="Ainda não foi ao ar"
          descricao="Este post está aprovado mas não saiu no LinkedIn — ou a publicação falhou, ou o LinkedIn não estava conectado na hora."
        >
          <form action={publicarAgora}>
            <input type="hidden" name="id" value={post.id} />
            <input type="hidden" name="voltar" value={voltar} />
            <Botao type="submit" tom="principal">
              Publicar agora
            </Botao>
          </form>
        </Cartao>
      )}
    </>
  );
}

function formatar(d: Date): string {
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}
