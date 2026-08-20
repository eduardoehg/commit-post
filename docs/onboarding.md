# Onboarding — configuração multiusuário

Tudo que precisa de ação humana para o CommitPost atender mais de um dev.
A [Parte 2](#parte-2--cada-dev-inclusive-você) é destacável: é o que cada
pessoa faz, e pode ser enviada direto para quem vai entrar.

## O que muda de verdade

No banco, multi-dev é barato: uma tabela de usuários e uma coluna de dono nas
demais. O custo real está nas credenciais — cada dev autoriza o GitHub e o
LinkedIn por conta própria, e cada um tem a sua lista de nomes a esconder.

| Peça | Antes | Agora |
|---|---|---|
| GitHub | um token seu | GitHub App, instalado por cada dev |
| Telegram | um `chat_id` | um bot, um `chat_id` por dev |
| LinkedIn | um token | um app, um token por dev |
| Denylist | uma variável de ambiente | uma lista por dev, no banco |
| E-mails de autor | os seus | os de cada dev |
| Claude e Neon | — | não mudam |

---

## Parte 1 — só o operador

### Criar o GitHub App

Substitui o token pessoal. Você faz uma vez; depois cada dev só clica em
instalar.

1. **Abrir o formulário.** `github.com/settings/apps` → **New GitHub App**.
   Para que o app pertença a uma organização, entre pelas configurações dela —
   mas conta pessoal serve.

2. **Identificação.**
   - *GitHub App name:* `CommitPost`
   - *Homepage URL:* `https://commitpost.vercel.app`
   - *Callback URL:* `https://commitpost.vercel.app/api/auth/github/callback`
   - Marque **Request user authorization (OAuth) during installation**

3. **Desligar o webhook.** Em *Webhook*, **desmarque Active**. O CommitPost
   varre por agendamento; não precisa receber eventos do GitHub, e deixar
   ligado só cria superfície à toa.

4. **Permissões — só duas, ambas de leitura.** Em *Repository permissions*:
   - **Contents:** Read-only — ler os commits
   - **Metadata:** Read-only — obrigatória pelo GitHub

   Nenhuma permissão de escrita, em lugar nenhum. Qualquer coisa além disso
   aparece na tela de instalação do dev e vira uma pergunta a responder.

5. **Permitir instalação por outras contas.** Em *Where can this GitHub App be
   installed?*, escolha **Any account**. Sem isso o segundo dev não consegue
   instalar — é o erro mais fácil de cometer aqui.

6. **Colher as credenciais.** Na página do app, depois de criar:
   - **App ID** — número no topo
   - **Client ID**
   - **Client secret** — gere um e copie na hora; não dá para ver depois
   - **Private key** — *Generate a private key*, baixa um `.pem`

   O `.pem` é multilinha e não cabe bem numa variável de ambiente. Converta
   para uma linha antes de repassar:

   ```bash
   base64 -w0 seu-app.private-key.pem
   ```

   No Windows, pelo Git Bash. Repasse o resultado da linha, não o arquivo.

7. **Instalar na própria conta.** *Install App* → sua conta → selecione os
   repositórios. Prefira **Only select repositories** a **All repositories**:
   o sistema só precisa dos que vão virar post.

### Liberar o LinkedIn para o segundo dev

O app do LinkedIn continua sendo um só — o que muda é que outra pessoa vai
precisar autorizá-lo.

Enquanto um app não passa pela verificação, o LinkedIn costuma aceitar
autorização apenas de quem está associado a ele. Abra o app no portal e confira
a aba de *Settings / Team members*: se existir a opção, adicione o segundo dev
ali. Se não existir, o caminho é concluir a verificação do app com a Company
Page.

> **Confirme antes de prometer prazo.** As regras do programa de
> desenvolvedores do LinkedIn mudam com frequência, e esta é a etapa com maior
> chance de travar. Se o segundo dev não conseguir autorizar, nada quebra: ele
> usa o sistema até a aprovação do post e publica manualmente.

---

## Parte 2 — cada dev, inclusive você

Leva uns cinco minutos.

1. **Instalar o GitHub App.** Abra o link de instalação que o operador vai
   passar, escolha sua conta e selecione **só os repositórios** que você quer
   que virem post. Dá para mudar a seleção depois e desinstalar a qualquer
   momento.

   Se algum repositório for de uma organização com SSO, o administrador dela
   precisa aprovar a instalação. Vale checar antes de contar com ele.

2. **Falar com o bot no Telegram.** Abra `t.me/commitpost_bot` e mande
   qualquer mensagem. É assim que o sistema descobre para onde mandar seus
   posts para aprovação. Sem isso você não recebe nada.

3. **Listar seus e-mails de autor no git.** Rode em cada máquina que você usa,
   e some o e-mail do trabalho se for diferente:

   ```bash
   git config user.email
   ```

   Se faltar um e-mail nessa lista, os commits feitos com ele simplesmente não
   aparecem — sem erro, sem aviso.

4. **Montar sua lista de termos proibidos.** Esta é a parte que exige atenção
   de verdade. Liste tudo que não pode aparecer num post público:

   - nome da empresa onde você trabalha, e variações dela
   - nomes de clientes
   - nomes de produtos e sistemas internos
   - nomes reais dos repositórios privados
   - domínios internos

   > **Sua lista protege só você.** O filtro é por pessoa: o que o outro dev
   > listou não cobre os seus clientes, e vice-versa.
   >
   > O sistema já descarta por padrão tudo que não reconhece como termo técnico
   > público — a lista é a segunda camada, para os casos em que um nome interno
   > também é uma palavra comum.

5. **Autorizar o LinkedIn.** Só quando o operador avisar que essa parte está
   liberada. Você recebe um link, autoriza uma vez, e o sistema passa a poder
   publicar em seu nome — sempre depois da sua aprovação no Telegram, nunca
   sozinho.

---

## Parte 3 — o que o operador precisa reunir

| Item | Origem |
|---|---|
| `GITHUB_APP_ID` | número do app |
| `GITHUB_APP_CLIENT_ID` | página do app |
| `GITHUB_APP_CLIENT_SECRET` | gerado uma vez, copiado na hora |
| `GITHUB_APP_PRIVATE_KEY` | o `.pem` em base64, uma linha |
| Por dev: nome | como identificar cada um |
| Por dev: login do GitHub | para casar com a instalação do app |
| Por dev: e-mails de autor | todos, separados por vírgula |
| Por dev: termos proibidos | a lista da Parte 2, passo 4 |

> Termos proibidos e chaves vão para o banco e para os secrets, **nunca para o
> repositório** — que é público. A lista de termos em particular nomeia
> exatamente aquilo que não pode vazar, então é tão sensível quanto o conteúdo
> que protege.

---

## O que fica mais pesado com duas pessoas

Nada aqui impede o projeto de seguir. São coisas que mudam de natureza quando o
sistema deixa de ser uma ferramenta pessoal.

**O operador passa a guardar credencial de outra pessoa.** O token do LinkedIn
do segundo dev permite publicar no perfil dele. O GitHub App evita o mesmo
problema do lado do código: os tokens são gerados na hora a partir da chave
privada do app e expiram em uma hora, então nenhuma credencial do dev fica
armazenada.

**A denylist de um fica no banco do outro.** E ela é, por definição, a lista de
clientes e produtos internos do empregador dele — provavelmente o dado mais
sensível do sistema inteiro.

**A infraestrutura é de quem opera.** O agendamento roda no repositório do
operador, com os secrets dele, e os metadados de commit de todos passam por
lá. Vale um combinado explícito sobre o que é guardado e por quanto tempo —
mesmo informal, mesmo sendo dois.
