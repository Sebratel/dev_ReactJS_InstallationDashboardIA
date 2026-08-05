// As funções M implementadas.
//
// Mesma forma do `functions.ts` do avaliador de DAX: tabela de nome →
// implementação, e **nada de default silencioso**. Função ausente é erro com o
// nome dela (`evaluator.ts` cuida disso); função presente que recebe algo que não
// sabe tratar é erro dizendo o quê e onde.
//
// Duas semânticas aqui são carregadas por ordem de linha e precisam ficar
// explícitas, porque errá-las não dá erro — dá número plausível:
//
//   - **`Table.Distinct` mantém a PRIMEIRA ocorrência na ordem corrente.** Em
//     `PROTOCOLOS GERAL`, qual supervisor sobra para cada protocolo depende disso
//     e da ordem que um `Table.Sort` deixou três passos antes (fato decisivo 3 de
//     DECISAO-CAMADA-M.md).
//   - **`Table.Sort` é ESTÁVEL.** Empate preserva a ordem anterior. `Array.sort`
//     do JS é estável desde o ES2019, então isto é garantia da linguagem — mas
//     está dito aqui porque um dia alguém vai querer trocar por outra ordenação.

import zlib from 'node:zlib';

import {
  igual,
  type MCallContext,
  type MFunctionImpl,
  type MFunctionTable,
} from './evaluator.ts';
import {
  isFunction,
  isList,
  isRecord,
  isTable,
  linha,
  MDuration,
  MEvalError,
  MRecord,
  MTable,
  MTime,
  tipoDe,
  type MFunction,
  type MRow,
  type MValue,
} from './value.ts';

// ── extração de argumento, com erro que diz o nome da função ──────────────────

function exigeTabela(v: MValue, fn: string, qual = 'o 1º argumento'): MTable {
  if (!isTable(v)) throw new MEvalError(`${fn}: ${qual} é ${tipoDe(v)}, esperava table.`);
  return v;
}

function exigeTexto(v: MValue, fn: string, qual: string): string {
  if (typeof v !== 'string') throw new MEvalError(`${fn}: ${qual} é ${tipoDe(v)}, esperava text.`);
  return v;
}

function exigeFuncao(v: MValue, fn: string, qual: string): MFunction {
  if (!isFunction(v)) throw new MEvalError(`${fn}: ${qual} é ${tipoDe(v)}, esperava function.`);
  return v;
}

/** Um nome de coluna ou uma lista deles, sempre devolvida como lista. */
function nomesDeColuna(v: MValue, fn: string): string[] {
  if (typeof v === 'string') return [v];
  if (isList(v)) return v.map((x, i) => exigeTexto(x, fn, `o nome de coluna na posição ${i}`));
  throw new MEvalError(`${fn}: esperava nome de coluna (text) ou lista de nomes, veio ${tipoDe(v)}.`);
}

/** Pares `{{"de","para"}, …}` — ou o par solto `{"de","para"}`. */
function paresDeNome(v: MValue, fn: string): [string, string][] {
  if (!isList(v)) throw new MEvalError(`${fn}: esperava lista de pares, veio ${tipoDe(v)}.`);
  // Par solto: `Table.RenameColumns(t, {"a","b"})` é legal em M.
  if (v.length === 2 && v.every((x) => typeof x === 'string')) {
    return [[v[0] as string, v[1] as string]];
  }
  return v.map((item, i) => {
    if (!isList(item) || item.length < 2) {
      throw new MEvalError(`${fn}: o par na posição ${i} não é uma lista de dois nomes.`);
    }
    return [
      exigeTexto(item[0], fn, `o nome de origem no par ${i}`),
      exigeTexto(item[1], fn, `o nome de destino no par ${i}`),
    ];
  });
}

/** Aplica uma função M de 1 argumento. */
function aplica1(f: MFunction, arg: MValue): MValue {
  return f.call([arg]);
}

/** Linha como registro, para passar a um `each`. */
function comoRegistro(t: MTable, r: MRow): MRecord {
  return new MRecord(t.columns.map((c) => [c, r.get(c) ?? null] as const));
}

// ── conversão de tipo ─────────────────────────────────────────────────────────

/**
 * Converte um valor para o tipo pedido por `Table.TransformColumnTypes`.
 *
 * O tipo chega como texto (`"type text"`, `"Int64.Type"`) porque é assim que o
 * avaliador passa nó de tipo e identificador.
 *
 * **A regra é conservadora de propósito, e isso é a decisão mais importante deste
 * arquivo.** Valor que já é do tipo pedido passa direto — e esse é o caso normal,
 * porque o ODBC já devolve número como número e data como data. O que **não**
 * acontece é adivinhar formato de texto: `"01/02/2026"` pode ser 1º de fevereiro
 * ou 2 de janeiro, e o Power Query decide isso pela *culture* do arquivo, que não
 * está na expressão M. Converter na surdina aqui é exatamente o erro do achado 1
 * (o falso): ler março onde era abril, sem erro nenhum no caminho.
 */
function converte(
  v: MValue,
  tipo: string,
  coluna: string,
  fn: string,
  culture: string | null,
): MValue {
  if (v === null) return null;
  const t = tipo.replace(/^type\s+/, '').replace(/^nullable\s+/, '').trim();

  switch (t) {
    case 'any':
      return v;

    case 'text':
    case 'Text.Type':
      if (typeof v === 'string') return v;
      throw naoConverte(v, 'text', coluna, fn, 'use Text.From se a conversão é intencional');

    case 'number':
    case 'Number.Type':
    case 'Int64.Type':
    case 'Int32.Type':
    case 'Percentage.Type':
    case 'Currency.Type':
    case 'Double.Type': {
      const inteiro = t === 'Int64.Type' || t === 'Int32.Type';
      if (typeof v === 'number') return inteiro ? Math.trunc(v) : v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      // Texto para número **é** conversão que o Power Query faz, e a base depende
      // dela: o golden registra `PROTOCOLO:` e `NUMERO CONTRATO` como string
      // numérica, e o M declara `Int64.Type`. Diferente de data, isto não é
      // ambíguo quando a culture é conhecida — só o separador decimal muda.
      const n = textoParaNumero(v, culture);
      if (n !== null) return inteiro ? Math.trunc(n) : n;
      throw naoConverte(v, t, coluna, fn, dicaDeNumero(v, culture));
    }

    case 'logical':
    case 'Logical.Type':
      if (typeof v === 'boolean') return v;
      throw naoConverte(v, 'logical', coluna, fn);

    case 'date':
    case 'Date.Type': {
      if (v instanceof Date) return soData(v);
      // Número é o formato nativo de data na planilha (ver `dataDeSerial`).
      if (typeof v === 'number') return soData(dataDeSerial(v));
      const d = textoParaData(v, culture);
      if (d) return soData(d);
      throw naoConverte(v, 'date', coluna, fn, formatoDeTexto(v, culture));
    }

    case 'datetime':
    case 'DateTime.Type':
    case 'datetimezone':
    case 'DateTimeZone.Type': {
      if (v instanceof Date) return v;
      if (typeof v === 'number') return dataDeSerial(v);
      const d = textoParaData(v, culture);
      if (d) return d;
      throw naoConverte(v, t, coluna, fn, formatoDeTexto(v, culture));
    }

    case 'time':
    case 'Time.Type':
      if (v instanceof MTime) return v;
      if (v instanceof Date) return horaDe(v);
      throw naoConverte(v, 'time', coluna, fn);

    case 'duration':
    case 'Duration.Type':
      if (v instanceof MDuration) return v;
      throw naoConverte(v, 'duration', coluna, fn);

    default:
      throw new MEvalError(
        `${fn}: tipo '${tipo}' não implementado (coluna '${coluna}'). ` +
          'O engine não adivinha conversão de tipo desconhecido.',
      );
  }
}

function naoConverte(v: MValue, alvo: string, coluna: string, fn: string, dica?: string): MEvalError {
  return new MEvalError(
    `${fn}: a coluna '${coluna}' tem ${tipoDe(v)} (${JSON.stringify(resumo(v))}) e o passo ` +
      `pede ${alvo}. O engine não converte implicitamente` +
      (dica ? ` — ${dica}.` : '.'),
  );
}

function formatoDeTexto(v: MValue, culture: string | null): string {
  if (typeof v !== 'string') return '';
  return culture
    ? `a culture do modelo é '${culture}' e o texto não casa com nenhum formato de data dela`
    : 'o formato de data em texto depende da culture do modelo (01/02 é 1º de fevereiro ' +
        'ou 2 de janeiro?), e nenhuma culture foi informada ao engine';
}

/**
 * Texto para número, **segundo a culture do modelo**.
 *
 * O que muda entre culturas é só o separador: em `pt-BR`, `.` agrupa milhar e `,`
 * é decimal (`"1.234,56"` = 1234,56); em `en-US` é o contrário. Por isso a culture
 * é necessária — e por isso, sem ela, só dígitos puros passam: `"1,5"` seria 1,5 ou
 * 15 dependendo de quem lê.
 *
 * Devolve `null` quando não é número; quem chamou decide se isso é erro.
 */
function textoParaNumero(v: MValue, culture: string | null): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;

  // Sem culture: só o que é igual em qualquer uma.
  if (!culture) return /^[+-]?\d+$/.test(s) ? Number(s) : null;

  if (culture === 'pt-BR') {
    if (!/^[+-]?[\d.]*\d(?:,\d+)?$/.test(s)) return null;
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  // Outras culturas: só dígitos puros, para não inventar convenção.
  return /^[+-]?\d+$/.test(s) ? Number(s) : null;
}

function dicaDeNumero(v: MValue, culture: string | null): string {
  if (typeof v !== 'string') return 'use Number.From se a conversão é intencional';
  return culture
    ? `a culture do modelo é '${culture}' e o texto não é número nela`
    : 'sem culture, só dígitos puros são convertidos (`1,5` seria 1,5 ou 15?)';
}

/**
 * Texto para data, **segundo a culture do modelo**.
 *
 * Só `pt-BR` está implementada, porque é a que o PBIP declara — o extrator lê
 * `culture` de `model.tmdl` e grava em `specs/_catalog/model.yaml`. Culture
 * diferente devolve `null` (e quem chamou erra alto) em vez de cair no formato
 * brasileiro: no dia em que o modelo virar `en-US`, `01/02` muda de significado, e
 * ninguém quer descobrir isso por uma média errada.
 *
 * ISO (`YYYY-MM-DD`) é aceito em qualquer culture, porque não é ambíguo.
 */
function textoParaData(v: MValue, culture: string | null): Date | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (iso) {
    return montaData(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0), +(iso[6] ?? 0));
  }

  if (culture !== 'pt-BR') return null;
  // pt-BR: dia primeiro. Aceita `/` e `-`, exige ano de 4 dígitos (ano de 2 seria
  // outra adivinhação), hora opcional.
  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!br) return null;
  return montaData(+br[3], +br[2], +br[1], +(br[4] ?? 0), +(br[5] ?? 0), +(br[6] ?? 0));
}

/** Monta a data e **confere** que ela existe: 31/02 devolve null, não 03/03. */
function montaData(
  ano: number,
  mes: number,
  dia: number,
  h: number,
  mi: number,
  seg: number,
): Date | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia, h, mi, seg));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null;
  }
  return d;
}

function resumo(v: MValue): unknown {
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof MTime) return `${v.ms}ms`;
  if (isTable(v)) return `table(${v.rowCount} linhas)`;
  if (isList(v)) return `list(${v.length})`;
  return v as unknown;
}

function soData(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Época do número de série de data no Power BI, no Excel e no Google Sheets. */
const EPOCA_SERIAL_MS = Date.UTC(1899, 11, 30);

/**
 * Número de série para data.
 *
 * É por aqui que a planilha entrega data: o connector pede
 * `valueRenderOption=UNFORMATTED_VALUE`, e nesse modo célula de data vem como
 * número (dias desde 1899-12-30, fração = hora) — igual ao que o Power Query
 * recebe. Sem isto, `{"DATA", type date}` de `CAPACIDADE EQUIPE` recusaria o
 * próprio formato nativo da fonte.
 *
 * Diferente de texto para data, aqui **não há ambiguidade de culture**: o número
 * não tem formato. Por isso a conversão é aceita sem `culture`.
 */
function dataDeSerial(n: number): Date {
  if (!Number.isFinite(n)) {
    throw new MEvalError(`Número de série de data inválido: ${n}.`);
  }
  // Arredonda no milissegundo: 0,354166… * 86_400_000 dá 30599999,99 em binário,
  // e truncar transformaria 08:30 em 08:29:59.999.
  return new Date(EPOCA_SERIAL_MS + Math.round(n * 86_400_000));
}

function horaDe(d: Date): MTime {
  return new MTime(
    d.getUTCHours() * 3_600_000 + d.getUTCMinutes() * 60_000 +
      d.getUTCSeconds() * 1000 + d.getUTCMilliseconds(),
  );
}

// ── funções de tabela ─────────────────────────────────────────────────────────

const TABELA: MFunctionImpl[] = [
  {
    name: 'Table.RenameColumns',
    minArgs: 2,
    maxArgs: 3,
    call: ([tv, pares]) => {
      const t = exigeTabela(tv, 'Table.RenameColumns');
      const mapa = new Map(paresDeNome(pares, 'Table.RenameColumns'));
      for (const de of mapa.keys()) t.exigeColuna(de, 'Table.RenameColumns');
      const novas = t.columns.map((c) => mapa.get(c) ?? c);
      // Renomear para um nome que já existe colide. O Power Query recusa; deixar
      // passar perderia uma coluna sem avisar.
      const vistas = new Set<string>();
      for (const c of novas) {
        if (vistas.has(c)) {
          throw new MEvalError(`Table.RenameColumns: o nome '${c}' ficaria duplicado.`);
        }
        vistas.add(c);
      }
      return new MTable(
        novas,
        t.rows.map((r) => linha(t.columns.map((c, i) => [novas[i], r.get(c) ?? null] as const))),
      );
    },
  },
  {
    name: 'Table.RemoveColumns',
    minArgs: 2,
    maxArgs: 3,
    call: ([tv, cols]) => {
      const t = exigeTabela(tv, 'Table.RemoveColumns');
      const fora = new Set(nomesDeColuna(cols, 'Table.RemoveColumns'));
      for (const c of fora) t.exigeColuna(c, 'Table.RemoveColumns');
      const ficam = t.columns.filter((c) => !fora.has(c));
      return new MTable(ficam, t.rows.map((r) => linha(ficam.map((c) => [c, r.get(c) ?? null] as const))));
    },
  },
  {
    name: 'Table.SelectColumns',
    minArgs: 2,
    maxArgs: 3,
    call: ([tv, cols]) => {
      const t = exigeTabela(tv, 'Table.SelectColumns');
      // Diferente de RemoveColumns, aqui a ordem é a **pedida**, não a original.
      const ficam = nomesDeColuna(cols, 'Table.SelectColumns');
      for (const c of ficam) t.exigeColuna(c, 'Table.SelectColumns');
      return new MTable(ficam, t.rows.map((r) => linha(ficam.map((c) => [c, r.get(c) ?? null] as const))));
    },
  },
  {
    name: 'Table.ReorderColumns',
    minArgs: 2,
    maxArgs: 3,
    call: ([tv, cols]) => {
      const t = exigeTabela(tv, 'Table.ReorderColumns');
      const pedidas = nomesDeColuna(cols, 'Table.ReorderColumns');
      for (const c of pedidas) t.exigeColuna(c, 'Table.ReorderColumns');
      // As não citadas ficam depois, na ordem em que estavam.
      const resto = t.columns.filter((c) => !pedidas.includes(c));
      const ordem = [...pedidas, ...resto];
      return new MTable(ordem, t.rows.map((r) => linha(ordem.map((c) => [c, r.get(c) ?? null] as const))));
    },
  },
  {
    name: 'Table.DuplicateColumn',
    minArgs: 3,
    maxArgs: 4,
    call: ([tv, de, para]) => {
      const t = exigeTabela(tv, 'Table.DuplicateColumn');
      const origem = exigeTexto(de, 'Table.DuplicateColumn', 'a coluna de origem');
      const nova = exigeTexto(para, 'Table.DuplicateColumn', 'o nome da nova coluna');
      t.exigeColuna(origem, 'Table.DuplicateColumn');
      if (t.hasColumn(nova)) {
        throw new MEvalError(`Table.DuplicateColumn: a coluna '${nova}' já existe.`);
      }
      const ordem = [...t.columns, nova];
      return new MTable(
        ordem,
        t.rows.map((r) => linha([...t.columns.map((c) => [c, r.get(c) ?? null] as const),
          [nova, r.get(origem) ?? null] as const])),
      );
    },
  },
  {
    name: 'Table.AddColumn',
    minArgs: 3,
    maxArgs: 4,
    call: ([tv, nome, gerador]) => {
      const t = exigeTabela(tv, 'Table.AddColumn');
      const nova = exigeTexto(nome, 'Table.AddColumn', 'o nome da coluna');
      const f = exigeFuncao(gerador, 'Table.AddColumn', 'o gerador');
      if (t.hasColumn(nova)) {
        throw new MEvalError(`Table.AddColumn: a coluna '${nova}' já existe.`);
      }
      const ordem = [...t.columns, nova];
      return new MTable(
        ordem,
        t.rows.map((r) => {
          // A função vê a linha **de origem**: coluna nova não vê coluna nova, o
          // que é o mesmo contrato do ADDCOLUMNS do lado do DAX.
          const v = aplica1(f, comoRegistro(t, r));
          return linha([...t.columns.map((c) => [c, r.get(c) ?? null] as const), [nova, v] as const]);
        }),
      );
    },
  },
  {
    name: 'Table.SelectRows',
    minArgs: 2,
    maxArgs: 2,
    call: ([tv, cond]) => {
      const t = exigeTabela(tv, 'Table.SelectRows');
      const f = exigeFuncao(cond, 'Table.SelectRows', 'a condição');
      return t.comLinhas(
        t.rows.filter((r) => {
          const v = aplica1(f, comoRegistro(t, r));
          // Condição null **não** passa a linha (é o que M faz), e condição que
          // não é logical é erro — não "considero falso".
          if (v === null) return false;
          if (typeof v !== 'boolean') {
            throw new MEvalError(
              `Table.SelectRows: a condição devolveu ${tipoDe(v)}, esperava logical.`,
            );
          }
          return v;
        }),
      );
    },
  },
  {
    name: 'Table.Distinct',
    minArgs: 1,
    maxArgs: 2,
    call: ([tv, cols]) => {
      const t = exigeTabela(tv, 'Table.Distinct');
      const chaves = cols === undefined || cols === null
        ? t.columns
        : nomesDeColuna(cols, 'Table.Distinct');
      for (const c of chaves) t.exigeColuna(c, 'Table.Distinct');
      // MANTÉM A PRIMEIRA da ordem corrente. Ver o comentário no topo do arquivo:
      // é daqui que sai qual supervisor fica preso a cada protocolo.
      const vistas = new Set<string>();
      const ficam: MRow[] = [];
      for (const r of t.rows) {
        const k = chaveDe(chaves.map((c) => r.get(c) ?? null));
        if (vistas.has(k)) continue;
        vistas.add(k);
        ficam.push(r);
      }
      return t.comLinhas(ficam);
    },
  },
  {
    name: 'Table.Skip',
    minArgs: 1,
    maxArgs: 2,
    call: ([tv, n]) => {
      const t = exigeTabela(tv, 'Table.Skip');
      if (n === undefined || n === null) return t.comLinhas(t.rows.slice(1));
      if (typeof n !== 'number') {
        throw new MEvalError(`Table.Skip: esperava número de linhas, veio ${tipoDe(n)}.`);
      }
      return t.comLinhas(t.rows.slice(n));
    },
  },
  {
    name: 'Table.FirstN',
    minArgs: 2,
    maxArgs: 2,
    call: ([tv, n]) => {
      const t = exigeTabela(tv, 'Table.FirstN');
      if (typeof n !== 'number') {
        throw new MEvalError(`Table.FirstN: esperava número, veio ${tipoDe(n)}.`);
      }
      return t.comLinhas(t.rows.slice(0, n));
    },
  },
  {
    name: 'Table.Sort',
    minArgs: 2,
    maxArgs: 2,
    call: ([tv, criterio]) => {
      const t = exigeTabela(tv, 'Table.Sort');
      const chaves = criteriosDeOrdem(criterio, t);
      // Estável: empate preserva a ordem anterior. Garantido pelo ES2019, e
      // load-bearing — ver o topo do arquivo.
      const ordenadas = [...t.rows].sort((a, b) => {
        for (const { coluna, desc } of chaves) {
          const c = ordena(a.get(coluna) ?? null, b.get(coluna) ?? null);
          if (c !== 0) return desc ? -c : c;
        }
        return 0;
      });
      return t.comLinhas(ordenadas);
    },
  },
  {
    name: 'Table.ReplaceValue',
    minArgs: 5,
    maxArgs: 5,
    call: ([tv, velho, novo, substituidor, cols]) => {
      const t = exigeTabela(tv, 'Table.ReplaceValue');
      const alvo = nomesDeColuna(cols, 'Table.ReplaceValue');
      for (const c of alvo) t.exigeColuna(c, 'Table.ReplaceValue');
      const f = exigeFuncao(substituidor, 'Table.ReplaceValue', 'o substituidor');
      const conjunto = new Set(alvo);
      return t.comLinhas(
        t.rows.map((r) =>
          linha(
            t.columns.map((c) => {
              if (!conjunto.has(c)) return [c, r.get(c) ?? null] as const;
              // O substituidor recebe (valorAtual, velho, novo): é a assinatura de
              // Replacer.ReplaceValue e Replacer.ReplaceText.
              return [c, f.call([r.get(c) ?? null, velho, novo])] as const;
            }),
          ),
        ),
      );
    },
  },
  {
    name: 'Table.TransformColumns',
    minArgs: 2,
    maxArgs: 3,
    call: ([tv, transformacoes]) => {
      const t = exigeTabela(tv, 'Table.TransformColumns');
      const lista = isList(transformacoes) ? transformacoes : [transformacoes];
      // `{{"col", each …}}` ou `{"col", each …}` (par solto).
      const pares: { coluna: string; f: MFunction }[] = [];
      const comoPar = (item: MValue): void => {
        if (!isList(item) || item.length < 2) {
          throw new MEvalError('Table.TransformColumns: esperava {"coluna", transformação}.');
        }
        pares.push({
          coluna: exigeTexto(item[0], 'Table.TransformColumns', 'o nome da coluna'),
          f: exigeFuncao(item[1], 'Table.TransformColumns', 'a transformação'),
        });
      };
      if (lista.length === 2 && typeof lista[0] === 'string') comoPar(lista);
      else lista.forEach(comoPar);
      for (const p of pares) t.exigeColuna(p.coluna, 'Table.TransformColumns');
      const porColuna = new Map(pares.map((p) => [p.coluna, p.f]));
      return t.comLinhas(
        t.rows.map((r) =>
          linha(
            t.columns.map((c) => {
              const f = porColuna.get(c);
              return [c, f ? aplica1(f, r.get(c) ?? null) : r.get(c) ?? null] as const;
            }),
          ),
        ),
      );
    },
  },
  {
    name: 'Table.TransformColumnTypes',
    minArgs: 2,
    maxArgs: 3,
    call: ([tv, tipos], ctx) => {
      const t = exigeTabela(tv, 'Table.TransformColumnTypes');
      const pares = paresDeNome(tipos, 'Table.TransformColumnTypes');
      // Coluna citada que não existe é erro: é o sinal de que a fonte mudou.
      for (const [c] of pares) t.exigeColuna(c, 'Table.TransformColumnTypes');
      const porColuna = new Map(pares);
      return t.comLinhas(
        t.rows.map((r) =>
          linha(
            t.columns.map((c) => {
              const tipo = porColuna.get(c);
              const v = r.get(c) ?? null;
              return [
                c,
                tipo === undefined
                  ? v
                  : converte(v, tipo, c, 'Table.TransformColumnTypes', ctx.culture),
              ] as const;
            }),
          ),
        ),
      );
    },
  },
  {
    name: 'Table.PromoteHeaders',
    minArgs: 1,
    maxArgs: 2,
    call: ([tv]) => {
      const t = exigeTabela(tv, 'Table.PromoteHeaders');
      if (t.rowCount === 0) {
        throw new MEvalError('Table.PromoteHeaders: tabela vazia não tem linha de cabeçalho.');
      }
      const primeira = t.rows[0];
      const novos = t.columns.map((c, i) => {
        const v = primeira.get(c) ?? null;
        // Célula de cabeçalho vazia viraria coluna sem nome, e duas delas
        // colidiriam. O Power Query gera "Column1"; aqui erra alto, porque numa
        // planilha isso quer dizer que a aba mudou de forma.
        if (v === null || v === '') {
          throw new MEvalError(
            `Table.PromoteHeaders: a célula ${i + 1} do cabeçalho está vazia. ` +
              'A aba provavelmente mudou de forma.',
          );
        }
        return typeof v === 'string' ? v : String(resumo(v));
      });
      return new MTable(
        novos,
        t.rows.slice(1).map((r) => linha(t.columns.map((c, i) => [novos[i], r.get(c) ?? null] as const))),
      );
    },
  },
  {
    name: 'Table.Combine',
    minArgs: 1,
    maxArgs: 2,
    call: ([tabelas]) => {
      if (!isList(tabelas)) {
        throw new MEvalError(`Table.Combine: esperava lista de tabelas, veio ${tipoDe(tabelas)}.`);
      }
      const ts = tabelas.map((x, i) => exigeTabela(x, 'Table.Combine', `o item ${i} da lista`));
      if (ts.length === 0) throw new MEvalError('Table.Combine: lista vazia.');
      // União das colunas na ordem de primeira aparição; coluna que falta numa das
      // tabelas vem null, que é o que o M faz.
      const ordem: string[] = [];
      for (const t of ts) for (const c of t.columns) if (!ordem.includes(c)) ordem.push(c);
      const rows: MRow[] = [];
      for (const t of ts) {
        for (const r of t.rows) {
          rows.push(linha(ordem.map((c) => [c, t.hasColumn(c) ? r.get(c) ?? null : null] as const)));
        }
      }
      return new MTable(ordem, rows);
    },
  },
  {
    name: 'Table.NestedJoin',
    minArgs: 5,
    maxArgs: 6,
    call: ([esqV, chaveEsq, dirV, chaveDir, nomeNovo, tipoJoin]) => {
      const fn = 'Table.NestedJoin';
      const esq = exigeTabela(esqV, fn);
      const dir = exigeTabela(dirV, fn, 'o 3º argumento');
      const ke = nomesDeColuna(chaveEsq, fn);
      const kd = nomesDeColuna(chaveDir, fn);
      if (ke.length !== kd.length) {
        throw new MEvalError(`${fn}: ${ke.length} chave(s) à esquerda e ${kd.length} à direita.`);
      }
      for (const c of ke) esq.exigeColuna(c, `${fn} (esquerda)`);
      for (const c of kd) dir.exigeColuna(c, `${fn} (direita)`);
      const nova = exigeTexto(nomeNovo, fn, 'o nome da coluna aninhada');
      if (esq.hasColumn(nova)) throw new MEvalError(`${fn}: a coluna '${nova}' já existe.`);
      const kind = tipoJoin === undefined || tipoJoin === null
        ? 'JoinKind.LeftOuter'
        : String(tipoJoin);

      // Índice do lado direito, para não varrer a tabela por linha da esquerda:
      // `protocolos-geral` tem 33 mil linhas e a junção aninhada é O(n×m) sem isto.
      const indice = new Map<string, MRow[]>();
      for (const r of dir.rows) {
        const k = chaveDe(kd.map((c) => r.get(c) ?? null));
        const lista = indice.get(k);
        if (lista) lista.push(r);
        else indice.set(k, [r]);
      }

      const ordem = [...esq.columns, nova];
      const rows: MRow[] = [];
      for (const r of esq.rows) {
        const k = chaveDe(ke.map((c) => r.get(c) ?? null));
        const casam = indice.get(k) ?? [];
        if (casam.length === 0 && REDUZEM.has(kind)) continue; // Inner e afins descartam
        if (casam.length > 0 && kind === 'JoinKind.LeftAnti') continue;
        if (casam.length === 0 && kind === 'JoinKind.LeftAnti') {
          rows.push(linha([...esq.columns.map((c) => [c, r.get(c) ?? null] as const),
            [nova, new MTable(dir.columns, [])] as const]));
          continue;
        }
        // A coluna nova é uma **tabela** por linha. Quem multiplica linha é o
        // `Table.ExpandTableColumn` depois — separar as duas coisas é o que
        // permite `Table.Distinct` no meio, como PROTOCOLOS GERAL faz.
        rows.push(linha([...esq.columns.map((c) => [c, r.get(c) ?? null] as const),
          [nova, new MTable(dir.columns, casam)] as const]));
      }
      if (!CONHECIDOS.has(kind)) {
        throw new MEvalError(
          `${fn}: JoinKind '${kind}' não implementado. Implementados: ${[...CONHECIDOS].join(', ')}.`,
        );
      }
      return new MTable(ordem, rows);
    },
  },
  {
    name: 'Table.ExpandTableColumn',
    minArgs: 3,
    maxArgs: 4,
    call: ([tv, colV, camposV, nomesV]) => {
      const fn = 'Table.ExpandTableColumn';
      const t = exigeTabela(tv, fn);
      const col = exigeTexto(colV, fn, 'a coluna a expandir');
      t.exigeColuna(col, fn);
      const campos = nomesDeColuna(camposV, fn);
      const nomes = nomesV === undefined || nomesV === null ? campos : nomesDeColuna(nomesV, fn);
      if (nomes.length !== campos.length) {
        throw new MEvalError(`${fn}: ${campos.length} campo(s) e ${nomes.length} nome(s) novo(s).`);
      }
      const restantes = t.columns.filter((c) => c !== col);
      for (const n of nomes) {
        if (restantes.includes(n)) throw new MEvalError(`${fn}: a coluna '${n}' já existe.`);
      }
      const ordem = [...restantes, ...nomes];
      const rows: MRow[] = [];
      for (const r of t.rows) {
        const dentro = r.get(col) ?? null;
        const base = restantes.map((c) => [c, r.get(c) ?? null] as const);
        if (dentro === null) {
          rows.push(linha([...base, ...nomes.map((n) => [n, null] as const)]));
          continue;
        }
        if (!isTable(dentro)) {
          throw new MEvalError(
            `${fn}: a coluna '${col}' tem ${tipoDe(dentro)}, esperava a table de uma mesclagem.`,
          );
        }
        for (const c of campos) dentro.exigeColuna(c, `${fn} (dentro de '${col}')`);
        if (dentro.rowCount === 0) {
          // LeftOuter sem par: a linha da esquerda sobrevive com null. É o que
          // mantém a contagem quando não há correspondência.
          rows.push(linha([...base, ...nomes.map((n) => [n, null] as const)]));
          continue;
        }
        // AQUI é onde a linha se multiplica: uma por par casado.
        for (const rd of dentro.rows) {
          rows.push(linha([...base, ...campos.map((c, i) => [nomes[i], rd.get(c) ?? null] as const)]));
        }
      }
      return new MTable(ordem, rows);
    },
  },
  {
    name: 'Table.SplitColumn',
    minArgs: 3,
    maxArgs: 5,
    call: ([tv, colV, splitterV, nomesV]) => {
      const fn = 'Table.SplitColumn';
      const t = exigeTabela(tv, fn);
      const col = exigeTexto(colV, fn, 'a coluna a dividir');
      t.exigeColuna(col, fn);
      const splitter = exigeFuncao(splitterV, fn, 'o divisor');
      const nomes = nomesV === undefined || nomesV === null
        ? [`${col}.1`, `${col}.2`]
        : nomesDeColuna(nomesV, fn);
      const restantes = t.columns.filter((c) => c !== col);
      for (const n of nomes) {
        if (restantes.includes(n)) throw new MEvalError(`${fn}: a coluna '${n}' já existe.`);
      }
      // A coluna dividida ocupa a posição da original, não vai para o fim: a
      // ordem de coluna é observável (`Table.ReorderColumns` depois conta com ela).
      const i = t.columns.indexOf(col);
      const ordem = [...t.columns.slice(0, i), ...nomes, ...t.columns.slice(i + 1)];
      return new MTable(
        ordem,
        t.rows.map((r) => {
          const partes = splitter.call([r.get(col) ?? null]);
          if (!isList(partes)) {
            throw new MEvalError(`${fn}: o divisor devolveu ${tipoDe(partes)}, esperava lista.`);
          }
          // Mais partes que nomes: o excedente é DESCARTADO, como o default
          // ExtraValues.Ignore do Power Query. Menos partes: o resto vem null.
          const porNome = new Map(nomes.map((n, k) => [n, partes[k] ?? null] as const));
          return linha(ordem.map((c) => [c, porNome.has(c) ? porNome.get(c)! : r.get(c) ?? null] as const));
        }),
      );
    },
  },
  {
    name: 'Table.FromRows',
    minArgs: 1,
    maxArgs: 3,
    call: ([linhasV, colunasV]) => {
      const fn = 'Table.FromRows';
      if (!isList(linhasV)) {
        throw new MEvalError(`${fn}: esperava lista de listas, veio ${tipoDe(linhasV)}.`);
      }
      const nomes = colunasV === undefined || colunasV === null
        ? null
        : nomesDeColuna(colunasV, fn);
      const linhas = linhasV.map((r, i) => {
        if (!isList(r)) {
          throw new MEvalError(`${fn}: a linha ${i} é ${tipoDe(r)}, esperava lista.`);
        }
        return r;
      });
      const largura = nomes?.length ?? linhas[0]?.length ?? 0;
      const cols = nomes ?? Array.from({ length: largura }, (_, k) => `Column${k + 1}`);
      // Linha com largura diferente do cabeçalho é erro: preencher com null
      // esconderia dado deslocado, que é o pior tipo de silêncio numa tabela
      // colada à mão (é assim que `feriados` nasce).
      for (const [i, r] of linhas.entries()) {
        if (r.length !== largura) {
          throw new MEvalError(
            `${fn}: a linha ${i} tem ${r.length} valor(es) e o cabeçalho tem ${largura}.`,
          );
        }
      }
      return new MTable(cols, linhas.map((r) => linha(cols.map((c, k) => [c, r[k]] as const))));
    },
  },
  {
    // `#table({"A","B"}, {{1,2}})` — construtor, mesma semântica de FromRows com os
    // argumentos na ordem inversa.
    //
    // O 1º argumento também pode ser o **número** de colunas, e aí os nomes viram
    // `Column1`…`ColumnN`. É a forma que `hora-atualizado` usa (`#table(1, …)`), e
    // é por isso que o passo seguinte dela renomeia "Column1".
    name: '#table',
    minArgs: 0,
    maxArgs: 2,
    call: ([colunasV, linhasV]) => {
      const fn = '#table';
      if (colunasV === undefined) return new MTable([], []);
      const nomes = typeof colunasV === 'number'
        ? Array.from({ length: colunasV }, (_, k) => `Column${k + 1}`)
        : nomesDeColuna(colunasV, fn);
      if (linhasV === undefined || linhasV === null) return new MTable(nomes, []);
      if (!isList(linhasV)) {
        throw new MEvalError(`${fn}: esperava lista de linhas, veio ${tipoDe(linhasV)}.`);
      }
      return new MTable(
        nomes,
        linhasV.map((r, i) => {
          if (!isList(r)) throw new MEvalError(`${fn}: a linha ${i} é ${tipoDe(r)}, esperava lista.`);
          if (r.length !== nomes.length) {
            throw new MEvalError(
              `${fn}: a linha ${i} tem ${r.length} valor(es) e há ${nomes.length} coluna(s).`,
            );
          }
          return linha(nomes.map((c, k) => [c, r[k]] as const));
        }),
      );
    },
  },
  {
    name: 'Table.RowCount',
    minArgs: 1,
    maxArgs: 1,
    call: ([tv]) => exigeTabela(tv, 'Table.RowCount').rowCount,
  },
  {
    name: 'Table.ColumnNames',
    minArgs: 1,
    maxArgs: 1,
    call: ([tv]) => [...exigeTabela(tv, 'Table.ColumnNames').columns],
  },
  {
    name: 'Table.Buffer',
    minArgs: 1,
    maxArgs: 1,
    // Em M é dica de materialização, não transformação. Aqui tudo já está em
    // memória, então é identidade — e dizer isso evita alguém procurar o que faz.
    call: ([tv]) => exigeTabela(tv, 'Table.Buffer'),
  },
];

const CONHECIDOS = new Set([
  'JoinKind.Inner', 'JoinKind.LeftOuter', 'JoinKind.LeftAnti',
]);
/** Junções que descartam linha da esquerda sem par. */
const REDUZEM = new Set(['JoinKind.Inner']);

// ── funções de valor ──────────────────────────────────────────────────────────

const VALOR: MFunctionImpl[] = [
  {
    name: 'Text.Upper',
    minArgs: 1,
    maxArgs: 2,
    call: ([v]) => (v === null ? null : exigeTexto(v, 'Text.Upper', 'o argumento').toUpperCase()),
  },
  {
    name: 'Text.Lower',
    minArgs: 1,
    maxArgs: 2,
    call: ([v]) => (v === null ? null : exigeTexto(v, 'Text.Lower', 'o argumento').toLowerCase()),
  },
  {
    name: 'Text.Proper',
    minArgs: 1,
    maxArgs: 2,
    call: ([v]) => {
      if (v === null) return null;
      const s = exigeTexto(v, 'Text.Proper', 'o argumento');
      // Primeira letra de cada palavra em maiúscula, resto em minúscula. Delimita
      // por espaço e por hífen, como o Power Query.
      return s.toLowerCase().replace(/(^|[\s\-/])(\p{L})/gu, (_, sep, letra) => sep + letra.toUpperCase());
    },
  },
  {
    name: 'Text.Trim',
    minArgs: 1,
    maxArgs: 2,
    call: ([v]) => (v === null ? null : exigeTexto(v, 'Text.Trim', 'o argumento').trim()),
  },
  {
    name: 'Text.Length',
    minArgs: 1,
    maxArgs: 1,
    call: ([v]) => (v === null ? null : exigeTexto(v, 'Text.Length', 'o argumento').length),
  },
  {
    name: 'Text.From',
    minArgs: 1,
    maxArgs: 2,
    call: ([v]) => {
      if (v === null) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      // Data em texto depende de culture, igual à conversão inversa. Erra alto.
      throw new MEvalError(
        `Text.From: não converte ${tipoDe(v)} para texto sem culture explícita. ` +
          'Use Date.ToText/DateTime.ToText com o formato desejado.',
      );
    },
  },
  {
    name: 'Text.Combine',
    minArgs: 1,
    maxArgs: 2,
    call: ([lista, sep]) => {
      if (!isList(lista)) {
        throw new MEvalError(`Text.Combine: esperava lista, veio ${tipoDe(lista)}.`);
      }
      const s = sep === undefined || sep === null ? '' : exigeTexto(sep, 'Text.Combine', 'o separador');
      // null na lista conta como texto vazio — é o que M faz, e é o que faz
      // `Text.Combine({[A],[B]}, " ")` não explodir quando B é nulo.
      return lista.map((x) => (x === null ? '' : exigeTexto(x, 'Text.Combine', 'um item'))).join(s);
    },
  },
  {
    name: 'Text.Start',
    minArgs: 2,
    maxArgs: 2,
    call: ([v, n]) => {
      if (v === null) return null;
      const s = exigeTexto(v, 'Text.Start', 'o texto');
      if (typeof n !== 'number') throw new MEvalError('Text.Start: a contagem deve ser número.');
      return s.slice(0, n);
    },
  },
  {
    name: 'Text.End',
    minArgs: 2,
    maxArgs: 2,
    call: ([v, n]) => {
      if (v === null) return null;
      const s = exigeTexto(v, 'Text.End', 'o texto');
      if (typeof n !== 'number') throw new MEvalError('Text.End: a contagem deve ser número.');
      return n <= 0 ? '' : s.slice(-n);
    },
  },
  {
    name: 'Text.BeforeDelimiter',
    minArgs: 2,
    maxArgs: 3,
    call: ([v, delim]) => {
      if (v === null) return null;
      const s = exigeTexto(v, 'Text.BeforeDelimiter', 'o texto');
      const d = exigeTexto(delim, 'Text.BeforeDelimiter', 'o delimitador');
      const i = s.indexOf(d);
      // Sem o delimitador, M devolve texto vazio — não o texto inteiro.
      return i < 0 ? '' : s.slice(0, i);
    },
  },
  {
    name: 'Text.AfterDelimiter',
    minArgs: 2,
    maxArgs: 3,
    call: ([v, delim]) => {
      if (v === null) return null;
      const s = exigeTexto(v, 'Text.AfterDelimiter', 'o texto');
      const d = exigeTexto(delim, 'Text.AfterDelimiter', 'o delimitador');
      const i = s.indexOf(d);
      return i < 0 ? '' : s.slice(i + d.length);
    },
  },
  {
    name: 'Text.Contains',
    minArgs: 2,
    maxArgs: 3,
    call: ([v, sub]) => {
      if (v === null) return null;
      return exigeTexto(v, 'Text.Contains', 'o texto')
        .includes(exigeTexto(sub, 'Text.Contains', 'o trecho'));
    },
  },
  {
    name: 'Text.Replace',
    minArgs: 3,
    maxArgs: 3,
    call: ([v, de, para]) => {
      if (v === null) return null;
      return exigeTexto(v, 'Text.Replace', 'o texto').replaceAll(
        exigeTexto(de, 'Text.Replace', 'o trecho antigo'),
        exigeTexto(para, 'Text.Replace', 'o trecho novo'),
      );
    },
  },
  {
    name: 'Number.From',
    minArgs: 1,
    maxArgs: 2,
    call: ([v], ctx) => {
      if (v === null) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      const n = textoParaNumero(v, ctx.culture);
      if (n !== null) return n;
      throw new MEvalError(
        `Number.From: não converte ${tipoDe(v)} — ${dicaDeNumero(v, ctx.culture)}.`,
      );
    },
  },
  {
    name: 'DateTime.Date',
    minArgs: 1,
    maxArgs: 1,
    call: ([v]) => {
      if (v === null) return null;
      if (!(v instanceof Date)) {
        throw new MEvalError(`DateTime.Date: esperava datetime, veio ${tipoDe(v)}.`);
      }
      return soData(v);
    },
  },
  {
    name: 'DateTime.Time',
    minArgs: 1,
    maxArgs: 1,
    call: ([v]) => {
      if (v === null) return null;
      if (!(v instanceof Date)) {
        throw new MEvalError(`DateTime.Time: esperava datetime, veio ${tipoDe(v)}.`);
      }
      return horaDe(v);
    },
  },
  {
    name: 'DateTime.LocalNow',
    minArgs: 0,
    maxArgs: 0,
    call: (_a, ctx) => ctx.agora,
  },
  {
    name: 'DateTimeZone.LocalNow',
    minArgs: 0,
    maxArgs: 0,
    call: (_a, ctx) => ctx.agora,
  },
  {
    name: 'DateTimeZone.SwitchZone',
    minArgs: 2,
    maxArgs: 3,
    call: ([v, horas], _ctx) => {
      if (v === null) return null;
      if (!(v instanceof Date)) {
        throw new MEvalError(`DateTimeZone.SwitchZone: esperava datetime, veio ${tipoDe(v)}.`);
      }
      if (typeof horas !== 'number') {
        throw new MEvalError('DateTimeZone.SwitchZone: o fuso deve ser número de horas.');
      }
      // Sem tz-database: o valor viaja como instante e o deslocamento é aplicado
      // ao relógio. É o suficiente para `hora-atualizado`, que só quer -3.
      return new Date(v.getTime() + horas * 3_600_000);
    },
  },
  {
    name: 'Date.From',
    minArgs: 1,
    maxArgs: 2,
    call: ([v], ctx) => {
      if (v === null) return null;
      if (v instanceof Date) return soData(v);
      // `Date.From(45000)` é número de série, como no Excel. Mesma conversão que
      // `type date` aplica.
      if (typeof v === 'number') return soData(dataDeSerial(v));
      const d = textoParaData(v, ctx.culture);
      if (d) return soData(d);
      throw new MEvalError(
        `Date.From: não converte ${tipoDe(v)} para data — ` +
          `${formatoDeTexto(v, ctx.culture) || 'tipo não suportado'}.`,
      );
    },
  },
  {
    name: 'Date.AddDays',
    minArgs: 2,
    maxArgs: 2,
    call: ([v, n]) => {
      if (v === null) return null;
      if (!(v instanceof Date)) throw new MEvalError(`Date.AddDays: esperava data, veio ${tipoDe(v)}.`);
      if (typeof n !== 'number') throw new MEvalError('Date.AddDays: o incremento deve ser número.');
      return new Date(v.getTime() + n * 86_400_000);
    },
  },
  {
    name: 'Date.AddMonths',
    minArgs: 2,
    maxArgs: 2,
    call: ([v, n]) => {
      if (v === null) return null;
      if (!(v instanceof Date)) throw new MEvalError(`Date.AddMonths: esperava data, veio ${tipoDe(v)}.`);
      if (typeof n !== 'number') throw new MEvalError('Date.AddMonths: o incremento deve ser número.');
      // 31/01 + 1 mês = 28/02 (ou 29): o dia satura no fim do mês, como no M.
      // `new Date` sozinho viraria 03/03, e o mês inteiro do relatório sairia
      // deslocado sem erro nenhum.
      const ano = v.getUTCFullYear();
      const mes = v.getUTCMonth() + n;
      const dia = v.getUTCDate();
      const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
      return new Date(Date.UTC(ano, mes, Math.min(dia, ultimo),
        v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds(), v.getUTCMilliseconds()));
    },
  },
  {
    name: 'Duration.Days',
    minArgs: 1,
    maxArgs: 1,
    call: ([v]) => {
      if (v === null) return null;
      if (!(v instanceof MDuration)) {
        throw new MEvalError(`Duration.Days: esperava duration, veio ${tipoDe(v)}.`);
      }
      return Math.trunc(v.ms / 86_400_000);
    },
  },
  {
    name: '#date',
    minArgs: 3,
    maxArgs: 3,
    call: (args) => {
      const [a, m, d] = args.map((x, i) => {
        if (typeof x !== 'number') {
          throw new MEvalError(`#date: o argumento ${i + 1} é ${tipoDe(x)}, esperava número.`);
        }
        return x;
      });
      const dt = new Date(Date.UTC(a, m - 1, d));
      // `#date(2026,2,30)` é erro em M, não 2 de março.
      if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        throw new MEvalError(`#date(${a},${m},${d}) não é uma data válida.`);
      }
      return dt;
    },
  },
  {
    name: '#datetime',
    minArgs: 6,
    maxArgs: 6,
    call: (args) => {
      const n = args.map((x, i) => {
        if (typeof x !== 'number') {
          throw new MEvalError(`#datetime: o argumento ${i + 1} é ${tipoDe(x)}, esperava número.`);
        }
        return x;
      });
      return new Date(Date.UTC(n[0], n[1] - 1, n[2], n[3], n[4], n[5]));
    },
  },
  {
    name: '#duration',
    minArgs: 4,
    maxArgs: 4,
    call: (args) => {
      const [d, h, m, s] = args.map((x, i) => {
        if (typeof x !== 'number') {
          throw new MEvalError(`#duration: o argumento ${i + 1} é ${tipoDe(x)}, esperava número.`);
        }
        return x;
      });
      return new MDuration(((d * 24 + h) * 60 + m) * 60_000 + s * 1000);
    },
  },
  {
    name: 'List.Count',
    minArgs: 1,
    maxArgs: 1,
    call: ([v]) => {
      if (!isList(v)) throw new MEvalError(`List.Count: esperava lista, veio ${tipoDe(v)}.`);
      return v.length;
    },
  },
  {
    name: 'List.Contains',
    minArgs: 2,
    maxArgs: 3,
    call: ([v, alvo]) => {
      if (!isList(v)) throw new MEvalError(`List.Contains: esperava lista, veio ${tipoDe(v)}.`);
      return v.some((x) => igual(x, alvo));
    },
  },
  {
    name: 'List.Transform',
    minArgs: 2,
    maxArgs: 2,
    call: ([v, f]) => {
      if (!isList(v)) throw new MEvalError(`List.Transform: esperava lista, veio ${tipoDe(v)}.`);
      const fn = exigeFuncao(f, 'List.Transform', 'a transformação');
      return v.map((x) => aplica1(fn, x));
    },
  },
  {
    name: 'Record.Field',
    minArgs: 2,
    maxArgs: 2,
    call: ([r, nome]) => {
      if (!isRecord(r)) throw new MEvalError(`Record.Field: esperava registro, veio ${tipoDe(r)}.`);
      return r.get(exigeTexto(nome, 'Record.Field', 'o nome do campo'));
    },
  },
];

// ── binário: a tabela embutida de `feriados` ──────────────────────────────────
//
// `feriados` não lê fonte externa: a tabela foi **colada** no Power Query e o
// Power BI a guardou como base64 de um deflate de JSON. São três funções puras
// encadeadas, então dá para executar essa query sem credencial nenhuma — e é a
// única do escopo em que isso vale.

const BINARIO: MFunctionImpl[] = [
  {
    name: 'Binary.FromText',
    minArgs: 1,
    maxArgs: 2,
    call: ([texto, encoding]) => {
      const s = exigeTexto(texto, 'Binary.FromText', 'o texto');
      const enc = encoding === undefined || encoding === null ? 'BinaryEncoding.Base64' : String(encoding);
      if (enc === 'BinaryEncoding.Base64') return new Uint8Array(Buffer.from(s, 'base64'));
      if (enc === 'BinaryEncoding.Hex') return new Uint8Array(Buffer.from(s, 'hex'));
      throw new MEvalError(`Binary.FromText: encoding '${enc}' não implementado.`);
    },
  },
  {
    name: 'Binary.Decompress',
    minArgs: 2,
    maxArgs: 2,
    call: ([bin, compressao]) => {
      if (!(bin instanceof Uint8Array)) {
        throw new MEvalError(`Binary.Decompress: esperava binário, veio ${tipoDe(bin)}.`);
      }
      const modo = String(compressao);
      // `Compression.Deflate` do M é deflate **cru** (sem cabeçalho zlib):
      // `inflateSync` falharia com "incorrect header check".
      if (modo === 'Compression.Deflate') return new Uint8Array(zlib.inflateRawSync(bin));
      if (modo === 'Compression.GZip') return new Uint8Array(zlib.gunzipSync(bin));
      if (modo === 'Compression.None') return bin;
      throw new MEvalError(`Binary.Decompress: compressão '${modo}' não implementada.`);
    },
  },
  {
    name: 'Json.Document',
    minArgs: 1,
    maxArgs: 2,
    call: ([bin]) => {
      const texto = bin instanceof Uint8Array
        ? Buffer.from(bin).toString('utf8')
        : exigeTexto(bin, 'Json.Document', 'o conteúdo');
      let json: unknown;
      try {
        json = JSON.parse(texto);
      } catch (err) {
        throw new MEvalError(
          `Json.Document: conteúdo não é JSON válido (${err instanceof Error ? err.message : err}).`,
        );
      }
      return deJson(json);
    },
  },
];

/** JSON para valor M: objeto vira registro, array vira lista. */
function deJson(v: unknown): MValue {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(deJson);
  if (typeof v === 'object') {
    return new MRecord(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, deJson(x)] as const));
  }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  throw new MEvalError(`Json.Document: valor de tipo ${typeof v} não suportado.`);
}

// ── substituidores e comparadores ────────────────────────────────────────────

const AUXILIARES: MFunctionImpl[] = [
  {
    // `Replacer.ReplaceValue(atual, velho, novo)`: troca o valor inteiro se casar.
    name: 'Replacer.ReplaceValue',
    minArgs: 3,
    maxArgs: 3,
    call: ([atual, velho, novo]) => (igual(atual, velho) ? novo : atual),
  },
  {
    // `Replacer.ReplaceText`: troca **dentro** do texto, todas as ocorrências.
    name: 'Replacer.ReplaceText',
    minArgs: 3,
    maxArgs: 3,
    call: ([atual, velho, novo]) => {
      if (atual === null) return null;
      const s = exigeTexto(atual, 'Replacer.ReplaceText', 'o valor atual');
      const de = exigeTexto(velho, 'Replacer.ReplaceText', 'o trecho antigo');
      const para = novo === null ? '' : exigeTexto(novo, 'Replacer.ReplaceText', 'o trecho novo');
      return de === '' ? s : s.replaceAll(de, para);
    },
  },
  {
    name: 'Splitter.SplitTextByDelimiter',
    minArgs: 1,
    maxArgs: 2,
    call: ([delim]) => {
      const d = exigeTexto(delim, 'Splitter.SplitTextByDelimiter', 'o delimitador');
      // Devolve uma FUNÇÃO: é o que Table.SplitColumn consome.
      return {
        kind: 'function' as const,
        arity: 1,
        call: (args: readonly MValue[]) => {
          const v = args[0];
          if (v === null) return [null];
          return exigeTexto(v, 'Splitter.SplitTextByDelimiter', 'o texto').split(d);
        },
      };
    },
  },
];

// ── ordenação ─────────────────────────────────────────────────────────────────

interface Criterio {
  readonly coluna: string;
  readonly desc: boolean;
}

/** `{{"col", Order.Descending}}`, `{"col", Order.Ascending}` ou `"col"`. */
function criteriosDeOrdem(v: MValue, t: MTable): Criterio[] {
  const um = (item: MValue): Criterio => {
    if (typeof item === 'string') {
      t.exigeColuna(item, 'Table.Sort');
      return { coluna: item, desc: false };
    }
    if (isList(item) && item.length >= 1 && typeof item[0] === 'string') {
      const ordem = item[1];
      const desc = ordem === 'Order.Descending' || ordem === 1;
      if (ordem !== undefined && !desc && ordem !== 'Order.Ascending' && ordem !== 0) {
        throw new MEvalError(`Table.Sort: ordem '${String(ordem)}' desconhecida.`);
      }
      t.exigeColuna(item[0], 'Table.Sort');
      return { coluna: item[0], desc };
    }
    throw new MEvalError(`Table.Sort: critério inválido (${tipoDe(item)}).`);
  };
  if (typeof v === 'string') return [um(v)];
  if (!isList(v)) throw new MEvalError(`Table.Sort: esperava critério, veio ${tipoDe(v)}.`);
  // Par solto `{"col", Order.Descending}` vs. lista de pares `{{...},{...}}`.
  if (v.length >= 1 && typeof v[0] === 'string') return [um(v)];
  return v.map(um);
}

/**
 * Ordem entre dois valores.
 *
 * `null` vem **primeiro** em ordem ascendente, como no Power Query. Texto compara
 * por código de caractere (ordinal), não por locale: `localeCompare` colocaria
 * "Á" junto de "A" e mudaria qual linha sobrevive a um `Table.Distinct` depois.
 */
function ordena(a: MValue, b: MValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const ta = a instanceof Date ? a.getTime() : a instanceof MTime ? a.ms : a instanceof MDuration ? a.ms : null;
  const tb = b instanceof Date ? b.getTime() : b instanceof MTime ? b.ms : b instanceof MDuration ? b.ms : null;
  if (ta !== null && tb !== null) return ta < tb ? -1 : ta > tb ? 1 : 0;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  throw new MEvalError(`Table.Sort: não sei ordenar ${tipoDe(a)} com ${tipoDe(b)}.`);
}

/**
 * Chave de igualdade para agrupar (`Distinct`, junção).
 *
 * O tipo entra na chave: sem isso, o número `1` e o texto `"1"` casariam numa
 * mesclagem, e uma junção por código de equipe passaria a casar coisa errada
 * dependendo de a fonte devolver o campo como texto ou como inteiro.
 */
function chaveDe(valores: readonly MValue[]): string {
  return valores
    .map((v) => {
      if (v === null) return 'n:';
      if (v instanceof Date) return `d:${v.getTime()}`;
      if (v instanceof MTime) return `t:${v.ms}`;
      if (v instanceof MDuration) return `u:${v.ms}`;
      if (typeof v === 'string') return `s:${v}`;
      if (typeof v === 'number') return `f:${v}`;
      if (typeof v === 'boolean') return `b:${v}`;
      throw new MEvalError(`Valor de tipo ${tipoDe(v)} não serve como chave.`);
    })
    .join('\u0000');
}


// ── constantes de enumeração e de tipo ────────────────────────────────────────

/**
 * `Order.Ascending`, `JoinKind.LeftOuter`, `Int64.Type`: identificadores que não
 * são função nem passo, e que em M são **valores de enumeração**.
 *
 * Cada um avalia para o próprio nome, como texto. Não é gambiarra: o que as
 * funções precisam é distinguir um do outro, e o nome já é o identificador único.
 * Um enum como objeto opaco daria a mesma coisa com mais cerimônia e mensagens de
 * erro piores (`[object Object]` em vez de `JoinKind.FullOuter`).
 *
 * **A lista é allowlist de propósito.** Enum desconhecido cai no erro de nome não
 * encontrado, e é o que se quer: `Order.Decreasing` (que não existe) viraria uma
 * string qualquer e o `Table.Sort` ordenaria ascendente em silêncio.
 */
const ENUMS: readonly string[] = [
  // usados pelo corpus
  'JoinKind.Inner', 'JoinKind.LeftOuter', 'JoinKind.RightOuter', 'JoinKind.FullOuter',
  'JoinKind.LeftAnti', 'JoinKind.RightAnti',
  'Order.Ascending', 'Order.Descending',
  'QuoteStyle.Csv', 'QuoteStyle.None',
  'BinaryEncoding.Base64', 'BinaryEncoding.Hex',
  // Acompanha `Binary.Decompress` na tabela colada à mão de `feriados`. Faltava, e
  // o teste de cobertura contra o corpus é que apontou.
  'Compression.Deflate', 'Compression.GZip', 'Compression.None',
  // não aparecem hoje, mas são os default de funções que aparecem — deixar de
  // fora faria a query quebrar só quando alguém tornasse o default explícito
  'Occurrence.First', 'Occurrence.Last', 'Occurrence.All',
  'ExtraValues.List', 'ExtraValues.Error', 'ExtraValues.Ignore',
  'MissingField.Error', 'MissingField.Ignore', 'MissingField.UseNull',
  'JoinAlgorithm.Dynamic', 'JoinAlgorithm.SortMerge',
  'Precision.Double', 'Precision.Decimal',
  'RoundingMode.Up', 'RoundingMode.Down', 'RoundingMode.AwayFromZero',
  'RoundingMode.TowardZero', 'RoundingMode.ToEven',
];

/**
 * Identificadores de tipo na forma `X.Type`.
 *
 * São o outro jeito de escrever `type X` — `Int64.Type` e `type number` chegam à
 * mesma conversão. `converte()` aceita as duas grafias por isso.
 */
const TIPOS: readonly string[] = [
  'Any.Type', 'Text.Type', 'Number.Type', 'Int64.Type', 'Int32.Type', 'Int16.Type',
  'Byte.Type', 'Double.Type', 'Single.Type', 'Decimal.Type', 'Currency.Type',
  'Percentage.Type', 'Logical.Type', 'Date.Type', 'DateTime.Type', 'DateTimeZone.Type',
  'Time.Type', 'Duration.Type', 'Binary.Type', 'Guid.Type',
  'Table.Type', 'Record.Type', 'List.Type', 'Function.Type', 'Type.Type', 'None.Type',
];

/** Constantes que o avaliador resolve por nome, antes de procurar função. */
export function standardConstants(): ReadonlyMap<string, MValue> {
  const m = new Map<string, MValue>();
  for (const nome of [...ENUMS, ...TIPOS]) m.set(nome, nome);
  return m;
}

// ── a tabela ──────────────────────────────────────────────────────────────────

export function standardFunctions(): MFunctionTable {
  const m = new Map<string, MFunctionImpl>();
  for (const f of [...TABELA, ...VALOR, ...BINARIO, ...AUXILIARES]) {
    if (m.has(f.name)) throw new Error(`Função M duplicada na tabela: ${f.name}`);
    m.set(f.name, f);
  }
  return m;
}

/** Nomes implementados, para o teste de cobertura contra o corpus. */
export function implementedMFunctions(): string[] {
  return [...standardFunctions().keys()].sort();
}

export { type MCallContext };
