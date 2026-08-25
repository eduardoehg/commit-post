/**
 * Devs — só o dono vê.
 *
 * Existe porque não há cadastro convencional: entrar é entrar com o GitHub, e
 * quem pode entrar é uma lista. Antes essa lista era variável de ambiente, o
 * que fazia liberar um colega exigir acesso ao painel da Vercel e um redeploy.
 *
 * A tela mostra a diferença entre "convidado" e "já entrou" porque é a única
 * coisa que o dono precisa saber para decidir se cobra a pessoa ou se o link
 * se perdeu no caminho.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listAccess, podeRevogar } from "@commitpost/core/db";
import {
  Botao,
  Campo,
  Cartao,
  Item,
  LinhaForm,
  Lista,
  Nota,
  Recado,
  Selo,
  TituloPagina,
  Vazio,
} from "@/components/ui";
import { liberarDev, revogarDev } from "@/app/(painel)/acoes";
import { db, env } from "@/lib/runtime";
import { carregarContexto } from "@/lib/painel";
import { primeiroParam } from "@/lib/params";
import estilos from "./devs.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Devs" };

export default async function PaginaDevs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ehDono } = await carregarContexto();

  // Quem não é dono não vê a aba, mas a URL é adivinhável. A porta se fecha
  // aqui, não no menu.
  if (!ehDono) redirect("/inicio");

  const params = await searchParams;
  const convidados = await listAccess(db());
  const semente = env().ALLOWED_GITHUB_LOGINS;

  const erro = primeiroParam(params["erro"]);
  const aviso = primeiroParam(params["aviso"]);

  return (
    <>
      <TituloPagina
        titulo="Devs"
        descricao="Quem pode entrar no CommitPost. Não há cadastro nem senha: você libera o login do GitHub, a pessoa entra com a conta dela e passa pela introdução."
      />

      {erro !== undefined && <Recado tom="erro">{erro}</Recado>}
      {aviso !== undefined && <Recado tom="aviso">{aviso}</Recado>}

      <Cartao titulo="Liberar acesso">
        <form action={liberarDev}>
          <LinhaForm>
            <Campo
              type="text"
              name="login"
              placeholder="login-no-github"
              required
              maxLength={39}
              aria-label="Login do GitHub"
              autoComplete="off"
            />
            <Botao type="submit" tom="principal">
              Liberar
            </Botao>
          </LinhaForm>
        </form>

        <Nota>
          É o nome que aparece em <code>github.com/nome</code> — não o e-mail nem o nome
          completo. Se a pessoa trocar o login no GitHub, o convite deixa de valer e
          basta liberar o novo.
        </Nota>
      </Cartao>

      <Cartao titulo={`${String(convidados.length)} liberado(s)`}>
        {convidados.length === 0 ? (
          <Vazio>Ninguém liberado por aqui ainda.</Vazio>
        ) : (
          <Lista>
            {convidados.map((c) => (
              <Item key={c.id}>
                <span className={estilos.pessoa}>
                  <strong>{c.login}</strong>
                  {c.usuarioId === null ? (
                    <Selo estado="pendente">convidado, ainda não entrou</Selo>
                  ) : c.ativo === false ? (
                    <Selo estado="inativo">desativado</Selo>
                  ) : (
                    <Selo estado="ok">{c.papel === "owner" ? "dono" : "ativo"}</Selo>
                  )}
                </span>

                {podeRevogar(c) ? (
                  <form action={revogarDev}>
                    <input type="hidden" name="login" value={c.login} />
                    <Botao type="submit" tom="perigo">
                      Remover
                    </Botao>
                  </form>
                ) : (
                  <span className={estilos.protegido}>não removível</span>
                )}
              </Item>
            ))}
          </Lista>
        )}

        <Nota>
          Remover apaga o convite <strong>e</strong> desativa a conta — as sessões abertas
          caem na requisição seguinte. Os posts e commits da pessoa continuam no banco.
        </Nota>
      </Cartao>

      {semente.length > 0 && (
        <Cartao
          titulo="Escotilha do operador"
          descricao="Logins liberados pela variável de ambiente, fora desta lista. Existem para o dia em que ninguém conseguir entrar — não dá para removê-los daqui."
        >
          <Lista>
            {semente.map((login) => (
              <Item key={login}>
                <span>{login}</span>
                <span className={estilos.protegido}>via ALLOWED_GITHUB_LOGINS</span>
              </Item>
            ))}
          </Lista>
        </Cartao>
      )}
    </>
  );
}
