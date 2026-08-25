/**
 * Os passos da tela de introdução.
 *
 * Isto aqui é o que substitui um arquivo de instruções: em vez de o dev ler um
 * `.md` e sair configurando à mão, cada passo é derivado do estado real do
 * banco e sabe dizer sozinho se já foi feito. Um passo só fica verde porque a
 * linha existe — não porque alguém marcou uma caixa.
 *
 * A função é pura de propósito. Quem lê o banco é a página; o que decide o que
 * está pronto é testável sem banco nenhum.
 */

export type StepId = "github" | "collaborations" | "telegram" | "linkedin";

// ---------------------------------------------------------------------------
// Proposta de denylist
// ---------------------------------------------------------------------------

export interface RepoIdentity {
  name: string;
  /** Login da conta dona. Vazio quando o GitHub não devolveu. */
  owner: string;
}

/**
 * Os nomes que devem virar termo proibido, a partir do que o GitHub expõe.
 *
 * Isto é o coração da parte mais frágil do sistema: pedir que uma pessoa
 * *lembre* de todo nome de cliente é onde o processo quebra, e é justamente o
 * que não pode falhar. Por isso a lista é proposta, não perguntada.
 *
 * Duas regras, e as duas importam:
 *
 *   - **O login do próprio dev nunca entra.** É a identidade pública dele, não
 *     nome de cliente, e censurá-la dos posts não protegeria nada — só faria o
 *     texto perder o autor.
 *   - **O dono do repositório entra junto com o nome dele.** Em
 *     `acme-corp/portal`, é `acme-corp` que identifica o empregador; o nome do
 *     repositório sozinho costuma ser genérico demais para denunciar alguém, e
 *     genérico demais para proteger.
 *
 * Duplicatas somem, e a ordem é estável para a tela não dançar a cada carga.
 */
export function proposeDeniedTerms(
  repos: readonly RepoIdentity[],
  accounts: readonly string[],
  viewerLogin: string,
): string[] {
  const meu = viewerLogin.trim().toLowerCase();
  const vistos = new Set<string>();
  const saida: string[] = [];

  const considerar = (bruto: string, ehDoDono: boolean): void => {
    const termo = bruto.trim();
    if (termo === "") return;

    const chave = termo.toLowerCase();
    // O nome do REPOSITÓRIO entra mesmo coincidindo com o login do dev: um
    // repo chamado como a pessoa continua sendo um nome a esconder. O que não
    // entra é a pessoa aparecendo como DONA de alguma coisa.
    if (ehDoDono && chave === meu) return;
    if (vistos.has(chave)) return;

    vistos.add(chave);
    saida.push(termo);
  };

  for (const conta of accounts) considerar(conta, true);
  for (const repo of repos) {
    considerar(repo.name, false);
    considerar(repo.owner, true);
  }

  return saida;
}

export interface OnboardingState {
  /** Instalações do GitHub App vinculadas a este dev. */
  installationCount: number;
  /**
   * E-mails de autor. Entra no mesmo passo das instalações porque vem da mesma
   * fonte — a conta do GitHub — e separá-los fazia o dev se perguntar o que um
   * tinha a ver com o outro.
   */
  emailCount: number;
  telegramLinked: boolean;
  hasCollaborationGrant: boolean;
  hasLinkedIn: boolean;
  /** Falso quando o operador não configurou o OAuth App clássico. */
  collaborationsAvailable: boolean;
  /** Falso até o app do LinkedIn sair da fila de aprovação (Fase 7). */
  linkedInAvailable: boolean;
}

export interface OnboardingStep {
  id: StepId;
  title: string;
  /** Uma frase sobre o que o passo resolve, não sobre o que ele faz. */
  summary: string;
  done: boolean;
  required: boolean;
  /** Falso quando falta configuração do operador — o passo aparece cinza. */
  available: boolean;
}

export interface OnboardingSummary {
  steps: OnboardingStep[];
  /** Todos os passos obrigatórios cumpridos: o dev entra no próximo ciclo. */
  ready: boolean;
  /** O que a tela deve destacar. Null quando não sobrou nada a fazer. */
  next: StepId | null;
  /**
   * Problemas que NÃO impedem o dev de configurar, mas fazem o sistema
   * trabalhar em vão.
   *
   * Existem porque nem todo defeito é um passo. Os e-mails de autor, por
   * exemplo, chegam sozinhos do GitHub e quase nunca precisam de atenção —
   * virar um passo obrigatório por causa da exceção fazia todo mundo pagar
   * pelo caso raro. Mas se a lista estiver vazia, a coleta varre tudo e
   * reconhece zero commits, e isso não pode acontecer em silêncio.
   */
  avisos: string[];
}

/**
 * A ordem segue as fontes de credencial, não a criticidade.
 *
 * Os dois passos de GitHub ficam juntos e primeiro — o opcional logo depois do
 * obrigatório — porque quem está decidindo sobre acesso ao código decide as
 * duas coisas de uma vez. Telegram e LinkedIn vêm depois porque são outra
 * conversa.
 *
 * Repare que a denylist não é passo. Ela é proposta automaticamente no login e
 * na concessão de colaborações, e fica disponível para ajuste — mas não segura
 * ninguém, porque não é ela que impede vazamento. O que impede é o vocabulário
 * fechado: nenhum texto de commit chega à saída, então nome de cliente não tem
 * por onde sair mesmo com a lista vazia. Ver `redact/`.
 */
export function computeOnboarding(state: OnboardingState): OnboardingSummary {
  const steps: OnboardingStep[] = [
    {
      id: "github",
      title: "Conectar o GitHub",
      summary:
        "Instale o CommitPost nas contas cujos repositórios devem virar post. " +
        "O acesso é de leitura e expira em uma hora a cada uso.",
      // Só a instalação. Os e-mails de autor eram exigidos aqui e saíram: eles
      // chegam sozinhos do GitHub no login, e pedir confirmação de algo que já
      // está certo fazia o passo parecer duas tarefas em vez de uma. Quando
      // falham, viram aviso — ver `avisos`.
      done: state.installationCount > 0,
      required: true,
      available: true,
    },
    {
      id: "collaborations",
      title: "Incluir repositórios de colaboração",
      summary:
        "Opcional. Só se você commita em repositórios de outras pessoas, " +
        "que a instalação do App não alcança.",
      done: state.hasCollaborationGrant,
      required: false,
      available: state.collaborationsAvailable,
    },
    {
      id: "telegram",
      title: "Receber os posts no Telegram",
      summary: "É por onde você aprova ou recusa. Sem isso, nada é publicado.",
      done: state.telegramLinked,
      required: true,
      available: true,
    },
    {
      id: "linkedin",
      title: "Conectar o LinkedIn",
      summary:
        "Opcional. Sem ele, o post aprovado chega pronto no Telegram para " +
        "você copiar e publicar.",
      done: state.hasLinkedIn,
      required: false,
      available: state.linkedInAvailable,
    },
  ];

  const ready = steps.every((s) => s.done || !s.required);

  // O obrigatório pendente ganha do opcional mesmo vindo depois na lista — e
  // aqui isso é o caso: colaborações é opcional e está antes do Telegram. Sem
  // esta primeira busca, o destaque cairia no passo que não segura ninguém.
  const next =
    steps.find((s) => s.required && !s.done)?.id ??
    steps.find((s) => !s.done && s.available)?.id ??
    null;

  const avisos: string[] = [];

  // Só depois de conectar: cobrar e-mail de autor de quem nem instalou o App
  // seria reclamar da segunda etapa antes da primeira.
  if (state.installationCount > 0 && state.emailCount === 0) {
    avisos.push(
      "Nenhum e-mail de autor cadastrado — a coleta roda e não reconhece nenhum commit como seu.",
    );
  }

  return { steps, ready, next, avisos };
}
