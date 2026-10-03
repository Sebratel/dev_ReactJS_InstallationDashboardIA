// A comparação de um valor do Power BI com o nosso — separada do script para poder
// ser testada. `backend/tools/powerbi/src/index.ts` roda `await pegaToken()` no topo, então
// importá-lo num teste tentaria autenticar; foi por isso que `compara` ficou sem
// teste nenhum até 18/09/2026, apesar de o cabeçalho de `test/api.test.ts` anunciar
// "a fronteira de saída e a comparação".
//
// O preço dessa ausência foi medido: a comparação de data era `String(p) ===
// String(nosso)`, e como o Power BI manda TEXTO e nós mandamos `Date`, ela nunca
// casava. Dez páginas marcavam `Data mais recente` como divergência exibindo o mesmo
// valor nas duas colunas.

import { isBlank, type DaxValue } from '../../../packages/measure-engine/src/value.ts';

/** Números batem dentro desta tolerância relativa. */
export const TOLERANCIA = 0.005;

// 'janela' é diferente de 'ausente': a medida existe nos dois lados, mas as duas
// tabelas não são a mesma fatia de realidade e nenhum predicado as reconcilia.
// Confundir as duas coisas faria a saída dizer "a plataforma não tem esta medida"
// sobre uma medida que a plataforma tem e calcula.
// 'movel' é a medida cuja janela termina no relógio (`TODAY()`/`NOW()`). Ela não
// é comparável a um número fixo: o dia de hoje está pela metade dos dois lados e
// cada um o congelou num instante diferente. Ver `dependeDoRelogio` em janela.ts.
export type Veredito = 'bate' | 'difere' | 'ausente' | 'erro' | 'janela' | 'movel';

export interface Comparacao {
  nome: string;
  powerbi: DaxValue | undefined;
  nosso: DaxValue | undefined;
  veredito: Veredito;
  detalhe?: string;
}

/** Números batem dentro da tolerância; o resto compara por igualdade estrita. */
export function compara(nome: string, pbi: unknown, nosso: DaxValue | undefined): Comparacao {
  if (pbi === undefined) return { nome, powerbi: undefined, nosso, veredito: 'ausente',
    detalhe: 'o Power BI não devolveu esta medida' };
  if (nosso === undefined) return { nome, powerbi: pbi as DaxValue, nosso: undefined, veredito: 'ausente',
    detalhe: 'a plataforma não tem esta medida carregada' };

  const p = pbi as DaxValue;
  if (isBlank(p) && isBlank(nosso)) return { nome, powerbi: p, nosso, veredito: 'bate' };
  if (isBlank(p) !== isBlank(nosso)) {
    return { nome, powerbi: p, nosso, veredito: 'difere', detalhe: 'um lado é BLANK e o outro não' };
  }

  if (typeof p === 'number' && typeof nosso === 'number') {
    const escala = Math.max(Math.abs(p), Math.abs(nosso), 1);
    const dif = Math.abs(p - nosso);
    return dif / escala <= TOLERANCIA
      ? { nome, powerbi: p, nosso, veredito: 'bate' }
      : { nome, powerbi: p, nosso, veredito: 'difere', detalhe: `diferença de ${dif.toPrecision(4)}` };
  }
  // **Data contra data, e não texto contra texto.** O Power BI devolve data como
  // TEXTO ISO no JSON da API (`"2026-09-18T00:00:00"`); a plataforma devolve um
  // `Date`. `String(new Date(...))` dá `"Thu Sep 18 2026 …"`, então a comparação de
  // texto NUNCA casava — e a tabela mostrava as duas colunas com o mesmo valor
  // formatado, uma ao lado da outra, marcadas DIFERE.
  //
  // Medido em 18/09/2026, varrendo as 11 páginas: `Data mais recente` aparecia como
  // divergência em TODAS as dez que a têm, sempre `2026-09-18T00:00:00` contra
  // `2026-09-18`. Dez falsos positivos de um comparador, num arquivo cuja única
  // função é dizer o que está errado. Falso positivo aqui é pior que ruído: ele
  // ensina a ignorar a lista.
  //
  // `Hora mais recente` CONTINUA divergindo depois disto, e deve mesmo: são
  // 18:09:30.107 contra 18:10:49, instantes de verdade diferentes — é o carimbo do
  // refresh de cada lado.
  const instP = comoInstante(p);
  const instN = comoInstante(nosso);
  if (instP !== null && instN !== null) {
    if (instP === instN) return { nome, powerbi: p, nosso, veredito: 'bate' };
    const seg = Math.round(Math.abs(instP - instN) / 1000);
    return { nome, powerbi: p, nosso, veredito: 'difere', detalhe: `distam ${seg}s` };
  }

  return String(p) === String(nosso)
    ? { nome, powerbi: p, nosso, veredito: 'bate' }
    : { nome, powerbi: p, nosso, veredito: 'difere' };
}

/**
 * O instante que este valor representa, ou `null` se ele não for data.
 *
 * **Sem fuso, de propósito.** DAX não tem fuso: `2026-09-18T00:00:00` no modelo
 * publicado e a nossa meia-noite UTC são o mesmo valor de calendário, e convertê-los
 * por fuso deslocaria um dos dois. Por isso o texto é lido componente a componente
 * com `Date.UTC`, e não com `new Date(texto)` — que aplicaria a regra de fuso do
 * runtime e faria a comparação depender de onde o processo roda.
 */
export function comoInstante(v: DaxValue): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const comHora = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(s);
  if (comHora) {
    // `.1` é um DÉCIMO de segundo, não 1 ms: o padding à direita é o que impede
    // 100 ms virar 1 ms e uma igualdade virar divergência de 99 ms.
    const ms = Number.parseInt((comHora[7] ?? '0').padEnd(3, '0'), 10);
    return Date.UTC(+comHora[1]!, +comHora[2]! - 1, +comHora[3]!,
      +comHora[4]!, +comHora[5]!, +comHora[6]!, ms);
  }
  const soDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (soDia) return Date.UTC(+soDia[1]!, +soDia[2]! - 1, +soDia[3]!);
  return null;
}
