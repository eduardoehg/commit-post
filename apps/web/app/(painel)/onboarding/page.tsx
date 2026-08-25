/**
 * A introdução.
 *
 * Existe por uma decisão de produto: nada que um dev precise configurar deve
 * morar num arquivo de instruções. Cada passo é derivado do banco e fica verde
 * porque a linha existe, não porque alguém marcou uma caixa.
 *
 * As seções são as MESMAS de Conexões — os passos aqui só acrescentam a
 * moldura de "o que falta e em que ordem". Duas cópias divergiriam no primeiro
 * ajuste, e a versão errada seria justamente a que o dev novo vê.
 *
 * Quando tudo está cumprido, esta tela deixa de aparecer na navegação. Ela
 * continua acessível pela URL: quem quiser rever o caminho não deve esbarrar
 * num 404.
 */

import type { Metadata } from "next";
import type { OnboardingStep } from "@commitpost/core/onboarding";
import { Recado } from "@/components/ui";
import { SecaoGithub } from "@/components/secoes/Github";
import {
  SecaoColaboracoes,
  SecaoLinkedIn,
  SecaoTelegram,
} from "@/components/secoes/Conexoes";
import { conexoesDe, emailsDe, instalacoesDe, linkTelegramDe } from "@/lib/dados";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";
import estilos from "./onboarding.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Introdução" };

export default async function PaginaIntroducao({
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

  const erro = primeiroParam(params["erro"]);
  const aviso = primeiroParam(params["aviso"]);

  return (
    <>
      <header className={estilos.cabecalho}>
        <h1>Bem-vindo ao CommitPost</h1>
        <p className={estilos.chamada}>
          Conecte o GitHub e o Telegram e o sistema começa a trabalhar. Ele lê seus
          commits, descreve o que foi resolvido em linguagem de gente, e manda 2 a 3
          versões para você escolher. <strong>Nada é publicado sem você aprovar.</strong>
        </p>
      </header>

      {erro !== undefined && <Recado tom="erro">{erro}</Recado>}
      {aviso !== undefined && <Recado tom="aviso">{aviso}</Recado>}

      {resumo.ready && (
        <Recado tom="ok">
          Tudo pronto. No próximo ciclo você recebe os posts no Telegram — e o histórico
          passa a ser a sua tela inicial.
        </Recado>
      )}

      <ol className={estilos.passos}>
        {resumo.steps.map((passo, indice) => (
          <Passo key={passo.id} passo={passo} numero={indice + 1} destacado={passo.id === resumo.next}>
            {passo.id === "github" && <SecaoGithub instalacoes={instalacoes} emails={emails} />}
            {passo.id === "collaborations" && (
              <SecaoColaboracoes concedido={passo.done} disponivel={passo.available} />
            )}
            {passo.id === "telegram" && (
              <SecaoTelegram
                vinculado={user.telegramChatId !== null}
                link={telegram.link}
                botDisponivel={telegram.botDisponivel}
              />
            )}
            {passo.id === "linkedin" && (
              <SecaoLinkedIn
                conectado={passo.done}
                disponivel={passo.available}
                venceEm={conexoes.linkedInVenceEm}
              />
            )}
          </Passo>
        ))}
      </ol>
    </>
  );
}

function Passo({
  passo,
  numero,
  destacado,
  children,
}: {
  passo: OnboardingStep;
  numero: number;
  destacado: boolean;
  children: React.ReactNode;
}) {
  const estado = !passo.available ? "indisponivel" : passo.done ? "feito" : "aberto";

  return (
    <li className={estilos.passo} data-estado={estado} data-destacado={destacado ? "sim" : undefined}>
      <div className={estilos.marcador} aria-hidden>
        {passo.done ? "✓" : numero}
      </div>

      <div className={estilos.conteudoPasso}>
        <h2 className={estilos.tituloPasso}>
          {passo.title}
          {!passo.required && <span className={estilos.opcional}>opcional</span>}
        </h2>
        <p className={estilos.resumoPasso}>{passo.summary}</p>
        <div>{children}</div>
      </div>
    </li>
  );
}

