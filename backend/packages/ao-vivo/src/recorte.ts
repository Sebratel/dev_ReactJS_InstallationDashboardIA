// O recorte FINAL, aplicado às linhas depois do pipeline — o mesmo para a consulta
// costurada e para a original que a sonda usa de régua.
//
// Por que existe além da costura: o SQL escolhe o que buscar por um critério que só
// pode ALARGAR (na agenda, qualquer `service_desk_slots` no período), porque o critério
// exato (o `Slot Agenda` final que a view calcula) só existe depois das janelas. Um
// protocolo reagendado para fora do período entra na busca e sai aqui. Medido em
// 22/10/2026, semana de 12 a 18/10: 3.390 linhas buscadas, 3.383 depois do recorte,
// idênticas às da original recortada do mesmo jeito.

import { normalizeName } from '../../semantic-model/src/model.ts';
import type { Escalar } from '../../snapshot/src/formato.ts';
import type { Recorte } from './catalogo.ts';

export interface ValoresDoRecorte {
  /** `AAAA-MM-DD`, início inclusive. */
  readonly desde?: string;
  /** `AAAA-MM-DD`, fim exclusivo. */
  readonly ate?: string;
  readonly protocolos?: Iterable<string>;
}

/** A célula pelo nome como o modelo o escreve ou normalizado (a chave canônica do Dataset). */
export function celula(l: Readonly<Record<string, Escalar>>, coluna: string): Escalar {
  return (l[coluna] ?? l[normalizeName(coluna)] ?? null) as Escalar;
}

/** O texto de uma célula para comparar e agrupar. Data pelo instante, BLANK como `∅`. */
export function texto(v: Escalar): string {
  if (v instanceof Date) return v.toISOString();
  if (v === null || v === undefined) return '∅';
  return String(v);
}

/** `AAAA-MM-DD` como o instante UTC da meia-noite — a data sem fuso que o banco guarda. */
function instante(dia: string, nome: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw new Error(`recorte: '${nome}' tem de ser AAAA-MM-DD, veio '${dia}'`);
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
}

export function aplicaRecorte<L extends Readonly<Record<string, Escalar>>>(
  linhas: readonly L[],
  recorte: Recorte,
  valores: ValoresDoRecorte,
): L[] {
  if (recorte.tipo === 'protocolos-da-lista') {
    if (!valores.protocolos) throw new Error('recorte por lista sem a lista de protocolos');
    const lista = new Set([...valores.protocolos].map(String));
    return linhas.filter((l) => lista.has(texto(celula(l, recorte.protocolo))));
  }
  if (!valores.desde || !valores.ate) throw new Error('recorte por período sem desde/até');
  const ini = instante(valores.desde, 'desde');
  const fim = instante(valores.ate, 'ate');
  const doPeriodo = new Set<string>();
  for (const l of linhas) {
    const d = celula(l, recorte.data);
    if (d instanceof Date && d.getTime() >= ini && d.getTime() < fim) doPeriodo.add(texto(celula(l, recorte.protocolo)));
  }
  return linhas.filter((l) => doPeriodo.has(texto(celula(l, recorte.protocolo))));
}
