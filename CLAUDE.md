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
  ├─ GET  /post/[id]?t=<hmac>     painel de edição, link assinado  (Fase 6)
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
- **Fase 3** (filtro) **antes da Fase 2**. É o núcleo do sistema e é testável
  isoladamente com fixtures, sem tocar no GitHub. Fazer primeiro força o
  desenho de dados correto na coleta.
- **Fases 1, 2, 4, 5** — banco, coleta, geração, Telegram.
- **MVP para aqui**, com publicação manual (copiar do Telegram). Valida a
  qualidade dos posts sem depender de aprovação de app do LinkedIn.
- **Fase 6** (painel) deixa de ser opcional se o botão "✏️ Editar" existir.
- **Fase 7** (LinkedIn) quando o app estiver aprovado.

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
