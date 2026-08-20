import { describe, expect, it } from "vitest";
import { computeOnboarding, type OnboardingState, type StepId } from "./onboarding";

const ZERADO: OnboardingState = {
  installationCount: 0,
  emailCount: 0,
  deniedTermCount: 0,
  denylistAcknowledged: false,
  telegramLinked: false,
  hasCollaborationGrant: false,
  hasLinkedIn: false,
  collaborationsAvailable: true,
  linkedInAvailable: false,
};

const COMPLETO: OnboardingState = {
  ...ZERADO,
  installationCount: 1,
  emailCount: 2,
  deniedTermCount: 3,
  telegramLinked: true,
};

function feito(state: OnboardingState, id: StepId): boolean {
  const step = computeOnboarding(state).steps.find((s) => s.id === id);
  if (step === undefined) throw new Error(`passo ${id} sumiu`);
  return step.done;
}

describe("computeOnboarding", () => {
  it("não libera ninguém com tudo zerado", () => {
    const { ready, next } = computeOnboarding(ZERADO);
    expect(ready).toBe(false);
    expect(next).toBe("github");
  });

  it("libera quando os quatro obrigatórios estão cumpridos", () => {
    expect(computeOnboarding(COMPLETO).ready).toBe(true);
  });

  it.each([
    ["installationCount", { installationCount: 0 }],
    ["emailCount", { emailCount: 0 }],
    ["denylist", { deniedTermCount: 0 }],
    ["telegram", { telegramLinked: false }],
  ] as const)("segura o dev quando falta %s", (_nome, falta) => {
    expect(computeOnboarding({ ...COMPLETO, ...falta }).ready).toBe(false);
  });

  it("aceita denylist vazia quando o dev declara que é de propósito", () => {
    const semNada = { ...COMPLETO, deniedTermCount: 0 };
    expect(computeOnboarding(semNada).ready).toBe(false);
    expect(computeOnboarding({ ...semNada, denylistAcknowledged: true }).ready).toBe(true);
  });

  it("conta a denylist como pronta por qualquer um dos dois caminhos", () => {
    expect(feito({ ...ZERADO, deniedTermCount: 1 }, "denylist")).toBe(true);
    expect(feito({ ...ZERADO, denylistAcknowledged: true }, "denylist")).toBe(true);
    expect(feito(ZERADO, "denylist")).toBe(false);
  });

  it("opcional pendente não impede o dev de começar", () => {
    // Colaborações e LinkedIn ficam abertos e mesmo assim `ready` é verdadeiro:
    // é o que permite o MVP rodar sem o app do LinkedIn aprovado.
    const resultado = computeOnboarding(COMPLETO);
    expect(resultado.ready).toBe(true);
    expect(resultado.steps.find((s) => s.id === "linkedin")?.done).toBe(false);
    expect(resultado.steps.find((s) => s.id === "collaborations")?.done).toBe(false);
  });

  it("um obrigatório pendente ganha do opcional na sugestão do próximo passo", () => {
    // Colaborações vem depois na lista, mas o Telegram é que segura o dev.
    const soFaltaTelegram = { ...COMPLETO, telegramLinked: false };
    expect(computeOnboarding(soFaltaTelegram).next).toBe("telegram");
  });

  it("todo passo obrigatório vem antes de qualquer opcional", () => {
    // `next` confia nesta ordem em vez de comparar `required` na hora. Se
    // alguém inserir um opcional no meio, é aqui que fica vermelho — e não em
    // produção, com um dev sendo mandado ao LinkedIn antes da denylist.
    const { steps } = computeOnboarding(ZERADO);
    const obrigatorios = steps.flatMap((s, i) => (s.required ? [i] : []));
    const opcionais = steps.flatMap((s, i) => (s.required ? [] : [i]));

    expect(Math.min(...opcionais)).toBeGreaterThan(Math.max(...obrigatorios));
  });

  it("sugere o opcional só quando não sobrou obrigatório", () => {
    expect(computeOnboarding(COMPLETO).next).toBe("collaborations");
  });

  it("nunca sugere um passo que o operador não configurou", () => {
    const semColaboracoes = { ...COMPLETO, collaborationsAvailable: false };
    // LinkedIn também está indisponível neste estado, então não sobra nada.
    expect(computeOnboarding(semColaboracoes).next).toBeNull();
  });

  it("marca como indisponível o que depende de configuração do operador", () => {
    const { steps } = computeOnboarding({
      ...COMPLETO,
      collaborationsAvailable: false,
      linkedInAvailable: true,
    });

    expect(steps.find((s) => s.id === "collaborations")?.available).toBe(false);
    expect(steps.find((s) => s.id === "linkedin")?.available).toBe(true);
  });

  it("põe a denylist antes do Telegram", () => {
    // A ordem não é decorativa: a denylist é o único passo com consequência
    // irreversível, e o Telegram é o que dispara o primeiro post para aprovar.
    const ordem = computeOnboarding(ZERADO).steps.map((s) => s.id);
    expect(ordem.indexOf("denylist")).toBeLessThan(ordem.indexOf("telegram"));
    expect(ordem.indexOf("github")).toBe(0);
  });
});
