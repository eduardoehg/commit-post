/**
 * Histórico — a tela inicial de quem já configurou.
 *
 * Depois que as conexões obrigatórias estão de pé, a introdução some da
 * navegação e este vira o lugar onde o dev chega. É a diferença entre um
 * sistema que está sendo montado e um que está trabalhando.
 *
 * O que a tela otimiza é copiar rápido: enquanto a publicação automática não
 * existir, o caminho de um post aprovado até o LinkedIn passa por um
 * Ctrl+C — e é isso que não pode ter atrito.
 */

import type { Metadata } from "next";
import { Acao, Recado, Selo, TituloPagina, Vazio, type EstadoSelo } from "@/components/ui";
import { historicoDe, type PostHistorico } from "@/lib/dados";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";
import estilos from "./inicio.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Histórico" };

/** Os filtros da barra. `undefined` é "tudo". */
const FILTROS = [
  { chave: undefined, rotulo: "Todos" },
  { chave: "pending", rotulo: "Esperando" },
  { chave: "approved", rotulo: "Aprovados" },
  { chave: "published", rotulo: "Publicados" },
  { chave: "rejected", rotulo: "Recusados" },
] as const;

const ROTULO_STATUS: Record<string, { texto: string; estado: EstadoSelo }> = {
  pending: { texto: "esperando decisão", estado: "pendente" },
  approved: { texto: "aprovado", estado: "ok" },
  published: { texto: "publicado", estado: "ok" },
  rejected: { texto: "recusado", estado: "inativo" },
  superseded: { texto: "encerrado", estado: "inativo" },
};

export default async function PaginaInicio({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, resumo } = await carregarContexto();
  const params = await searchParams;

  const filtro = primeiroParam(params["status"]);
  const posts = await historicoDe(user.id, filtro);

  return (
    <>
      <TituloPagina
        titulo="Histórico"
        descricao="Tudo que o sistema já escreveu para você, e o que aconteceu com cada versão."
      />

      {primeiroParam(params["aviso"]) !== undefined && (
        <Recado tom="aviso">{primeiroParam(params["aviso"])}</Recado>
      )}

      <nav className={estilos.filtros} aria-label="Filtrar por estado">
        {FILTROS.map((f) => {
          const ativo = filtro === f.chave;
          return (
            <Acao
              key={f.rotulo}
              href={f.chave === undefined ? "/inicio" : `/inicio?status=${f.chave}`}
              tom="discreto"
              aria-current={ativo ? "page" : undefined}
            >
              {f.rotulo}
            </Acao>
          );
        })}
      </nav>

      {posts.length === 0 ? (
        <Vazio>
          {resumo.ready
            ? "Nada ainda. O ciclo roda toda segunda e os posts aparecem aqui — e no seu Telegram."
            : "Nada ainda. Termine as conexões obrigatórias para o primeiro ciclo rodar."}
        </Vazio>
      ) : (
        <ol className={estilos.lista}>
          {posts.map((post) => (
            <Post key={post.id} post={post} />
          ))}
        </ol>
      )}
    </>
  );
}

function Post({ post }: { post: PostHistorico }) {
  const rotulo = ROTULO_STATUS[post.status] ?? { texto: post.status, estado: "pendente" as const };
  const quando = post.decididoEm ?? post.criadoEm;

  return (
    <li className={estilos.post} data-estado={post.status}>
      <div className={estilos.meta}>
        <Selo estado={rotulo.estado}>{rotulo.texto}</Selo>
        <span className={estilos.data}>
          <time dateTime={quando.toISOString()}>{formatarData(quando)}</time>
          {" · "}
          {post.commits} commit(s) · opção {post.variante + 1}
        </span>
      </div>

      {/*
        O texto vai inteiro, sem cortar. Um post de LinkedIn cabe na tela e o
        que o dev precisa fazer aqui é ler e copiar — "ver mais" seria um
        clique entre ele e a única ação da página.
      */}
      <p className={estilos.corpo}>{post.corpo}</p>

      <div className={estilos.acoes}>
        <Acao href={`/post/${String(post.id)}`} tom="discreto">
          {post.status === "pending" ? "Revisar e decidir" : "Abrir"}
        </Acao>
      </div>
    </li>
  );
}

/** dd/mm/aaaa — o formato que se lê no Brasil sem pensar. */
function formatarData(d: Date): string {
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}
