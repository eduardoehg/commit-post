/**
 * As três conexões que não são o GitHub App: colaborações, Telegram e
 * LinkedIn.
 *
 * Cada uma explica o alcance ANTES do botão. A de colaborações explica em
 * detalhe porque é a única do sistema que pede mais poder do que usa — e um
 * botão que pede escrita sem dizer não é consentimento, é clique.
 */

import { desvincularTelegram } from "@/app/(painel)/acoes";
import { Acao, Botao, Nota } from "../ui";
import estilos from "./secoes.module.css";

export function SecaoColaboracoes({
  concedido,
  disponivel,
}: {
  concedido: boolean;
  disponivel: boolean;
}) {
  if (!disponivel) {
    return <p className={estilos.indisponivel}>O operador ainda não configurou este caminho.</p>;
  }

  return (
    <>
      <details className={estilos.detalhes}>
        <summary>O que exatamente você está concedendo</summary>
        <p>
          Este passo usa um acesso do GitHub que dá <strong>leitura e escrita</strong> em
          todos os repositórios que você enxerga. Não é escolha nossa: o GitHub não
          oferece acesso somente-leitura a repositório privado por este caminho.
        </p>
        <p>
          O que fazemos com isso: só leitura, e nada além de listar commits seus. O
          sistema não tem nenhuma função que escreva no GitHub. O acesso fica cifrado
          no banco, e você revoga quando quiser em{" "}
          <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer">
            aplicativos autorizados
          </a>
          .
        </p>
      </details>

      <Acao
        href="/api/auth/github/oauth/authorize"
        tom={concedido ? "discreto" : "principal"}
      >
        {concedido ? "Reautorizar" : "Conceder acesso de colaboração"}
      </Acao>

      <Nota>
        Pule se todos os seus commits estão em contas onde você instalou o CommitPost.
      </Nota>
    </>
  );
}

export function SecaoTelegram({
  vinculado,
  link,
  botDisponivel,
}: {
  vinculado: boolean;
  link: string | null;
  botDisponivel: boolean;
}) {
  if (vinculado) {
    return (
      <>
        <form action={desvincularTelegram}>
          <Botao type="submit" tom="perigo">
            Desvincular este Telegram
          </Botao>
        </form>
        <Nota>
          É por onde os posts chegam para aprovação. Desvincular para o envio até você
          vincular de novo.
        </Nota>
      </>
    );
  }

  if (!botDisponivel || link === null) {
    return (
      <p className={estilos.indisponivel}>
        Não foi possível falar com o bot do Telegram. Avise o operador — o token do bot
        provavelmente está errado.
      </p>
    );
  }

  return (
    <>
      <Acao href={link} externo>
        Abrir o bot e vincular
      </Acao>
      <Nota>
        O link vale 15 minutos e serve uma vez. Basta abrir e tocar em iniciar — você não
        precisa digitar nada.
      </Nota>
    </>
  );
}

export function SecaoLinkedIn({
  conectado,
  disponivel,
  venceEm,
}: {
  conectado: boolean;
  disponivel: boolean;
  venceEm: Date | null;
}) {
  if (!disponivel) {
    return (
      <p className={estilos.indisponivel}>
        A publicação automática ainda está em aprovação no LinkedIn. Até lá, o post
        aprovado chega pronto no Telegram para você copiar.
      </p>
    );
  }

  const dias =
    venceEm === null ? null : Math.round((venceEm.getTime() - Date.now()) / 86_400_000);

  return (
    <>
      <Acao href="/api/auth/linkedin/authorize" tom={conectado ? "discreto" : "principal"}>
        {conectado ? "Reconectar" : "Conectar o LinkedIn"}
      </Acao>

      <Nota>
        {dias === null
          ? "O acesso do LinkedIn dura cerca de 60 dias e não se renova sozinho."
          : dias <= 0
            ? "O acesso venceu. Reconecte para voltar a publicar."
            : `O acesso vale mais ${String(dias)} dia(s) e não se renova sozinho — o bot avisa antes de vencer.`}{" "}
        Você revoga quando quiser em{" "}
        <a
          href="https://www.linkedin.com/mypreferences/d/permitted-services"
          target="_blank"
          rel="noreferrer"
        >
          serviços autorizados
        </a>
        .
      </Nota>
    </>
  );
}
