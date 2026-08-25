/**
 * Repositórios e palavras bloqueadas.
 *
 * As duas listas que o dev ajusta depois de configurar, e que respondem a
 * perguntas diferentes que a tela precisa manter separadas:
 *
 *   - repositórios decide o que é LIDO;
 *   - palavras decide o que jamais é ESCRITO.
 *
 * Essa confusão já aconteceu de verdade, e é por isso que cada uma diz em voz
 * alta o que faz.
 */

import {
  adicionarTermo,
  alternarRepo,
  removerTermo,
  renomearRepo,
} from "@/app/(painel)/acoes";
import { Botao, Campo, Item, LinhaForm, Lista, Nota, Vazio } from "../ui";
import estilos from "./secoes.module.css";

export interface RepoLinha {
  id: number;
  alias: string;
  active: boolean;
}

export function SecaoRepositorios({ repos }: { repos: readonly RepoLinha[] }) {
  if (repos.length === 0) {
    return <Vazio>Os repositórios aparecem aqui depois que você conectar o GitHub.</Vazio>;
  }

  return (
    <>
      <Lista>
        {repos.map((r) => (
          <Item key={r.id}>
            <form action={renomearRepo} className={estilos.linhaRepo}>
              <input type="hidden" name="id" value={r.id} />
              <Campo
                type="text"
                name="apelido"
                defaultValue={r.alias}
                maxLength={60}
                aria-label="Apelido do repositório"
                data-inativo={r.active ? undefined : "sim"}
              />
              <Botao type="submit" tom="discreto">
                Renomear
              </Botao>
            </form>

            <form action={alternarRepo}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="ativo" value={r.active ? "0" : "1"} />
              <Botao type="submit" tom={r.active ? "perigo" : "discreto"}>
                {r.active ? "Desligar" : "Ligar"}
              </Botao>
            </form>
          </Item>
        ))}
      </Lista>

      <Nota>
        Um repositório desligado não é consultado — nem os commits dele são lidos. O
        apelido aparece na mensagem de aprovação no Telegram, então não use o nome do
        cliente.
      </Nota>
    </>
  );
}

export interface TermoLinha {
  id: number;
  term: string;
  source: string;
}

export function SecaoPalavras({ termos }: { termos: readonly TermoLinha[] }) {
  const automaticos = termos.filter((t) => t.source === "auto").length;

  return (
    <>
      {termos.length === 0 ? (
        <Vazio>Nenhuma palavra bloqueada ainda.</Vazio>
      ) : (
        <Lista>
          {termos.map((t) => (
            <Item key={t.id}>
              <span className={estilos.quebra}>
                {t.term}
                {t.source === "auto" && <span className={estilos.secundario}> · sugerido</span>}
              </span>
              <form action={removerTermo}>
                <input type="hidden" name="id" value={t.id} />
                <Botao type="submit" tom="perigo">
                  Remover
                </Botao>
              </form>
            </Item>
          ))}
        </Lista>
      )}

      <form action={adicionarTermo}>
        <LinhaForm>
          <Campo
            type="text"
            name="termo"
            placeholder="Nome de empresa, cliente ou produto"
            required
            aria-label="Palavra bloqueada"
          />
          <Botao type="submit" tom="discreto">
            Adicionar
          </Botao>
        </LinhaForm>
      </form>

      <Nota>
        {automaticos > 0 && `${String(automaticos)} vieram dos seus repositórios. `}
        Termos com menos de 3 letras são ignorados pelo filtro, e a comparação é por
        palavra inteira.
      </Nota>
    </>
  );
}
