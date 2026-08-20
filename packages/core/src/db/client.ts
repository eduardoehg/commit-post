/**
 * Cliente do banco.
 *
 * Driver serverless da Neon sobre WebSocket, e não o HTTP, porque o HTTP não
 * suporta transação. Criar um lote e seus 2-3 candidatos precisa ser atômico:
 * um lote sem candidatos deixaria commits marcados como processados sem nada
 * para aprovar, e eles nunca mais voltariam.
 *
 * Não há configuração de WebSocket aqui de propósito. Node 22+ e o runtime da
 * Vercel já expõem `WebSocket` global, que é o que o driver usa quando existe
 * — e o projeto exige Node 22+ (ver `engines` no package.json da raiz). Um
 * import dinâmico de `ws` com await no topo do módulo resolveria o caso de
 * runtimes antigos, mas colocaria top-level await no caminho de build do Next
 * em troca de nada.
 */

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;

/**
 * Cada chamada abre um pool próprio. Quem cria é responsável por fechar —
 * ver `closeDatabase`. Em processo de vida curta, como o job do Actions,
 * deixar o pool aberto segura o processo de pé até o timeout.
 */
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return Object.assign(db, { $pool: pool });
}

export async function closeDatabase(db: Database): Promise<void> {
  await db.$pool.end();
}

export { schema };
