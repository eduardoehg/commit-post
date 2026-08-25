/**
 * Instalações do GitHub e e-mails de autor.
 *
 * Os dois na mesma seção porque vêm da mesma conta e um sem o outro coleta
 * zero commits: é por e-mail de autor que o sistema reconhece um commit como
 * seu. Separá-los fazia o dev se perguntar o que um tinha a ver com o outro.
 *
 * Esta seção é renderizada em dois lugares — na introdução, dentro do passo, e
 * em Conexões, solta. É por isso que ela mora aqui e não dentro de uma página:
 * duas cópias divergiriam no primeiro ajuste.
 */

import { adicionarEmail, removerEmail } from "@/app/(painel)/acoes";
import { Acao, Botao, Campo, Item, LinhaForm, Lista, Nota, Selo, Vazio } from "../ui";
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
  emails,
}: {
  instalacoes: readonly Instalacao[];
  emails: readonly EmailAutor[];
}) {
  return (
    <>
      {instalacoes.length === 0 ? (
        <Vazio>Nenhuma conta conectada ainda.</Vazio>
      ) : (
        <Lista>
          {instalacoes.map((i) => (
            <Item key={i.id}>
              <span>
                <strong>{i.accountLogin}</strong>{" "}
                <span className={estilos.secundario}>
                  {i.accountType === "Organization" ? "organização" : "conta pessoal"}
                </span>
              </span>
              {i.suspendedAt !== null && <Selo estado="erro">suspensa</Selo>}
            </Item>
          ))}
        </Lista>
      )}

      <div className={estilos.acoes}>
        <Acao href="/api/auth/github/install" tom={instalacoes.length === 0 ? "principal" : "discreto"}>
          {instalacoes.length === 0 ? "Instalar o CommitPost" : "Instalar em outra conta"}
        </Acao>
        <Acao href="/api/auth/github/login" tom="discreto">
          Já instalei, atualizar
        </Acao>
      </div>

      <Nota>
        Se os repositórios são de uma organização, quem instala precisa ser admin dela.
        Uma instalação cobre todos os repos que você escolher.
      </Nota>

      <h3 className={estilos.subtitulo}>Seus e-mails de autor</h3>
      <p className={estilos.subdescricao}>
        É por eles que o sistema reconhece um commit como seu. O do trabalho costuma
        ser diferente do pessoal.
      </p>

      {emails.length === 0 ? (
        <Vazio>Nenhum e-mail confirmado — nenhum commit seria reconhecido como seu.</Vazio>
      ) : (
        <Lista>
          {emails.map((e) => (
            <Item key={e.id}>
              <span className={estilos.quebra}>
                {e.email}
                {e.source === "github" && <span className={estilos.secundario}> · do GitHub</span>}
              </span>
              <form action={removerEmail}>
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
        <LinhaForm>
          <Campo
            type="email"
            name="email"
            placeholder="voce@empresa.com"
            required
            aria-label="E-mail de autor"
          />
          <Botao type="submit" tom="discreto">
            Adicionar
          </Botao>
        </LinhaForm>
      </form>

      <Nota>
        Confira com <code>git config user.email</code> na máquina onde você trabalha.
      </Nota>
    </>
  );
}
