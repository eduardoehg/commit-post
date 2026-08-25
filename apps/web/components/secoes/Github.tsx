/**
 * A conexão com o GitHub, e nada mais.
 *
 * Os e-mails de autor moravam aqui e saíram: eles chegam sozinhos no login e
 * quase nunca precisam de atenção, mas apareciam como uma segunda tarefa
 * dentro do mesmo card — e quem estava só tentando conectar uma conta não
 * entendia o que uma coisa tinha a ver com a outra.
 *
 * Agora vivem em `SecaoEmails`, fora da introdução. Quando estão vazios, o
 * painel avisa — ver `avisos` em `computeOnboarding`.
 */

import { adicionarEmail, removerEmail } from "@/app/(painel)/acoes";
import {
  Acao,
  Botao,
  Campo,
  Item,
  LinhaForm,
  Lista,
  Nota,
  Recado,
  Selo,
  Vazio,
} from "../ui";
import estilos from "./secoes.module.css";

export interface Instalacao {
  id: number;
  accountLogin: string;
  accountType: string;
  suspendedAt: Date | null;
}

export interface EmailAutor {
  id: number;
  email: string;
  source: string;
}

export function SecaoGithub({
  instalacoes,
}: {
  instalacoes: readonly Instalacao[];
}) {
  const vazio = instalacoes.length === 0;

  return (
    <>
      {vazio ? (
        <Vazio>Nenhuma conta conectada ainda.</Vazio>
      ) : (
        <Lista>
          {instalacoes.map((i) => (
            <Item key={i.id}>
              <span>
                <strong>{i.accountLogin}</strong>{" "}
                <span className={estilos.secundario}>
                  {i.accountType === "Organization"
                    ? "organização"
                    : "conta pessoal"}
                </span>
              </span>
              {i.suspendedAt !== null && <Selo estado="erro">suspensa</Selo>}
            </Item>
          ))}
        </Lista>
      )}

      <div className={estilos.acoes}>
        <Acao
          href="/api/auth/github/install"
          tom={vazio ? "principal" : "discreto"}
        >
          {vazio ? "Conectar o GitHub" : "Conectar outra conta"}
        </Acao>
        {!vazio && (
          <Acao href="/api/auth/github/login" tom="discreto">
            Atualizar
          </Acao>
        )}
      </div>

      <Nota>
        {vazio
          ? "Você escolhe quais repositórios liberar. O acesso é de leitura e expira em uma hora a cada uso."
          : "Instalou em outra conta agora? Use Atualizar para o sistema enxergar."}
      </Nota>
    </>
  );
}

/**
 * Os e-mails que identificam um commit como seu.
 *
 * Fora da introdução de propósito: chegam preenchidos do GitHub e o dev só
 * precisa mexer aqui se assina commits de trabalho com um endereço que não
 * está na conta dele. É a exceção, e o lugar da exceção não é o caminho de
 * quem está começando.
 */
export function SecaoEmails({
  voltar,
  emails,
}: {
  voltar: string;
  emails: readonly EmailAutor[];
}) {
  return (
    <>
      {emails.length === 0 ? (
        <Recado tom="aviso">
          Sem nenhum e-mail aqui, a coleta roda e não reconhece nenhum commit
          como seu. Acrescente ao menos um.
        </Recado>
      ) : (
        <Lista>
          {emails.map((e) => (
            <Item key={e.id}>
              <span className={estilos.quebra}>
                {e.email}
                {e.source === "github" && (
                  <span className={estilos.secundario}> · do GitHub</span>
                )}
              </span>
              <form action={removerEmail}>
                <input type="hidden" name="voltar" value={voltar} />
                <input type="hidden" name="id" value={e.id} />
                <Botao type="submit" tom="perigo">
                  Remover
                </Botao>
              </form>
            </Item>
          ))}
        </Lista>
      )}

      <form action={adicionarEmail}>
        <input type="hidden" name="voltar" value={voltar} />
        <LinhaForm>
          <Campo
            type="email"
            name="email"
            placeholder="voce@empresa.com"
            required
            aria-label="E-mail de autor"
          />
          <Botao
            type="submit"
            tom={emails.length === 0 ? "principal" : "discreto"}
          >
            Adicionar
          </Botao>
        </LinhaForm>
      </form>

      <Nota>
        Confira com <code>git config user.email</code> na máquina onde você
        trabalha. Se o e-mail do trabalho não está na sua conta do GitHub, ele
        precisa entrar aqui.
      </Nota>
    </>
  );
}
