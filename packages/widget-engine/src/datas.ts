// Resolução das datas relativas dos filtros, na hora do cálculo.
//
// O extrator guarda o **deslocamento** ("-7 dias a partir de agora"), não a data
// resolvida — resolver na extração congelaria "os últimos 7 dias" no dia em que
// alguém rodou `npm run extract`. Este arquivo é onde o deslocamento vira data, e
// por isso o "agora" chega de fora (`Evaluator.now`), nunca de `new Date()`.
//
// Tudo em UTC. Não é preferência: as datas do modelo são meia-noite UTC (ver
// `makeDate` em measure-engine/value.ts), e truncar em fuso local deslocaria a
// fronteira do mês em três horas — o suficiente para mover linhas entre meses.

import { DaxEvalError } from '../../measure-engine/src/value.ts';
import type { BordaSpec, SpanSpec } from './spec.ts';

/**
 * Trunca uma data no início da unidade.
 *
 * `week` e `decade` **não** estão aqui, e a omissão é deliberada: nenhum filtro do
 * relatório usa nenhuma das duas, e "início da semana" é uma convenção (domingo ou
 * segunda?) que não se escolhe no escuro. O dia em que aparecer, o erro diz o nome.
 */
export function truncar(d: Date, unidade: string, onde: string): Date {
  switch (unidade) {
    case 'year':
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    case 'day':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    case 'hour':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
    case 'minute':
      return new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()),
      );
    case 'second':
      return new Date(
        Date.UTC(
          d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
          d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
        ),
      );
    default:
      throw new DaxEvalError(
        `${onde}: não sei truncar data na unidade '${unidade}'. ` +
          `Suportadas: year, month, day, hour, minute, second. ` +
          `'week' e 'decade' não ocorrem no relatório de hoje e exigem decidir uma ` +
          `convenção (início da semana) — não são chute a dar aqui.`,
      );
  }
}

/** Soma `amount` unidades a uma data. Mês e ano andam por calendário, não por 30/365 dias. */
export function deslocar(d: Date, amount: number, unidade: string, onde: string): Date {
  switch (unidade) {
    case 'year':
      return new Date(Date.UTC(d.getUTCFullYear() + amount, d.getUTCMonth(), d.getUTCDate(),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + amount, d.getUTCDate(),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
    case 'day':
      return new Date(d.getTime() + amount * 86_400_000);
    case 'hour':
      return new Date(d.getTime() + amount * 3_600_000);
    case 'minute':
      return new Date(d.getTime() + amount * 60_000);
    case 'second':
      return new Date(d.getTime() + amount * 1000);
    default:
      throw new DaxEvalError(
        `${onde}: não sei deslocar data em '${unidade}'. ` +
          `Suportadas: year, month, day, hour, minute, second.`,
      );
  }
}

/**
 * A âncora de um span: `Now()` vira o `now` injetado; literal vira a data escrita.
 *
 * O literal é lido como **UTC** apesar de não trazer fuso (`2026-01-01T00:00:00`).
 * É o que casa com o dado: as colunas de data do modelo são meia-noite UTC, e ler
 * o literal em fuso local moveria a fronteira do filtro em três horas.
 */
export function ancora(
  s: Pick<SpanSpec, 'anchor_kind' | 'anchor'>,
  agora: Date,
  onde: string,
): Date {
  if (s.anchor_kind === 'agora') return agora;
  if (s.anchor_kind === 'literal') {
    if (typeof s.anchor !== 'string') {
      throw new DaxEvalError(`${onde}: âncora literal sem data (anchor=${JSON.stringify(s.anchor)}).`);
    }
    const d = new Date(`${s.anchor}Z`);
    if (Number.isNaN(d.getTime())) {
      throw new DaxEvalError(`${onde}: âncora literal não é data reconhecível: ${JSON.stringify(s.anchor)}.`);
    }
    return d;
  }
  throw new DaxEvalError(
    `${onde}: âncora de data desconhecida (anchor_kind=${JSON.stringify(s.anchor_kind)}). ` +
      `O extrator não soube ler a expressão do DateSpan. Presumir "agora" aqui é ` +
      `exatamente o defeito registrado em docs/ACHADOS.md #29.`,
  );
}

/** A data que um `DateSpan` designa: a âncora truncada na unidade. */
export function resolveSpan(s: SpanSpec, agora: Date, onde: string): Date {
  if (typeof s.time_unit !== 'string') {
    throw new DaxEvalError(`${onde}: DateSpan sem unidade de tempo.`);
  }
  return truncar(ancora(s, agora, onde), s.time_unit, onde);
}

/**
 * A data de uma borda de `Between`: âncora, deslocamentos, truncamento.
 *
 * Os deslocamentos são aplicados **do mais interno para o mais externo**, ou seja
 * na ordem inversa da que a spec registra — a spec segue o aninhamento do JSON
 * (`DateAdd(DateAdd(Now, -1), -7)` grava `-7` primeiro, mas `-1` acontece antes).
 * Hoje todos são em dias e a ordem não mudaria a soma; se um dia houver mês e dia
 * juntos, ela muda (31/01 + 1 mês − 1 dia ≠ 31/01 − 1 dia + 1 mês) e a ordem
 * fiel é esta.
 */
export function resolveBorda(b: BordaSpec, agora: Date, onde: string): Date {
  let d = ancora(b, agora, onde);
  for (const o of [...(b.offsets ?? [])].reverse()) {
    if (typeof o.amount !== 'number' || typeof o.time_unit !== 'string') {
      throw new DaxEvalError(`${onde}: deslocamento incompleto: ${JSON.stringify(o)}.`);
    }
    d = deslocar(d, o.amount, o.time_unit, onde);
  }
  if (typeof b.truncate !== 'string') {
    throw new DaxEvalError(
      `${onde}: borda de Between sem truncamento. É ele que faz a janela começar à ` +
        `meia-noite em vez de na hora corrente (docs/ACHADOS.md #29).`,
    );
  }
  return truncar(d, b.truncate, onde);
}
