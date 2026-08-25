/**
 * Conexões.
 *
 * As mesmas seções da introdução, sem a moldura de passos. A diferença entre
 * as duas telas é o momento: a introdução guia quem está começando, esta aqui
 * atende quem já configurou e precisa mexer numa coisa só.
 */

import type { Metadata } from "next";
import { Cartao, Recado, TituloPagina } from "@/components/ui";
import { SecaoGithub } from "@/components/secoes/Github";
import { SecaoColaboracoes, SecaoLinkedIn, SecaoTelegram } from "@/components/secoes/Conexoes";
import { conexoesDe, emailsDe, instalacoesDe, linkTelegramDe } from "@/lib/dados";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conexões" };

export default async function PaginaConexoes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, resumo } = await carregarContexto();
  const params = await searchParams;

  const [instalacoes, emails, conexoes, telegram] = await Promise.all([
    instalacoesDe(user.id),
    emailsDe(user.id),
    conexoesDe(user.id),
    linkTelegramDe(user.id, user.telegramChatId !== null),
  ]);

  const passo = (id: string) => resumo.steps.find((s) => s.id === id);
  const erro = primeiroParam(params["erro"]);
  const aviso = primeiroParam(params["aviso"]);

  return (
    <>
      <TituloPagina
        titulo="Conexões"
        descricao="De onde os commits vêm e para onde os posts vão. Nada aqui é lido ou publicado sem uma destas quatro."
      />

      {erro !== undefined && <Recado tom="erro">{erro}</Recado>}
      {aviso !== undefined && <Recado tom="aviso">{aviso}</Recado>}

      <Cartao
        titulo="GitHub"
        descricao="As contas cujos repositórios devem virar post, e por quais e-mails você assina seus commits."
      >
        <SecaoGithub instalacoes={instalacoes} emails={emails} />
      </Cartao>

      <Cartao
        titulo="Repositórios de colaboração"
        descricao="Opcional. Só se você commita em repositórios de outras pessoas, que a instalação do App não alcança."
      >
        <SecaoColaboracoes
          concedido={conexoes.temColaboracao}
          disponivel={passo("collaborations")?.available ?? false}
        />
      </Cartao>

      <Cartao
        titulo="Telegram"
        descricao="É por onde você aprova ou recusa cada post. Sem isso, nada é publicado."
      >
        <SecaoTelegram
          vinculado={user.telegramChatId !== null}
          link={telegram.link}
          botDisponivel={telegram.botDisponivel}
        />
      </Cartao>

      <Cartao
        titulo="LinkedIn"
        descricao="Opcional. Sem ele, o post aprovado chega pronto no Telegram para você copiar."
      >
        <SecaoLinkedIn
          conectado={conexoes.temLinkedIn}
          disponivel={passo("linkedin")?.available ?? false}
          venceEm={conexoes.linkedInVenceEm}
        />
      </Cartao>
    </>
  );
}
