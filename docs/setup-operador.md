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

> **Se você já criou o GitHub App**, confira uma coisa antes de seguir: em
> *Permissions & events* → **Account permissions** → *Email addresses* precisa
> estar como **Read-only**. É a permissão mais fácil de esquecer, porque fica
> numa seção separada das de repositório. Mudar antes de existir qualquer
> instalação é de graça; depois, cada dev precisa aceitar a mudança.
>
> Para conferir sem abrir o painel, com as credenciais no `.env.local`:
> `GET /app` autenticado com o JWT do app devolve `permissions`. O que precisa
> estar lá é `contents: read`, `emails: read` e `metadata: read`.
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
   - *Homepage URL:* `https://commit-post.vercel.app`
   - *Callback URL:* `https://commit-post.vercel.app/api/auth/github/callback`
   - Marque **Request user authorization (OAuth) during installation**

3. **Desligar o webhook.** Em *Webhook*, **desmarque Active**. O CommitPost
   varre por agendamento; não precisa receber eventos do GitHub, e deixar
   ligado só cria superfície à toa.

4. **Permissões — só leitura, em três lugares.** Em *Repository permissions*:
   - **Contents:** Read-only — ler os commits
   - **Metadata:** Read-only — obrigatória pelo GitHub

   Nenhuma permissão de escrita, em lugar nenhum. Qualquer coisa além disso
   aparece na tela de instalação do dev e vira uma pergunta a responder.

   Logo abaixo, em *Account permissions*:

   - **Email addresses:** Read-only

   Esta é fácil de esquecer porque fica numa seção separada das de
   repositório. Sem ela, a tela de introdução não consegue ler os e-mails
   verificados do dev e o passo de confirmar e-mails de autor precisa ser
   digitado à mão — que é justamente o que queremos evitar.

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

## Alcançar repositórios onde o dev é apenas colaborador

Um GitHub App é instalado numa **conta**, e a instalação dá acesso aos
repositórios **daquela conta**. Se o repositório é de outra pessoa ou de uma
organização, instalar o app na sua conta não alcança ele — e o *user access
token* do App continua limitado às instalações existentes. Não há caminho por
aí.

Isso importa mais do que parece: para muita gente, é justamente nesses repos
que mora a maior parte do trabalho.

Há dois caminhos, e qual serve depende de quem é o dono.

### Repositórios de uma organização

Um admin da organização instala o CommitPost nela e seleciona os repos. É uma
conversa só, e preserva todas as vantagens do App: token de leitura que expira
em uma hora, seleção por repositório, nenhuma credencial armazenada.

O link é o mesmo de instalação; ao abri-lo, o admin escolhe a organização em
vez da conta pessoal.

### Repositórios de pessoas físicas

Aqui não dá para pedir instalação a cada dono. É preciso um token que aja como
o próprio dev — na prática, um **OAuth App clássico**, separado do GitHub App.

> **O custo é real.** O escopo `repo` é leitura **e escrita** em todos os
> repositórios que a pessoa alcança. Não existe escopo somente-leitura para
> repositório privado no OAuth clássico — `repo:read` não existe.
>
> Por isso a concessão é **opcional por dev**, aparece na tela de introdução
> como um passo separado com o alcance explicado, e o token vai **cifrado**
> para o banco. O sistema nunca chama endpoint de escrita.

Para criar:

1. `github.com/settings/developers` → **OAuth Apps** → **New OAuth App**
2. *Application name:* `CommitPost — colaborações`
3. *Homepage URL:* `https://commit-post.vercel.app`
4. *Authorization callback URL:*
   `https://commit-post.vercel.app/api/auth/github/oauth/callback`
5. **Register application** → anote o **Client ID** → **Generate a new client
   secret** e copie na hora

Repasse como `GITHUB_OAUTH_CLIENT_ID` e `GITHUB_OAUTH_CLIENT_SECRET`.

> Se a organização tiver restrição de aplicativos de terceiros, ela bloqueia os
> dois caminhos igualmente e um admin precisa aprovar de qualquer forma.

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

## Ligar o app web

Três coisas, e só uma delas é fácil de esquecer.

**1. Variáveis na Vercel.** O `.env.example` marca com `[V]` e `[AV]` o que o
app web consome. As que o login não perdoa se faltarem:

```
DATABASE_URL          GITHUB_APP_ID          GITHUB_APP_PRIVATE_KEY
APP_BASE_URL          GITHUB_APP_SLUG        TOKEN_ENCRYPTION_KEY
ALLOWED_GITHUB_LOGINS GITHUB_APP_CLIENT_ID   TELEGRAM_BOT_TOKEN
PANEL_TOKEN_SECRET    GITHUB_APP_CLIENT_SECRET  TELEGRAM_WEBHOOK_SECRET
```

Faltando qualquer uma, o boot falha listando **todas** as ausentes de uma vez,
não uma por deploy.

**2. `ALLOWED_GITHUB_LOGINS`.** É a allowlist de quem pode entrar. Login com
GitHub sem ela deixaria qualquer pessoa do mundo criar conta e passar a
consumir a chave da Anthropic. Ela não tem valor padrão: esquecê-la quebra no
boot, o que é melhor do que trancar todo mundo para fora em silêncio.

Quando entrar um dev novo, é **a única coisa** que o operador precisa fazer —
acrescentar o login do GitHub dele nesta lista.

**3. Registrar o webhook do Telegram.** O bot não sabe sozinho para onde
mandar as mensagens:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://commit-post.vercel.app/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

O `secret_token` volta em todo update no header
`X-Telegram-Bot-Api-Secret-Token`, e o webhook recusa quem não o traz. Sem
isso, qualquer um que descubra a URL consegue enviar updates forjados.

Repare no que **não** está aqui: nenhum `chat_id`. Com vários devs a lista de
quem pode aprovar vive no banco e cresce sozinha, à medida que cada um abre o
link do bot na tela de introdução.

---

## Depois disso, nada mais é manual

Com o GitHub App e o app do LinkedIn criados, o operador não precisa reunir
dado nenhum de ninguém. Cada dev entra em `commit-post.vercel.app`, faz login
com o GitHub e segue a tela de introdução:

| Passo na tela | O que acontece por baixo |
|---|---|
| Conectar o GitHub | é o próprio login; ao voltar, o sistema pergunta ao GitHub quais instalações aquele dev enxerga |
| Confirmar e-mails | lidos da API do GitHub, o dev só marca e completa |
| Proteger o que não pode vazar | o sistema **propõe** a lista a partir dos nomes reais dos repositórios e da organização; o dev confirma e acrescenta |
| Receber no Telegram | link `t.me/commitpost_bot?start=<código>` amarra o `chat_id` |
| Incluir colaborações | OAuth clássico, opcional — só para repos de outras pessoas |
| Publicar no LinkedIn | OAuth, opcional — sem ele o dev copia o post aprovado do Telegram |

O botão *"Já instalei, atualizar"* é o mesmo login: o sistema não guarda token
de usuário do GitHub, então descobrir uma instalação nova é uma ida e volta
pelo GitHub, que para quem está na tela é um piscar. É também por isso que
configurar *Setup URL* no App é opcional — sem ela nada quebra, o dev só
precisa clicar em voltar.

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
