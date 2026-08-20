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
  ├─ POST /api/telegram/webhook   valida secret + allowlist de chat_id
  ├─ /onboarding                  tela de introdução do dev        (Fase 1.5)
  ├─ GET  /api/auth/github/*      login com GitHub + instalação    (Fase 1.5)
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
- **Fase 1.5 — login e tela de introdução.** Nova, e antes da coleta. É por
  onde cada dev conecta GitHub, Telegram, e-mails, denylist e LinkedIn.
  Sem ela não existe usuário cadastrado e nada mais roda.
- **Fase 2** — coleta, já usando o token de instalação do GitHub App.
- **Fases 4 e 5** — geração e aprovação no Telegram.
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
npm run dev          # sobe o Next em apps/web
```

## Convenções

- Comentários e mensagens de commit em português.
- Nada de segredo em código; env é validada no boot por `packages/core/env.ts`,
  que falha listando **todas** as variáveis faltantes de uma vez.
- Toda mudança em `packages/core/redact` exige teste. É a parte mais crítica
  do sistema.

## Deploy na Vercel

Root Directory do projeto = `apps/web`. O Turborepo é detectado
automaticamente. O `apps/pipeline` não é deployado — ele só roda no Actions.
