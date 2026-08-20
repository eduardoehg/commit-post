import { describe, expect, it } from "vitest";
import {
  computeOnboarding,
  proposeDeniedTerms,
  type OnboardingState,
  type StepId,
} from "./onboarding";

describe("proposeDeniedTerms", () => {
  it("propõe o nome do repositório e o do dono", () => {
    // O dono é quem identifica o empregador. `portal` sozinho não denuncia
    // ninguém — e também não protege ninguém.
    expect(proposeDeniedTerms([{ name: "portal", owner: "acme-corp" }], [], "eu")).toEqual([
      "portal",
      "acme-corp",
    ]);
  });

  it("propõe a conta onde o App foi instalado", () => {
    expect(proposeDeniedTerms([], ["acme-corp"], "eu")).toEqual(["acme-corp"]);
  });

  it("nunca propõe o login do próprio dev como dono", () => {
    // Censurar a identidade pública do autor não protegeria nada; só faria o
    // texto do post perder quem o escreveu.
    const termos = proposeDeniedTerms(
      [{ name: "meu-projeto", owner: "EduardoEHG" }],
      ["eduardoehg"],
      "eduardoehg",
    );
    expect(termos).toEqual(["meu-projeto"]);
  });

  it("propõe um repositório que se chama como o dev", () => {
    // Diferente do caso acima: é nome de repositório, não a pessoa aparecendo
    // como dona de alguma coisa. Continua sendo um nome a esconder.
    expect(proposeDeniedTerms([{ name: "eduardoehg", owner: "acme" }], [], "eduardoehg")).toEqual([
      "eduardoehg",
      "acme",
    ]);
  });

  it("não repete o mesmo dono aparecendo em vários repositórios", () => {
    const termos = proposeDeniedTerms(
      [
        { name: "api", owner: "acme" },
        { name: "web", owner: "acme" },
        { name: "API", owner: "ACME" },
      ],
      [],
      "eu",
    );
    expect(termos).toEqual(["api", "acme", "web"]);
  });

  it("descarta vazio e espaço em branco", () => {
    // `owner` vem vazio quando o GitHub não devolve a conta. Um termo em
    // branco na denylist censuraria tudo.
    expect(proposeDeniedTerms([{ name: "api", owner: "" }], ["  "], "eu")).toEqual(["api"]);
  });

  it("preserva a grafia original, mesmo deduplicando sem diferenciar caixa", () => {
    // A denylist é lida por gente na tela. `ACME-Corp` precisa aparecer como
    // foi escrito para o dev reconhecer o que está removendo.
    expect(proposeDeniedTerms([{ name: "API-Gateway", owner: "ACME-Corp" }], [], "eu")).toEqual([
      "API-Gateway",
      "ACME-Corp",
    ]);
  });
});

const ZERADO: OnboardingState = {
  installationCount: 0,
  emailCount: 0,
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

  it("libera com os dois obrigatórios cumpridos", () => {
    expect(computeOnboarding(COMPLETO).ready).toBe(true);
  });

  it.each([
    ["instalação", { installationCount: 0 }],
    ["e-mail de autor", { emailCount: 0 }],
    ["telegram", { telegramLinked: false }],
  ] as const)("segura o dev quando falta %s", (_nome, falta) => {
    expect(computeOnboarding({ ...COMPLETO, ...falta }).ready).toBe(false);
  });

  it("exige instalação E e-mail no mesmo passo", () => {
    // Instalação sem e-mail de autor coleta zero commits, porque é por e-mail
    // que o sistema sabe o que é seu. Um sem o outro não é meio caminho.
    expect(feito({ ...ZERADO, installationCount: 1 }, "github")).toBe(false);
    expect(feito({ ...ZERADO, emailCount: 1 }, "github")).toBe(false);
    expect(feito({ ...ZERADO, installationCount: 1, emailCount: 1 }, "github")).toBe(true);
  });

  it("não tem passo de denylist", () => {
    // Ela é proposta sozinha e ajustável depois. Não segura ninguém porque não
    // é ela que impede vazamento — quem impede é o vocabulário fechado.
    const ids: string[] = computeOnboarding(ZERADO).steps.map((s) => s.id);
    expect(ids).not.toContain("denylist");
    expect(ids).toEqual(["github", "collaborations", "telegram", "linkedin"]);
  });

  it("opcional pendente não impede o dev de começar", () => {
    // É o que permite o MVP rodar sem o app do LinkedIn aprovado.
    const resultado = computeOnboarding(COMPLETO);
    expect(resultado.ready).toBe(true);
    expect(resultado.steps.find((s) => s.id === "linkedin")?.done).toBe(false);
    expect(resultado.steps.find((s) => s.id === "collaborations")?.done).toBe(false);
  });

  it("destaca o obrigatório pendente mesmo com um opcional antes dele na lista", () => {
    // Colaborações é opcional e vem ANTES do Telegram. Sem a busca por
    // obrigatório primeiro, o destaque cairia no passo que não segura ninguém.
    const soFaltaTelegram = { ...COMPLETO, telegramLinked: false };
    const { steps, next } = computeOnboarding(soFaltaTelegram);

    expect(steps.findIndex((s) => s.id === "collaborations")).toBeLessThan(
      steps.findIndex((s) => s.id === "telegram"),
    );
    expect(next).toBe("telegram");
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

  it("põe os dois passos de GitHub juntos, no começo", () => {
    // Quem está decidindo sobre acesso ao código decide as duas coisas de uma
    // vez; Telegram e LinkedIn são outra conversa.
    const ordem = computeOnboarding(ZERADO).steps.map((s) => s.id);
    expect(ordem.slice(0, 2)).toEqual(["github", "collaborations"]);
  });
});
