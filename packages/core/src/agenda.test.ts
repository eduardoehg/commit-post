import { describe, expect, it } from "vitest";
import {
  DIAS_OFERECIDOS,
  FUSO_PADRAO,
  HORA_PADRAO,
  HORIZONTE_DIAS,
  daquiADias,
  fusoOuPadrao,
  instanteDe,
  opcaoPorId,
  opcoesDeAgendamento,
  rotularInstante,
  validarAgendamento,
} from "./agenda";

/**
 * O que se testa aqui é a diferença entre a hora que o dev escolheu e a hora
 * em que o post sai. Errar isso não quebra nada visivelmente — o post
 * simplesmente vai ao ar às 6h da manhã, e ninguém liga a causa ao efeito.
 */

const SP = "America/Sao_Paulo";

/** Que horas o relógio de parede daquele fuso marca neste instante. */
function horaLocal(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

describe("instanteDe", () => {
  it("trata a hora escolhida como local, não como UTC", () => {
    // A trava principal do recurso inteiro. São Paulo é UTC-3: 9h daqui são
    // 12h UTC. Sem a conversão, o post marcado para as 9h sairia às 6h.
    expect(instanteDe(2026, 9, 15, 9, 0, SP).toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("dá instantes diferentes para a mesma hora em fusos diferentes", () => {
    // Se os dois batessem, o fuso estaria sendo ignorado e o teste acima
    // passaria por coincidência de offset.
    const sp = instanteDe(2026, 9, 15, 9, 0, SP);
    const lisboa = instanteDe(2026, 9, 15, 9, 0, "Europe/Lisbon");

    expect(sp.getTime()).not.toBe(lisboa.getTime());
  });

  it("acerta a hora em cima da virada do horário de verão", () => {
    // Este caso é a razão de `instanteDe` ter DUAS passagens, e foi encontrado
    // varrendo fusos reais: com uma passagem só, Auckland devolve 01h para
    // quem pediu meia-noite do dia em que o relógio muda. O deslocamento usado
    // seria o do palpite, que cai do outro lado da virada.
    //
    // Auckland está a 12-13h de distância, então a janela de erro é grande o
    // bastante para uma mudança de horário caber dentro dela. Em São Paulo
    // isso nunca aparece — o Brasil não tem mais horário de verão, e testar só
    // aqui deixaria a segunda passagem sem nada que a defendesse.
    for (const [data, esperado] of [
      ["2026-04-05", "00:00"],
      ["2026-09-27", "00:00"],
    ] as const) {
      const [ano, mes, dia] = data.split("-").map(Number) as [number, number, number];
      const quando = instanteDe(ano, mes, dia, 0, 0, "Pacific/Auckland");

      expect(horaLocal(quando, "Pacific/Auckland")).toBe(`${data}, ${esperado}`);
    }
  });
});

describe("daquiADias", () => {
  /** 23h do dia 15 em São Paulo — mas já dia 16 em UTC. */
  const agora = new Date("2026-09-16T02:00:00Z");

  it("marca a hora padrão no fuso do dev", () => {
    expect(horaLocal(daquiADias(agora, SP, 1), SP)).toBe(
      `2026-09-16, ${String(HORA_PADRAO).padStart(2, "0")}:00`,
    );
  });

  it("conta o dia a partir da data LOCAL, não da data UTC", () => {
    // O relógio precisa marcar horas diferentes nos dois fusos para este teste
    // valer: às 02h UTC do dia 16 ainda é dia 15 em São Paulo. Contando pela
    // data UTC, "amanhã" viraria dia 17 — um dia depois do que o botão
    // prometeu, e ninguém ligaria o post atrasado à causa.
    expect(agora.getUTCDate()).toBe(16);
    expect(horaLocal(daquiADias(agora, SP, 1), SP)).toContain("2026-09-16");
  });

  it("atravessa a virada do mês", () => {
    const fim = new Date("2026-09-29T12:00:00Z");
    expect(horaLocal(daquiADias(fim, SP, 3), SP)).toContain("2026-10-02");
  });
});

describe("opcoesDeAgendamento", () => {
  const agora = new Date("2026-09-15T12:00:00Z");

  it("oferece horários espaçados, todos no futuro", () => {
    // Empilhados na mesma semana não serviriam ao motivo de existirem:
    // distribuir os posts que foram aprovados juntos.
    const opcoes = opcoesDeAgendamento(agora, SP);

    expect(opcoes).toHaveLength(DIAS_OFERECIDOS.length);
    for (const opcao of opcoes) expect(opcao.quando.getTime()).toBeGreaterThan(agora.getTime());

    const instantes = opcoes.map((o) => o.quando.getTime());
    expect(new Set(instantes).size).toBe(instantes.length);
    expect([...instantes].sort((a, b) => a - b)).toEqual(instantes);
  });

  it("cabe no limite de bytes de um botão do Telegram", () => {
    // O id é o que viaja no callback_data. Um id longo aqui só apareceria como
    // decisão aplicada no candidato errado, muito depois.
    for (const opcao of opcoesDeAgendamento(agora, SP)) {
      expect(String(opcao.id).length).toBeLessThanOrEqual(2);
    }
  });

  it("o rótulo diz o dia da semana, que é o que se olha de relance", () => {
    const opcao = opcoesDeAgendamento(agora, SP)[0];
    expect(opcao?.rotulo).toMatch(/^(dom|seg|ter|qua|qui|sex|sáb) \d{2}\/\d{2} \d{2}h/);
  });
});

describe("opcaoPorId", () => {
  const agora = new Date("2026-09-15T12:00:00Z");

  it("devolve o mesmo instante que foi mostrado no botão", () => {
    // O botão leva só o id; o instante é recalculado aqui. Se as duas contas
    // divergissem, o post sairia num horário que ninguém escolheu.
    const mostrada = opcoesDeAgendamento(agora, SP)[1];
    expect(opcaoPorId(agora, SP, 2)?.quando.getTime()).toBe(mostrada?.quando.getTime());
  });

  it("recusa id que não veio de nós", () => {
    expect(opcaoPorId(agora, SP, 99)).toBeNull();
    expect(opcaoPorId(agora, SP, 0)).toBeNull();
  });
});

describe("validarAgendamento", () => {
  const agora = new Date("2026-09-15T12:00:00Z");

  it("recusa o passado em vez de publicar na hora", () => {
    // Agendar para ontem e publicar agora são coisas diferentes demais para o
    // sistema escolher sozinho por quem digitou errado.
    expect(validarAgendamento(new Date("2026-09-14T12:00:00Z"), agora)).toBe("passado");
    expect(validarAgendamento(agora, agora)).toBe("passado");
  });

  it("recusa data absurda, que é erro de digitação", () => {
    expect(validarAgendamento(new Date("3000-01-01T00:00:00Z"), agora)).toBe("longe-demais");
  });

  it("aceita o que está dentro do horizonte", () => {
    expect(validarAgendamento(new Date("2026-09-16T12:00:00Z"), agora)).toBeNull();
    expect(
      validarAgendamento(new Date(agora.getTime() + (HORIZONTE_DIAS - 1) * 86_400_000), agora),
    ).toBeNull();
  });

  it("recusa data inválida em vez de gravar NaN", () => {
    // `new Date("qualquer coisa")` vem de campo de formulário. Sem esta linha
    // o NaN chegaria ao banco e o post nunca venceria.
    expect(validarAgendamento(new Date("não é data"), agora)).toBe("passado");
  });

  it("os atalhos oferecidos sempre passam na validação", () => {
    // Amarra os dois lados: mudar DIAS_OFERECIDOS para além do horizonte, ou
    // para zero, quebra aqui em vez de virar botão que recusa a si mesmo.
    for (const opcao of opcoesDeAgendamento(agora, SP)) {
      expect(validarAgendamento(opcao.quando, agora)).toBeNull();
    }
  });
});

describe("rotularInstante", () => {
  it("mostra a data no fuso do dev, não em UTC", () => {
    // 01h30 UTC do dia 16 ainda é dia 15 em São Paulo. Rotular em UTC mostraria
    // ao dev uma data que não é a dele.
    expect(rotularInstante(new Date("2026-09-16T01:30:00Z"), SP)).toContain("15/09");
  });

  it("omite os minutos quando são zero", () => {
    expect(rotularInstante(new Date("2026-09-15T12:00:00Z"), SP)).toMatch(/09h$/);
    expect(rotularInstante(new Date("2026-09-15T12:30:00Z"), SP)).toMatch(/09h30$/);
  });
});

describe("fusoOuPadrao", () => {
  it("cai no padrão em vez de estourar com fuso inválido", () => {
    // `Intl` lança para fuso desconhecido, e isso aconteceria na hora de
    // agendar — longe de onde o valor foi digitado.
    expect(fusoOuPadrao("Marte/Olympus")).toBe(FUSO_PADRAO);
    expect(fusoOuPadrao(null)).toBe(FUSO_PADRAO);
    expect(fusoOuPadrao("")).toBe(FUSO_PADRAO);
  });

  it("mantém um fuso de verdade", () => {
    expect(fusoOuPadrao("Europe/Lisbon")).toBe("Europe/Lisbon");
  });
});
