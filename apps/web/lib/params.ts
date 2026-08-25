/**
 * Parâmetros de URL.
 *
 * O Next entrega `string | string[] | undefined` porque `?a=1&a=2` é HTML
 * válido. Toda tela quer o primeiro valor, e repetir esse desembrulho em cada
 * página é onde alguém um dia esquece e renderiza `[object Object]`.
 */

export function primeiroParam(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
