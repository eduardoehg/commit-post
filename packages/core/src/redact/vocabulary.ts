/**
 * Vocabulários fechados.
 *
 * Este arquivo é a fronteira do que pode ser publicado. Um termo que não está
 * aqui não tem caminho para a saída — não porque alguma regex o remova, mas
 * porque nada além destas listas é copiado para o `TechnicalFact`.
 *
 * Consequência prática ao editar: adicionar um termo aqui é uma decisão de
 * segurança, não de conveniência. Só entram termos públicos e genéricos —
 * tecnologias que qualquer pessoa fora da empresa reconhece. Nome de produto
 * interno, de cliente ou de serviço próprio NUNCA entra, mesmo que apareça em
 * todo commit.
 */

/** Minúsculas e sem acentos, para comparar "Autenticação" com "autenticacao". */
export function normalize(term: string): string {
  return term
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** `[rótulo canônico, ...formas alternativas]`. O rótulo também casa consigo. */
type Entry = readonly [string, ...string[]];

/**
 * Tecnologias e conceitos técnicos públicos.
 *
 * Conceitos ("cache", "fila", "webhook") importam mais que nomes de produto
 * para o objetivo do sistema: o post é para público leigo, então "resolvi um
 * problema de cache" comunica, "atualizei o Redis" não.
 */
const TECHNOLOGY_ENTRIES: readonly Entry[] = [
  // --- Linguagens ---
  ["TypeScript", "typescript", "ts"],
  ["JavaScript", "javascript", "js"],
  ["Python", "python", "py"],
  ["Java", "java"],
  ["Kotlin", "kotlin"],
  ["Swift", "swift"],
  ["Go", "go", "golang"],
  ["Rust", "rust"],
  ["Ruby", "ruby"],
  ["PHP", "php"],
  ["C#", "csharp", "c#"],
  ["SQL", "sql"],
  ["Shell", "shell", "bash", "shellscript"],

  // --- Runtimes e frameworks de servidor ---
  ["Node", "node", "nodejs"],
  ["Deno", "deno"],
  ["Bun", "bun"],
  ["Express", "express"],
  ["Fastify", "fastify"],
  ["NestJS", "nest", "nestjs"],
  ["Django", "django"],
  ["Flask", "flask"],
  ["FastAPI", "fastapi"],
  ["Rails", "rails"],
  ["Laravel", "laravel"],
  ["Spring", "spring", "springboot"],
  ["dotNET", "dotnet", "aspnet"],

  // --- Frontend ---
  ["React", "react"],
  ["Next.js", "nextjs"],
  ["Vue", "vue", "vuejs"],
  ["Nuxt", "nuxt", "nuxtjs"],
  ["Angular", "angular"],
  ["Svelte", "svelte", "sveltekit"],
  ["Astro", "astro"],
  ["Tailwind", "tailwind", "tailwindcss"],
  ["CSS", "css"],
  ["HTML", "html"],
  ["React Native", "react native", "reactnative"],
  ["Flutter", "flutter"],

  // --- Bancos de dados ---
  ["Postgres", "postgres", "postgresql", "pg"],
  ["MySQL", "mysql", "mariadb"],
  ["SQLite", "sqlite"],
  ["MongoDB", "mongo", "mongodb"],
  ["Redis", "redis"],
  ["Elasticsearch", "elasticsearch", "elastic", "opensearch"],
  ["DynamoDB", "dynamo", "dynamodb"],
  ["ClickHouse", "clickhouse"],

  // --- Infraestrutura e nuvem ---
  ["Docker", "docker", "container", "containers", "conteiner"],
  ["Kubernetes", "kubernetes", "k8s"],
  ["Terraform", "terraform"],
  ["AWS", "aws"],
  ["Google Cloud", "gcp", "google cloud"],
  ["Azure", "azure"],
  ["Vercel", "vercel"],
  ["Cloudflare", "cloudflare"],
  ["Nginx", "nginx"],
  ["Serverless", "serverless", "lambda", "edge function"],

  // --- Ferramentas ---
  ["Git", "git"],
  ["GitHub Actions", "github actions", "gh actions"],
  ["CI/CD", "ci", "cd", "cicd", "ci/cd", "pipeline", "esteira"],
  ["Vite", "vite"],
  ["Webpack", "webpack"],
  ["ESLint", "eslint", "lint", "linter"],
  ["Prettier", "prettier"],
  ["Jest", "jest"],
  ["Vitest", "vitest"],
  ["Playwright", "playwright"],
  ["Cypress", "cypress"],
  ["Storybook", "storybook"],
  ["Prisma", "prisma"],
  ["Drizzle", "drizzle"],
  ["Turborepo", "turborepo", "turbo"],
  ["Monorepo", "monorepo"],

  // --- Protocolos e formatos ---
  ["API", "api", "apis"],
  ["REST", "rest", "restful"],
  ["GraphQL", "graphql"],
  ["gRPC", "grpc"],
  ["WebSocket", "websocket", "websockets"],
  ["Webhook", "webhook", "webhooks"],
  ["JSON", "json"],
  ["CSV", "csv"],
  ["XML", "xml"],
  ["PDF", "pdf"],
  ["HTTP", "http", "https"],
  ["SSE", "sse", "server-sent events"],

  // --- Conceitos: dados ---
  ["cache", "cache", "caching", "memoization", "memoizacao"],
  ["fila", "fila", "queue", "filas", "message queue"],
  ["índice de banco", "indice", "index", "indexacao", "indices"],
  ["migração de banco", "migration", "migrations", "migracao"],
  ["transação", "transacao", "transaction", "transacoes"],
  ["paginação", "paginacao", "pagination", "paginado"],
  ["backup", "backup", "backups"],
  ["ETL", "etl", "pipeline de dados"],
  ["streaming", "streaming", "stream"],

  // --- Conceitos: aplicação ---
  ["autenticação", "autenticacao", "auth", "authentication", "login"],
  ["autorização", "autorizacao", "authorization", "permissoes", "permissions", "rbac"],
  ["OAuth", "oauth", "oauth2", "openid"],
  ["JWT", "jwt", "token de acesso"],
  ["criptografia", "criptografia", "encryption", "hashing", "hash"],
  ["validação", "validacao", "validation", "schema validation"],
  ["tratamento de erro", "error handling", "tratamento de erro", "try catch"],
  ["retry", "retry", "retentativa", "backoff"],
  ["idempotência", "idempotencia", "idempotent", "idempotente"],
  ["feature flag", "feature flag", "feature toggle"],
  ["internacionalização", "i18n", "internacionalizacao", "localizacao", "l10n"],
  ["acessibilidade", "acessibilidade", "a11y", "accessibility"],

  // --- Conceitos: operação ---
  ["deploy", "deploy", "deployment", "publicacao"],
  ["observabilidade", "observabilidade", "observability", "telemetria", "telemetry"],
  ["log", "log", "logs", "logging"],
  ["métrica", "metrica", "metricas", "metrics"],
  ["monitoramento", "monitoramento", "monitoring", "alerta", "alerting"],
  ["teste automatizado", "teste", "testes", "test", "tests", "testing"],
  ["teste de integração", "teste de integracao", "integration test", "e2e"],
  ["refatoração", "refatoracao", "refactor", "refactoring"],
  ["tipagem", "tipagem", "typing", "type safety", "tipos"],
  ["documentação", "documentacao", "docs", "documentation", "readme"],
  ["automação", "automacao", "automation", "automatizacao"],
  ["LLM", "llm", "ia", "ai", "inteligencia artificial", "modelo de linguagem"],
];

/**
 * Classes de problema. Fechado pelo mesmo motivo: "qual era o problema" é
 * exatamente o campo onde texto livre vazaria contexto de negócio.
 */
const PROBLEM_ENTRIES: readonly Entry[] = [
  ["condição de corrida", "race condition", "condicao de corrida", "corrida"],
  ["vazamento de memória", "memory leak", "vazamento de memoria", "memleak"],
  ["estouro de memória", "out of memory", "oom", "estouro de memoria"],
  ["consulta N+1", "n+1", "n + 1", "consulta n+1"],
  ["invalidação de cache", "cache invalidation", "invalidacao de cache", "cache stale"],
  ["deadlock", "deadlock", "impasse", "travamento"],
  ["timeout", "timeout", "tempo limite", "tempo esgotado"],
  ["limite de requisições", "rate limit", "rate limiting", "throttling", "limite de requisicoes"],
  ["teste instável", "flaky", "flaky test", "teste instavel", "teste intermitente"],
  ["regressão", "regressao", "regression"],
  ["fuso horário", "timezone", "fuso horario", "utc offset"],
  ["codificação de caracteres", "encoding", "charset", "utf-8", "acentuacao"],
  ["duplicidade de dados", "duplicata", "duplicate", "duplicidade", "deduplicacao"],
  ["erro de arredondamento", "rounding", "arredondamento", "ponto flutuante"],
  ["conexão instável", "connection reset", "conexao perdida", "conexao instavel"],
  ["dependência circular", "circular dependency", "dependencia circular"],
  ["gargalo de desempenho", "gargalo", "bottleneck", "lentidao", "consulta lenta"],
];

/**
 * Resultados. Também fechado — o "e daí?" do post sai daqui, não da mensagem.
 * A ordem importa: o primeiro que casar é o escolhido, então os mais
 * específicos vêm antes.
 */
const OUTCOME_ENTRIES: readonly Entry[] = [
  ["mais segurança", "seguranca", "security", "vulnerabilidade", "sanitiza", "criptografa", "cve"],
  ["melhora de desempenho", "performance", "desempenho", "mais rapido", "otimiza", "otimizacao", "acelera", "speed up", "faster", "reduz tempo"],
  ["mais confiabilidade", "confiabilidade", "estabilidade", "resiliente", "robusto", "fallback", "estabiliza", "reliability"],
  ["menos custo", "custo", "cost", "economiza", "reduz custo", "mais barato"],
  ["melhor experiência", "usabilidade", "experiencia do usuario", "ux", "mais claro", "mais simples de usar"],
  ["menos código", "remove codigo", "simplifica", "menos codigo", "limpeza", "dead code", "deleta"],
];

export interface Vocabulary {
  /** forma normalizada → rótulo canônico */
  readonly lookup: ReadonlyMap<string, string>;
  /** rótulos canônicos, para testes e diagnóstico */
  readonly labels: readonly string[];
  /** ordem de declaração dos rótulos, para desempate determinístico */
  readonly rank: ReadonlyMap<string, number>;
}

/**
 * Monta o índice de busca e recusa aliases duplicados.
 *
 * Um alias em duas entradas seria um bug silencioso — o termo passaria a
 * resolver para o rótulo de quem foi declarado por último, e ninguém
 * perceberia. Melhor quebrar na carga do módulo.
 */
function buildVocabulary(entries: readonly Entry[], name: string): Vocabulary {
  const lookup = new Map<string, string>();
  const rank = new Map<string, number>();
  const labels: string[] = [];

  entries.forEach(([canonical, ...aliases], position) => {
    labels.push(canonical);
    rank.set(canonical, position);

    for (const alias of [canonical, ...aliases]) {
      const key = normalize(alias);
      const existing = lookup.get(key);
      if (existing !== undefined && existing !== canonical) {
        throw new Error(
          `Vocabulário "${name}": o alias "${alias}" já está em uso por "${existing}" e foi redeclarado em "${canonical}".`,
        );
      }
      lookup.set(key, canonical);
    }
  });

  return { lookup, labels, rank };
}

export const TECHNOLOGIES = buildVocabulary(TECHNOLOGY_ENTRIES, "tecnologias");
export const PROBLEM_CLASSES = buildVocabulary(PROBLEM_ENTRIES, "classes de problema");
export const OUTCOMES = buildVocabulary(OUTCOME_ENTRIES, "resultados");

/**
 * Nomes com ponto são reescritos antes da higienização.
 *
 * Sem isso "Node.js" seria comido pelo detector de domínios (termina em ".js",
 * indistinguível de um host) e a tecnologia se perderia. Reescrever para a
 * forma sem ponto preserva o termo e mantém o detector agressivo.
 */
const DOTTED_REWRITES: readonly (readonly [RegExp, string])[] = [
  [/\bnode\.js\b/gi, "nodejs"],
  [/\bnext\.js\b/gi, "nextjs"],
  [/\bnuxt\.js\b/gi, "nuxtjs"],
  [/\bvue\.js\b/gi, "vuejs"],
  [/\bsocket\.io\b/gi, "websocket"],
  [/\basp\.net\b/gi, "aspnet"],
  [/(?<![\w.])\.net\b/gi, "dotnet"],
  [/\bci\/cd\b/gi, "cicd"],
];

export function rewriteDottedTerms(text: string): string {
  let out = text;
  for (const [pattern, replacement] of DOTTED_REWRITES) out = out.replace(pattern, replacement);
  return out;
}

/** Escapa um termo para uso literal dentro de uma expressão regular. */
export function escapeForRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface VocabularyHit {
  readonly label: string;
  readonly count: number;
}

/**
 * Procura os termos do vocabulário no texto já higienizado.
 *
 * As bordas usam `[\w-]` em vez de `\b` porque muitos termos têm hífen
 * ("ci/cd", "utf-8") e `\b` casaria no meio deles.
 */
export function findVocabularyHits(text: string, vocabulary: Vocabulary): VocabularyHit[] {
  const haystack = normalize(text);
  const counts = new Map<string, number>();

  for (const [alias, label] of vocabulary.lookup) {
    const pattern = new RegExp(`(?<![\\w-])${escapeForRegExp(alias)}(?![\\w-])`, "g");
    const found = haystack.match(pattern);
    if (found === null) continue;
    counts.set(label, (counts.get(label) ?? 0) + found.length);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (vocabulary.rank.get(a.label) ?? 0) - (vocabulary.rank.get(b.label) ?? 0),
    );
}

/**
 * Extensão de arquivo → tecnologia.
 *
 * Extensões são uma fonte de sinal segura: conjunto fechado, sem caminho
 * junto. E frequentemente é o único sinal disponível — muita mensagem de
 * commit ("corrige o cálculo do total") não nomeia tecnologia nenhuma.
 */
const EXTENSION_ENTRIES: readonly (readonly [string, string])[] = [
  ["ts", "TypeScript"], ["mts", "TypeScript"], ["cts", "TypeScript"],
  ["tsx", "React"], ["jsx", "React"],
  ["js", "JavaScript"], ["mjs", "JavaScript"], ["cjs", "JavaScript"],
  ["py", "Python"],
  ["java", "Java"], ["kt", "Kotlin"], ["swift", "Swift"],
  ["go", "Go"], ["rs", "Rust"], ["rb", "Ruby"], ["php", "PHP"], ["cs", "C#"],
  ["sql", "SQL"],
  ["sh", "Shell"], ["bash", "Shell"], ["zsh", "Shell"],
  ["css", "CSS"], ["scss", "CSS"], ["sass", "CSS"], ["less", "CSS"],
  ["html", "HTML"], ["htm", "HTML"],
  ["vue", "Vue"], ["svelte", "Svelte"], ["astro", "Astro"],
  ["json", "JSON"], ["csv", "CSV"], ["xml", "XML"],
  ["md", "documentação"], ["mdx", "documentação"],
  ["tf", "Terraform"],
  ["dockerfile", "Docker"],
  ["prisma", "Prisma"],
];

/**
 * Recusa na carga do módulo um rótulo que não exista no vocabulário de
 * tecnologias — senão uma extensão poderia injetar um rótulo que nunca passou
 * pela revisão da allowlist, que é exatamente o furo que este arquivo existe
 * para não ter.
 */
function buildExtensionMap(): ReadonlyMap<string, string> {
  const known = new Set(TECHNOLOGIES.labels);
  const map = new Map<string, string>();

  for (const [extension, label] of EXTENSION_ENTRIES) {
    if (!known.has(label)) {
      throw new Error(
        `Extensão ".${extension}" aponta para "${label}", que não é um rótulo do vocabulário de tecnologias.`,
      );
    }
    map.set(normalize(extension), label);
  }

  return map;
}

export const EXTENSION_TECHNOLOGY = buildExtensionMap();

/**
 * Termos legítimos que os detectores de domínio e de caminho comeriam.
 *
 * "Node.js" é indistinguível de um host e "CI/CD" de um caminho de arquivo.
 * Na barreira 2 isso seria um falso positivo caro: descartaria um post bom
 * porque o modelo escreveu corretamente o nome de uma tecnologia.
 */
export const PROTECTED_LITERALS: readonly string[] = [
  "Node.js", "Next.js", "Nuxt.js", "Vue.js", "Socket.io", "ASP.NET", ".NET", "CI/CD",
];
