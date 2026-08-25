/**
 * Histórico — a tela inicial de quem já configurou.
 *
 * Depois que as conexões obrigatórias estão de pé, a introdução some da
 * navegação e este vira o lugar onde o dev chega. É a diferença entre um
 * sistema que está sendo montado e um que está trabalhando.
 *
 * O filtro padrão é **aprovados**, e não "todos", porque é a única lista que
 * pede alguma coisa de quem chega: enquanto a publicação automática não
 * cobrir tudo, aprovado é o que ainda precisa ir para o LinkedIn. Recusado e
 * encerrado são arquivo, e arquivo não é o que se abre primeiro.
 *
 * Cada filtro mostra quantos tem. Sem o número, escolher entre seis abas é
 * adivinhar qual delas não está vazia.
 */

import type { Metadata } from "next";
import { Acao, Recado, Selo, TituloPagina, Vazio, type EstadoSelo } from "@/components/ui";
import { contagemPorStatus, historicoDe, type PostHistorico } from "@/lib/dados";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";
import estilos from "./inicio.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Histórico" };

/** Marcador de "sem filtro" na URL. `/inicio` sozinho já significa aprovados. */
const TODOS = "todos";
const PADRAO = "approved";

/**
 * A ordem segue o quanto cada lista pede de quem está olhando: aprovado
 * espera uma ação, esperando espera uma decisão, o resto é registro.
 */
const FILTROS = [
  { chave: "approved", rotulo: "Aprovados" },
  { chave: "pending", rotulo: "Esperando" },
  { chave: "published", rotulo: "Publicados" },
  { chave: "rejected", rotulo: "Recusados" },
  { chave: "superseded", rotulo: "Encerrados" },
  { chave: TODOS, rotulo: "Todos" },
] as const;

const ROTULO_STATUS: Record<string, { texto: string; estado: EstadoSelo }> = {
  pending: { texto: "esperando decisão", estado: "pendente" },
  approved: { texto: "aprovado", estado: "ok" },
  published: { texto: "publicado", estado: "ok" },
  rejected: { texto: "recusado", estado: "inativo" },
  superseded: { texto: "encerrado", estado: "inativo" },
};

const VAZIO_POR_FILTRO: Record<string, string> = {
  approved: "Nenhum post aprovado esperando publicação.",
  pending: "Nenhum post esperando decisão.",
  published: "Nada publicado ainda.",
  rejected: "Nenhum post recusado.",
  superseded: "Nenhuma versão encerrada.",
};

export default async function PaginaInicio({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, resumo } = await carregarContexto();
  const params = await searchParams;

  const pedido = primeiroParam(params["status"]) ?? PADRAO;
  const filtro = FILTROS.some((f) => f.chave === pedido) ? pedido : PADRAO;

  const [posts, contagem] = await Promise.all([
    historicoDe(user.id, filtro === TODOS ? undefined : filtro),
    contagemPorStatus(user.id),
  ]);

  const nada = (contagem[TODOS] ?? 0) === 0;

  return (
    <>
      <TituloPagina
        titulo="Histórico"
        descricao="Tudo que o sistema já escreveu para você, e o que aconteceu com cada versão."
      />

      {primeiroParam(params["aviso"]) !== undefined && (
        <Recado tom="aviso">{primeiroParam(params["aviso"])}</Recado>
      )}
      {primeiroParam(params["erro"]) !== undefined && (
        <Recado tom="erro">{primeiroParam(params["erro"])}</Recado>
      )}

      <nav className={estilos.filtros} aria-label="Filtrar por estado">
        {FILTROS.map((f) => {
          const quantos = contagem[f.chave] ?? 0;

          return (
            <Acao
              key={f.chave}
              href={f.chave === PADRAO ? "/inicio" : `/inicio?status=${f.chave}`}
              tom="discreto"
              aria-current={filtro === f.chave ? "page" : undefined}
              data-vazio={quantos === 0 ? "sim" : undefined}
            >
              {f.rotulo}
              <span className={estilos.contagem}>{quantos}</span>
            </Acao>
          );
        })}
      </nav>

      {posts.length === 0 ? (
        <Vazio>
          {nada
            ? resumo.ready
              ? "Nada ainda. O ciclo roda toda segunda e os posts aparecem aqui — e no seu Telegram."
              : "Nada ainda. Termine as conexões obrigatórias para o primeiro ciclo rodar."
            : (VAZIO_POR_FILTRO[filtro] ?? "Nada neste filtro.")}
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
