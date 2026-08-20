# CommitPost

Transforma commits do GitHub em posts para o LinkedIn, com aprovação humana
via Telegram antes de publicar.

O foco de cada post é **exclusivamente a solução técnica** — nunca o cliente,
a empresa ou o projeto de origem.

```
commits → filtro de confidencialidade → Claude → Telegram → você aprova → LinkedIn
```

## Estrutura

```
apps/web        Next.js na Vercel — webhook do Telegram, painel, OAuth
apps/pipeline   entrypoint do pipeline, roda no runner do GitHub Actions
packages/core   db, github, llm, telegram, linkedin, redact, env
```

## Começando

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm test
```

Ver `CLAUDE.md` para arquitetura, decisões de projeto e ordem das fases.
