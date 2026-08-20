# CommitPost

Transforma commits do GitHub em posts para o LinkedIn, com aprovação humana
obrigatória antes de publicar.

## Regras de negócio inegociáveis

1. **Confidencialidade acima de tudo.** Nunca expor nome de empresa, cliente,
   repositório privado, produto interno ou qualquer coisa que identifique o
   contexto profissional. O post fala da solução técnica, nunca do "para quem".
2. **Linguagem leiga.** O público do LinkedIn é misto; evitar jargão mesmo ao
   explicar solução técnica.
3. **Aprovação humana obrigatória.** O sistema gera candidatos. Nunca publica
   sozinho.
4. **2 a 3 variações por ciclo.**

## Arquitetura

```
GitHub Actions (cron, UTC)
  └─ apps/pipeline  ← o pipeline roda INTEIRO aqui, no runner
       ├─ coleta commits          packages/core/github    (Fase 2)
       ├─ filtra por allowlist    packages/core/redact    (Fase 3)
       ├─ gera 2-3 candidatos     packages/core/llm       (Fase 4)
       ├─ grava o lote            packages/core/db        (Fase 1)
       └─ envia c/ procedência    packages/core/telegram  (Fase 5)

Vercel — apps/web (só o que precisa ser HTTP público)
  ├─ /                            login                            (Fase 1.5)
  ├─ /onboarding                  tela de introdução do dev        (Fase 1.5)
  ├─ POST /api/telegram/webhook   secret + chat vinculado no banco (Fase 1.5)
  ├─ GET  /api/auth/github/login      entrar e ressincronizar      (Fase 1.5)
  ├─ GET  /api/auth/github/install    instalar o App               (Fase 1.5)
  ├─ GET  /api/auth/github/oauth/*    colaborações, opt-in         (Fase 1.5)
  ├─ GET  /post/[id]              edição do post                   (Fase 6)
  └─ GET  /api/auth/linkedin/callback  OAuth, grava token   (Fase 7)
```

## Decisões que divergem da especificação original

A spec de referência é `commitpost-especificacao.md`. Estes pontos foram
alterados deliberadamente:

| Spec original | O que fazemos | Por quê |
|---|---|---|
| Pipeline numa API route da Vercel, disparada pelo Actions com `CRON_SECRET` | Pipeline roda no runner do Actions; `CRON_SECRET` não existe | GitHub + Claude + Telegram somados estouram o limite de duração de função serverless, e falhariam no meio deixando estado sujo. Também elimina um endpoint público que existiria só para nos chamarmos |
| 6 packages (`db`, `github`, `llm`, `telegram`, `linkedin`) | 3 workspaces; os cinco viram pastas em `packages/core` | Seis `package.json` + seis `tsconfig` para um projeto solo é cerimônia de build sem retorno |
| Filtro de confidencialidade por regex/blocklist | Allowlist: extrair só o que é comprovadamente público | Blocklist só pega o que já se sabe ser perigoso. O vazamento real é o nome que ninguém previu |
| Armazenar "arquivos alterados" | Só extensões e contagem. Nunca caminhos, nunca nome real de repo | Caminhos (`src/clients/acme/`) e nomes de repo são as duas maiores fontes de vazamento |
| `post_status` como tabela | Coluna enum em `post_candidates` | É estado, não entidade. Como tabela vira um join 1:1 inútil |
| Dedup de commits na Fase 10 | UNIQUE em `commits.sha` desde a Fase 1 | É pré-requisito de idempotência para re-runs do Actions, não refinamento |
| `LINKEDIN_ACCESS_TOKEN` em env var | Token no banco com `expires_at` + aviso no Telegram | O token de membro expira em ~60 dias; em env var quebraria em silêncio a cada dois meses |
| Painel web sem menção a auth | Link assinado (HMAC), TTL curto, uso único | Sem isso é uma URL pública onde qualquer um lê e aprova posts |
| LinkedIn na Fase 7 | Registro do app iniciado na Fase 0 | Exige Company Page + aprovação do produto "Share on LinkedIn"; é o maior lead time do projeto |

## Ordem de execução das fases

Diferente da spec, as fases não são estritamente sequenciais:

- **Fase 0** — setup ✅
- **Fase 3** — filtro de confidencialidade ✅ (feita antes da Fase 2 de
  propósito: é o núcleo do sistema, é testável isoladamente e fazer primeiro
  força o desenho de dados correto na coleta)
- **Fase 1** — schema multiusuário ✅
- **Fase 1.5 — login e tela de introdução** ✅. Nova, e antes da coleta. É por
  onde cada dev conecta GitHub, Telegram, e-mails, denylist e LinkedIn.
  Sem ela não existe usuário cadastrado e nada mais roda.
- **Fase 2** — coleta ✅, com o token de instalação do GitHub App e, para quem
  concedeu, o OAuth de colaboração.
- **Fase 4** — geração dos candidatos ✅.
- **Fase 5** — aprovação no Telegram.
- **MVP para aqui**, com publicação manual (copiar do Telegram). Valida a
  qualidade dos posts sem depender de aprovação de app do LinkedIn.
- **Fase 6** — edição do post no painel, que a essa altura já existe.
- **Fase 7** — publicação no LinkedIn quando o app estiver liberado.

## O banco

Duas ausências no schema são decisões, não esquecimento:

**Não existe coluna com a mensagem do commit.** A tabela `commits` serve para
deduplicar e mostrar procedência, não para guardar conteúdo. A mensagem é lida
da API do GitHub, atravessa o filtro e é descartada na mesma execução — nunca
toca o disco. O preço é não conseguir regerar fatos de commits antigos se o
vocabulário melhorar; daria para rebuscar no GitHub. Vale o troco: é a
diferença entre um vazamento do banco expor metadados ou expor o trabalho
inteiro de duas pessoas.

**Não existe coluna com o nome real do repositório.** Guardamos o id numérico
do GitHub e um alias nosso; o nome é buscado na API quando precisa.

Outras decisões: `UNIQUE(user_id, sha)` em `commits` é o que torna re-executar
o workflow seguro; `user_emails.email` é único globalmente para o mesmo commit
não virar post de dois donos; e a coluna do token do LinkedIn se chama
`access_token_encrypted` porque o nome é a barreira mais barata contra alguém
gravar em claro a credencial que publica no perfil de outra pessoa.

Duas restrições vieram da Fase 1.5: `github_installations` é única por
`(user_id, installation_id)`, e não por `installation_id`, porque dois devs da
mesma organização enxergam a **mesma** instalação e cada um precisa da própria
linha — fosse única pelo id, o segundo login roubaria a instalação do primeiro
e ele pararia de coletar sem aviso. E `users.telegram_chat_id` é único, porque
uma conta do Telegram é de uma pessoa só e um chat apontando para dois devs
mandaria os posts de um para o outro aprovar.

```bash
npm run db:generate --workspace @commitpost/core   # schema.ts -> SQL
npm run db:migrate  --workspace @commitpost/core   # aplica no Neon
npm run db:studio   --workspace @commitpost/core   # inspeção
```

Os testes de `src/db/db.test.ts` rodam contra o banco real e se pulam sozinhos
quando `DATABASE_URL` não está no ambiente — é o caso do CI. Eles verificam as
restrições que sustentam as decisões acima, não que o ORM funciona.

**Sobre o `npm audit`:** o `drizzle-kit` arrasta um `esbuild` com advisory
moderado. É ferramenta de linha de comando que só gera SQL localmente; o
advisory é sobre o *dev server* do esbuild, que nunca sobe aqui. O
`audit fix --force` rebaixaria o drizzle-kit para uma versão incompatível com
o ORM. Aceito conscientemente.

## Credenciais do GitHub: dois caminhos, de propósito

**GitHub App** é o principal. Serve de login, e a instalação dá acesso aos
repositórios da conta onde foi instalada. Os tokens são gerados na hora a
partir da chave privada e expiram em uma hora, então nenhuma credencial de dev
fica armazenada — por isso `github_installations` não tem coluna de token.

**OAuth App clássico** é opcional e existe por uma limitação que não tem volta:
a instalação de um GitHub App só enxerga repos da conta onde foi instalada, e o
*user access token* dele continua preso às instalações. Repositório onde o dev
é apenas colaborador, de outra pessoa, é inalcançável — e é onde mora boa parte
do trabalho de muita gente.

O preço do OAuth clássico: `repo` é leitura **e escrita**, porque não existe
escopo somente-leitura para repositório privado. Daí as três regras:

1. a concessão é **opt-in por dev**, num passo separado da tela de introdução,
   com o alcance explicado em português claro;
2. o token vai **cifrado** para o banco (`packages/core/src/crypto.ts`);
3. o sistema **nunca** chama endpoint de escrita do GitHub. Se algum dia
   precisar, isso é uma decisão a ser tomada de novo, não uma extensão óbvia.

Quando os repos são de uma **organização**, o caminho limpo é um admin instalar
o App na org — cobre todos de uma vez e dispensa o OAuth.

## A coleta

`packages/core/src/github/collect.ts` é a borda: do lado de fora existem
strings como `src/clients/acme-corp/faturamento.ts`; do lado de dentro só
existe `ts`. A redução acontece **na entrada**, e não mais adiante, porque o
que a camada de cima nunca recebe ela nunca vaza.

**`fileExtensionsOf` é a função mais crítica desta camada** e a única do
projeto com redundância deliberada: a separação do caminho e o teste
`[a-z0-9]+` cobrem o mesmo caso. A mutação que remove só a separação sobrevive
— está documentado no próprio arquivo para ninguém "limpar" isso. Aqui um furo
não devolve resultado errado, devolve o caminho de um cliente.

O e-mail de autor é conferido **duas vezes**: o parâmetro `author` da API
reduz o tráfego, e a checagem local garante o resultado. A API aceita login OU
e-mail no mesmo parâmetro, e um login que coincida traria commit alheio — que
viraria post no nome de quem não o escreveu.

Os **nomes reais** dos repositórios entram na denylist em memória, durante a
coleta, e não são gravados por isso: é o nome real que aparece numa mensagem
(`merge branch x into faturamento-clientey`), não o nosso alias. É a resposta
ao aviso que estava em `FilterOptions.deniedTerms` desde a Fase 3.

`repos.active` existe porque a concessão de colaboração é tudo-ou-nada: ela
alcança todos os repositórios de uma vez, e sem esta coluna "não quero que este
vire post" não teria resposta. Repositório desligado nem chega a ser
consultado. O alias começa como `repo-3` e é editável — qualquer padrão
derivado do nome real seria o nome real com um disfarce.

Uma execução varre todos os devs ativos, e cada um é independente: quem falha
vira aviso. Uma instalação suspensa de uma pessoa não é motivo para a outra
ficar sem post. HTTP 409 é repositório **vazio**, não falha — tratá-lo como
erro enchia o log de aviso para uma situação normal, e aviso que sempre aparece
é aviso que ninguém lê.

## A geração

`packages/core/src/llm/` recebe `TechnicalFact[]` e nada mais. Isso não é
disciplina de quem chama, é o tipo — e por isso **vazamento não é o risco aqui**.
O modelo nunca viu um nome de cliente.

**O risco é invenção.** Com "bugfix, cache, lentidão" como matéria-prima, a
tentação de qualquer modelo é preencher o vazio: *"trabalhando num sistema
bancário de alto volume..."*. Nada disso veio dos dados, e uma frase dessas é ao
mesmo tempo mentira e a forma exata de um vazamento. Daí a REGRA 1 do prompt ser
a mais longa, e daí o modelo poder devolver **zero** candidatos com um motivo.
Um post a menos não custa nada.

`buildUserPrompt` é público e puro porque é o que atravessa a rede: dá para
testar que os **shas não vão ao modelo** (só a contagem) e que campo nulo é
omitido em vez de virar a palavra `null`, que o modelo trataria como informação.

Candidato que a barreira 2 suja é **descartado**, nunca publicado com
`[removido]`: se um termo proibido chegou à saída, o texto inteiro perdeu a
credibilidade, e publicar a versão censurada seria confiar no resto de um texto
que já provou não ser confiável.

`npm run pipeline -- --ensaio` gera e mostra sem gravar nada. Existe porque a
dedução de "commit novo" é o índice único: depois da primeira execução não sobra
nada para experimentar, e a alternativa seria apagar linhas do banco de alguém.

## Login, sessão e a tela de introdução

A tela de introdução (`apps/web/app/onboarding`) existe por uma decisão de
produto: **nada que um dev precise configurar deve morar num arquivo de
instruções**. Cada passo é derivado do banco e fica verde porque a linha
existe, não porque alguém marcou uma caixa. `docs/setup-operador.md` cobre só o
que um aplicativo não pode fazer por si — criar as contas de plataforma antes
de existir.

**Só é passo o que impede o sistema de funcionar:** GitHub (instalação **e**
e-mails de autor, juntos, porque vêm da mesma conta e um sem o outro coleta
zero commits) e Telegram. Colaborações e LinkedIn são opcionais e ficam
intercalados na ordem das credenciais, não da criticidade — por isso `next`
procura primeiro um obrigatório pendente, já que um opcional vem antes do
Telegram na lista.

**A denylist não é passo.** Ela é proposta sozinha a cada conexão e fica num
bloco de ajuste embaixo. Ela não é a barreira contra vazamento — quem impede é
o vocabulário fechado, que não copia texto de commit para a saída. Exigi-la
alongava o onboarding sem proteger nada a mais, e o que a tela precisa deixar
claro é o contrário do que parecia: **esta lista não decide quais repositórios
são lidos, decide o que jamais é escrito.**

Quatro decisões que sustentam isso:

**Nenhum token de usuário do GitHub é guardado.** O do login vive dentro da
requisição do callback e some. Descobrir uma instalação nova é, por isso, uma
ida e volta pelo login — que é o que o botão "Já instalei, atualizar" faz. O
preço é um redirecionamento a mais; o troco é não guardar credencial de acesso
ao código de ninguém, nem depender de *Setup URL* configurada no App.

**A sessão é uma linha no banco, e o cookie guarda só o segredo.** A tabela
guarda o SHA-256. Assim dá para revogar o acesso de uma pessoa apagando a
linha, sem trocar o segredo de todo mundo — e um dump de `sessions` não permite
se passar por ninguém. `active = false` derruba as sessões abertas na
requisição seguinte, sem caçá-las.

**O `state` do OAuth é assinado E amarrado a um cookie.** As duas coisas
respondem a perguntas diferentes: a assinatura prova que o `state` saiu daqui,
o cookie prova que saiu **deste navegador**. Só a primeira não bastaria —
qualquer um pode abrir nossa rota de login, receber um `state` válido e montar
um callback com o `code` da própria conta.

**A allowlist do Telegram saiu do ambiente e foi para o banco.** Era
`TELEGRAM_CHAT_ID`, um chat só; agora é qualquer chat em
`users.telegram_chat_id` de usuário ativo, porque é essa lista que cresce a
cada dev. A variável sobreviveu como destino de aviso do operador. A única
mensagem aceita de chat desconhecido é `/start <código>` — tem que ser, é assim
que o vínculo nasce, e o que autoriza ali é o código de uso único de 15 minutos.

## Cifra de segredos

`TOKEN_ENCRYPTION_KEY` (32 bytes em hex) cifra em AES-256-GCM os tokens de
terceiros guardados no banco: o do LinkedIn, que publica no perfil de outra
pessoa, e o OAuth do GitHub com escopo `repo`.

O que isso protege é especificamente o cenário de dump do banco. Quem tiver o
ambiente da aplicação inteiro tem a chave também, e nada aqui muda isso.

**Trocar a chave torna ilegível tudo que foi cifrado com a antiga** — na
prática, todo dev precisa reautorizar GitHub e LinkedIn. Não há rotação
automática; o prefixo `v1.` no formato existe para permitir migração futura.

## O filtro de confidencialidade

`packages/core/src/redact/` é a parte mais crítica do sistema. A decisão de
desenho que sustenta tudo:

**Todo campo do `TechnicalFact` vem de um vocabulário fechado.** `changeKind`
é um enum; `technologies`, `problemClass` e `outcome` só podem conter rótulos
declarados em `vocabulary.ts`. Nenhum pedaço de texto do commit é copiado para
a saída — nem sanitizado, nem truncado. O commit só serve para DECIDIR quais
rótulos se aplicam.

Isso troca uma garantia frágil por uma estrutural: não é que os nomes de
cliente sejam filtrados, é que eles não têm por onde sair. A higienização em
`sanitize.ts` continua existindo, mas como defesa em profundidade — o papel
dela é impedir que um termo do vocabulário seja colhido de dentro de um trecho
sensível (`redis.cliente-x.internal` não deve render a tecnologia "Redis").

**Ao editar `vocabulary.ts`:** adicionar um termo é decisão de segurança, não
de conveniência. Só entram termos públicos e genéricos.

**Ao editar os testes:** validá-los por mutação, não por cobertura. Um teste
que afirma sobre a saída de `extractTechnicalFacts` frequentemente não testa
nada — o vocabulário fechado já bloquearia o vazamento sozinho, então o teste
passa com a lógica quebrada. Foi assim que três testes inúteis foram
descobertos e reescritos. Quebre a função de propósito e confirme que algum
teste fica vermelho.

## Stack

- **Monorepo:** Turborepo + npm workspaces
- **Linguagem:** TypeScript, ESM, `strict` + `noUncheckedIndexedAccess`
- **Web:** Next.js (App Router) na Vercel
- **Banco:** Postgres no Neon, via **Drizzle** (escolhido sobre Prisma: sem
  engine binário, o que importa no runner e em serverless)
- **LLM:** `claude-opus-5` via `@anthropic-ai/sdk`, com structured outputs
- **Testes:** Vitest

`packages/core` é consumido como TypeScript direto, sem passo de build —
`transpilePackages` no Next e `tsx` no pipeline.

## Comandos

```bash
npm install          # instala o workspace inteiro
npm run typecheck    # tsc em todos os pacotes
npm test             # vitest
npm run pipeline     # roda o pipeline localmente (precisa de .env.local)
npm run pipeline -- --ensaio   # mostra o que sairia, sem gravar nada
npm run dev          # sobe o Next em apps/web
```

## Convenções

- Comentários e mensagens de commit em português.
- **Import relativo sem extensão** (`./crypto`, não `./crypto.js`). O Turbopack
  não mapeia `.js` para `.ts` dentro de `transpilePackages`, e como
  `packages/core` é consumido como TypeScript direto — sem passo de build — a
  extensão `.js` só serviria a um arquivo que nunca existe.
- Nada de segredo em código; env é validada no boot por `packages/core/env.ts`,
  que falha listando **todas** as variáveis faltantes de uma vez.
- Toda mudança em `packages/core/redact` exige teste. É a parte mais crítica
  do sistema.

## Deploy na Vercel

Root Directory do projeto = `apps/web`. O Turborepo é detectado
automaticamente. O `apps/pipeline` não é deployado — ele só roda no Actions.
