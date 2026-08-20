import { describe, it } from "vitest";

/**
 * Contrato do filtro de confidencialidade, escrito antes da implementação.
 *
 * Estes `it.todo` são a especificação executável da Fase 3 — cada um vira um
 * teste real quando a função correspondente for implementada. Nenhuma
 * integração com GitHub, Claude ou Telegram deve ser ligada antes daqui estar
 * verde.
 */

describe("extractTechnicalFacts — barreira 1", () => {
  it.todo("classifica o tipo de mudança a partir da mensagem do commit");
  it.todo("mantém termos do vocabulário público (React, Postgres, cache, webhook)");
  it.todo("descarta qualquer token fora do vocabulário público");
  it.todo("descarta nomes próprios capitalizados desconhecidos");
  it.todo("descarta domínios, IPs e URLs internas");
  it.todo("descarta nomes de variáveis de ambiente e chaves que pareçam credenciais");
  it.todo("descarta números de ticket e IDs de issue interna (ABC-1234)");
  it.todo("nunca inclui o alias do repositório no fato técnico enviado ao LLM");
  it.todo("preserva sourceShas para exibir procedência na aprovação");
  it.todo("agrupa múltiplos commits relacionados num único fato técnico");
  it.todo("devolve lista vazia quando nenhum commit sobrevive ao filtro");
});

describe("scrubGeneratedText — barreira 2", () => {
  it.todo("remove nome de empresa que o LLM tenha reintroduzido");
  it.todo("remove nome de cliente que o LLM tenha reintroduzido");
  it.todo("remove caminho de arquivo que apareça no texto gerado");
  it.todo("reporta em `removed` tudo que foi retirado");
  it.todo("deixa o texto intacto quando nada suspeito é encontrado");
});

describe("propriedades de segurança", () => {
  it.todo("é idempotente: filtrar duas vezes dá o mesmo resultado");
  it.todo("na dúvida descarta — entrada desconhecida nunca vira saída publicável");
});
