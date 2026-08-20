# Setup do operador

Criação das contas de plataforma. **Acontece uma vez na vida do projeto** e
só quem opera o CommitPost precisa fazer.

> **Isto não é o onboarding dos devs.** O que cada dev faz — conectar o
> GitHub, ligar o Telegram, confirmar e-mails, montar a lista de termos
> proibidos, autorizar o LinkedIn — acontece **dentro do sistema**, numa tela
> de introdução com um passo a passo clicável. Ninguém precisa ler arquivo
> nenhum para começar a usar.

O que está aqui é só o que um aplicativo não consegue fazer por si: ele não
pode se criar antes de existir.
## O que muda com multiusuário

No banco, multi-dev é barato: uma tabela de usuários e uma coluna de dono nas
demais. O custo real está nas credenciais — cada dev autoriza o GitHub e o
LinkedIn por conta própria, e cada um tem a sua lista de nomes a esconder.
Todas essas autorizações acontecem na tela de introdução do sistema.

| Peça | Antes | Agora |
|---|---|---|
| GitHub | um token seu | GitHub App, instalado por cada dev |
| Telegram | um `chat_id` | um bot, um `chat_id` por dev |
| LinkedIn | um token | um app, um token por dev |
| Denylist | uma variável de ambiente | uma lista por dev, no banco |
| E-mails de autor | os seus | os de cada dev |
| Claude e Neon | — | não mudam |

---

## Criar o GitHub App

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

## Liberar o LinkedIn para os demais devs

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

---

## Depois disso, nada mais é manual

Com o GitHub App e o app do LinkedIn criados, o operador não precisa reunir
dado nenhum de ninguém. Cada dev entra em `commitpost.vercel.app`, faz login
com o GitHub e segue a tela de introdução:

| Passo na tela | O que acontece por baixo |
|---|---|
| Conectar o GitHub | é o próprio login; o callback já traz o `installation_id` |
| Receber no Telegram | link `t.me/commitpost_bot?start=<código>` amarra o `chat_id` |
| Confirmar e-mails | lidos da API do GitHub, o dev só marca e completa |
| Proteger o que não pode vazar | o sistema **propõe** a lista a partir dos nomes reais dos repositórios e da organização; o dev confirma e acrescenta |
| Publicar no LinkedIn | OAuth, opcional — sem ele o dev copia o post aprovado do Telegram |

Os dois passos em que o sistema propõe não são só conveniência. Pedir que
alguém *lembre* de todos os nomes de cliente é a parte mais frágil de todo o
processo, e é justamente a que não pode falhar.

---

## O que fica mais pesado com mais de uma pessoa

Nada aqui impede o projeto de seguir. São coisas que mudam de natureza quando
o sistema deixa de ser uma ferramenta pessoal.

**O operador passa a guardar credencial de outra pessoa.** O token do LinkedIn
de cada dev permite publicar no perfil dele. O GitHub App evita o mesmo
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
