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

export type StepId = "github" | "emails" | "denylist" | "telegram" | "collaborations" | "linkedin";

export interface OnboardingState {
  /** Instalações do GitHub App vinculadas a este dev. */
  installationCount: number;
  emailCount: number;
  deniedTermCount: number;
  /** Marcado quando o dev declara, de propósito, não ter nada a esconder. */
  denylistAcknowledged: boolean;
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
}

/**
 * A ordem importa e não é arbitrária.
 *
 * O GitHub vem primeiro porque é dele que saem os e-mails verificados e os
 * nomes de repositório que viram sugestão de denylist — os dois passos
 * seguintes ficam quase automáticos por causa dele. A denylist vem antes do
 * Telegram porque é a única com consequência irreversível: um post aprovado
 * sem ela é um vazamento que já aconteceu.
 */
export function computeOnboarding(state: OnboardingState): OnboardingSummary {
  const steps: OnboardingStep[] = [
    {
      id: "github",
      title: "Conectar o GitHub",
      summary:
        "Instale o CommitPost nas contas cujos repositórios devem virar post. " +
        "O acesso é de leitura e expira em uma hora a cada uso.",
      done: state.installationCount > 0,
      required: true,
      available: true,
    },
    {
      id: "emails",
      title: "Confirmar seus e-mails de autor",
      summary:
        "É por e-mail de autor que o sistema sabe quais commits são seus. " +
        "O do trabalho costuma ser diferente do pessoal.",
      done: state.emailCount > 0,
      required: true,
      available: true,
    },
    {
      id: "denylist",
      title: "Definir o que nunca pode aparecer",
      summary:
        "Nomes de empresa, cliente, produto interno e dos repositórios. " +
        "Esta lista fica só no banco e nunca entra num post.",
      done: state.deniedTermCount > 0 || state.denylistAcknowledged,
      required: true,
      available: true,
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

  // Simplesmente o primeiro pendente que dá para fazer. Um obrigatório ganha
  // do opcional porque a lista põe todos os obrigatórios antes — invariante
  // que existe um teste para segurar, e não uma comparação a mais aqui.
  const next = steps.find((s) => !s.done && s.available)?.id ?? null;

  return { steps, ready, next };
}
