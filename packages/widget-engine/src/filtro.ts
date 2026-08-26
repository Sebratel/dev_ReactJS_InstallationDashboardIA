// Filtro de spec -> `TableFilter` do measure-engine.

import { normalizeName as normaliza } from '../../semantic-model/src/model.ts';
import type { Position } from '../../measure-engine/src/ast.ts';
import type { EvalScope, Evaluator } from '../../measure-engine/src/evaluator.ts';
import {
  NIVEIS_DE_HIERARQUIA,
  projecaoDeHierarquia,
} from '../../measure-engine/src/evaluator.ts';
import type { TableFilter } from '../../measure-engine/src/filter.ts';
import type { Row } from '../../measure-engine/src/dataset.ts';
import {
  DaxEvalError,
  type DaxValue,
  compareValues,
  identityKey,
  isBlank,
} from '../../measure-engine/src/value.ts';
import { resolveBorda, resolveSpan, truncar } from './datas.ts';
import type { CondicaoSpec, FiltroSpec, SpanSpec } from './spec.ts';
import { FUNCAO_DA_AGREGACAO } from './card.ts';

const COMPARA: Record<string, (c: number) => boolean> = {
  eq: (c) => c === 0,
  gt: (c) => c > 0,
  ge: (c) => c >= 0,
  lt: (c) => c < 0,
  le: (c) => c <= 0,
};

const SUBDIA = new Set(['second', 'minute', 'hour']);
const SEM_POSICAO: Position = { start: 0, line: 1, col: 1 };

function ehSpan(r: unknown): r is SpanSpec {
  return typeof r === 'object' && r !== null && 'anchor_kind' in r;
}

export function ehFiltroDeGrupo(f: FiltroSpec): boolean {
  return (f.conditions ?? []).some((c) => c.op === 'comparison' && !!c.left_aggregation);
}

export function separaFiltros(filtros: readonly FiltroSpec[]): {
  deLinha: FiltroSpec[];
  deGrupo: FiltroSpec[];
} {
  const deLinha: FiltroSpec[] = [];
  const deGrupo: FiltroSpec[] = [];
  for (const f of filtros) (ehFiltroDeGrupo(f) ? deGrupo : deLinha).push(f);
  return { deLinha, deGrupo };
}

export function predicadoDeGrupo(
  f: FiltroSpec,
  ev: Evaluator,
  onde: string,
): { origem: string; passa: (escopo: EvalScope) => boolean } {
  if (!f.entity || !f.property) {
    throw new DaxEvalError(`${onde}: filtro de grupo sem tabela ou coluna.`);
  }
  const rotulo = `${onde}: filtro de grupo ${f.type ?? '?'} '${f.entity}'[${f.property}]`;
  const condicoes = f.conditions ?? [];
  if (!condicoes.length) throw new DaxEvalError(`${rotulo}: sem condição.`);

  const testes = condicoes.map((c) => {
    if (c.op !== 'comparison' || !c.left_aggregation) {
      throw new DaxEvalError(
        `${rotulo}: mistura condição sobre agregado com condição sobre linha ` +
          `(op '${c.op}'). As duas se aplicam em momentos diferentes — antes e depois ` +
          `de agrupar — e nenhum filtro do relatório faz isso.`,
      );
    }
    const aceita = COMPARA[c.kind];
    if (!aceita) {
      throw new DaxEvalError(`${rotulo}: comparação '${c.kind}' sem tradução.`);
    }
    if (c.right === null || typeof c.right === 'object') {
      throw new DaxEvalError(
        `${rotulo}: filtro sobre agregado comparado com ${JSON.stringify(c.right)}. ` +
          `Os 10 do relatório comparam com número.`,
      );
    }
    const funcao = FUNCAO_DA_AGREGACAO[c.left_aggregation];
    if (!funcao) {
      throw new DaxEvalError(
        `${rotulo}: agregação '${c.left_aggregation}' sem função DAX. ` +
          `Conhecidas: ${Object.keys(FUNCAO_DA_AGREGACAO).join(', ')}.`,
      );
    }
    const alvo = c.right as DaxValue;
    const inverte = c.negado === true;
    const coluna = c.left_property ?? f.property!;

    return (escopo: EvalScope): boolean => {
      const valor = ev.evaluate(
        {
          type: 'Call',
          name: funcao,
          args: [{ type: 'ColumnRef', table: f.entity!, column: coluna, pos: SEM_POSICAO }],
          pos: SEM_POSICAO,
        },
        escopo,
      );
      if (isBlank(valor)) return inverte;
      return aceita(compareValues(valor, alvo, false, rotulo)) !== inverte;
    };
  });

  return { origem: rotulo, passa: (escopo) => testes.every((t) => t(escopo)) };
}

export function traduzFiltros(
  filtros: readonly FiltroSpec[],
  ev: Evaluator,
  onde: string,
): TableFilter[] {
  const out: TableFilter[] = [];
  for (const f of filtros) {
    if (!f.entity || !f.property) {
      throw new DaxEvalError(
        `${onde}: filtro ${f.name ?? '(sem nome)'} sem tabela ou coluna ` +
          `(entity=${JSON.stringify(f.entity)}, property=${JSON.stringify(f.property)}).`,
      );
    }
    const rotulo = `${onde}: filtro ${f.type ?? '?'} '${f.entity}'[${f.property}]`;
    if (!f.conditions?.length) {
      throw new DaxEvalError(
        `${rotulo}: sem condição. Cartão de filtro vazio não deveria chegar até aqui — ` +
          `o extrator os conta em 'filters_vazios' e não os grava em 'filters'.`,
      );
    }

    const predicados = f.conditions.map((c) => predicado(c, f, ev, rotulo));
    out.push({
      table: normaliza(f.entity),
      columns: new Set([normaliza(f.property)]),
      origem: rotulo,
      keep: (row: Row) => predicados.every((p) => p(row)),
    });
  }
  return out;
}

function leitorDeValor(f: FiltroSpec, ev: Evaluator, onde: string): (row: Row) => DaxValue {
  const tabela = f.entity!;
  const coluna = f.property!;
  if (!f.nivel) return (row: Row) => ev.columnValue(tabela, coluna, row);

  const projeta = projecaoDeHierarquia(f.nivel);
  if (!projeta) {
    throw new DaxEvalError(
      `${onde}: nível de hierarquia de datas não suportado: ` +
        `'${tabela}'[${coluna}].[${f.nivel}]. Suportados: ${NIVEIS_DE_HIERARQUIA.join(', ')}.`,
    );
  }

  return (row: Row): DaxValue => {
    const cru = ev.columnValue(tabela, coluna, row);
    if (isBlank(cru)) return cru;
    if (!(cru instanceof Date)) {
      throw new DaxEvalError(
        `${onde}: o filtro pede o nível [${f.nivel}] de '${tabela}'[${coluna}], mas a ` +
          `coluna tem ${typeof cru}, não data. Nível de hierarquia só existe sobre data.`,
      );
    }
    return projeta(cru);
  };
}

function predicado(
  c: CondicaoSpec,
  f: FiltroSpec,
  ev: Evaluator,
  onde: string,
): (row: Row) => boolean {
  const tabela = f.entity!;
  const coluna = f.property!;
  const valor = leitorDeValor(f, ev, onde);

  if (c.op === 'comparison' && c.left_aggregation) {
    throw new DaxEvalError(
      `${onde}: o filtro compara ${c.left_aggregation.toUpperCase()}([${c.left_property}]) ` +
        `e não [${c.left_property}] — é filtro sobre valor agregado (HAVING), que decide ` +
        `quais grupos o visual mostra. Como predicado de linha ele vira outro filtro, ` +
        `e num campo numérico aceitaria quase tudo sem erro nenhum. ` +
        `Implementá-lo exige o agrupamento do visual (tabela/gráfico), que ainda não existe.`,
    );
  }

  const daCondicao = c.op === 'comparison' ? c.left_property : c.op === 'between_relativo' ? c.property : null;
  if (daCondicao != null && normaliza(daCondicao) !== normaliza(coluna)) {
    throw new DaxEvalError(
      `${onde}: a condição fala de [${daCondicao}] e o filtro de [${coluna}]. ` +
        `Aplicar numa pela outra daria número errado sem erro nenhum.`,
    );
  }

  switch (c.op) {
    case 'in':
    case 'not_in': {
      const permitidos = new Set((c.values ?? []).map(identityKey));
      const dentro = c.op === 'in';
      let conferiuEspecie = false;
      return (row) => {
        const v = valor(row);
        if (!conferiuEspecie) {
          conferiuEspecie = true;
          confereEspecie(v, c.values ?? [], onde);
        }
        return permitidos.has(identityKey(v)) === dentro;
      };
    }

    case 'comparison': {
      const inverte = c.negado === true;
      const aceita = COMPARA[c.kind];
      if (!aceita) {
        throw new DaxEvalError(
          `${onde}: comparação '${c.kind}' sem tradução. Conhecidas: ${Object.keys(COMPARA).join(', ')}.`,
        );
      }

      if (c.right === null) {
        if (c.kind !== 'eq') {
          throw new DaxEvalError(`${onde}: comparação '${c.kind}' contra null não tem leitura óbvia.`);
        }
        return (row) => isBlank(valor(row)) !== inverte;
      }

      if (ehSpan(c.right)) {
        const span = c.right;
        const unidade = span.time_unit;
        if (typeof unidade !== 'string') {
          throw new DaxEvalError(`${onde}: DateSpan sem unidade de tempo.`);
        }
        const alvo = resolveSpan(span, ev.now, onde);

        if (c.kind === 'eq') {
          return (row) => {
            const v = valor(row);
            if (isBlank(v)) return inverte;
            const truncado = truncar(exigeData(v, onde), unidade, onde);
            return (truncado.getTime() === alvo.getTime()) !== inverte;
          };
        }

        if (!SUBDIA.has(unidade)) {
          throw new DaxEvalError(
            `${onde}: comparação '${c.kind}' contra DateSpan de '${unidade}'. ` +
              `Acima do dia o span é intervalo, e não está estabelecido se o Power BI ` +
              `compara com o início ou com o fim dele. Nenhum filtro do relatório de ` +
              `hoje faz isso — se passou a fazer, a convenção precisa ser conferida na tela.`,
          );
        }
        return (row) => {
          const v = valor(row);
          if (isBlank(v)) return inverte;
          return aceita(compareValues(v, alvo, false, onde)) !== inverte;
        };
      }

      if (typeof c.right === 'object') {
        throw new DaxEvalError(
          `${onde}: lado direito da comparação sem tradução: ${JSON.stringify(c.right)}.`,
        );
      }

      const literal = c.right as DaxValue;
      let conferiuEspecie = false;
      return (row) => {
        const v = valor(row);
        if (!conferiuEspecie) {
          conferiuEspecie = true;
          confereEspecie(v, [literal], onde);
        }
        if (isBlank(v)) return inverte;
        return aceita(compareValues(v, literal, false, onde)) !== inverte;
      };
    }

    case 'between_relativo': {
      const de = resolveBorda(c.lower, ev.now, `${onde} (limite inferior)`);
      const ate = resolveBorda(c.upper, ev.now, `${onde} (limite superior)`);
      if (de.getTime() > ate.getTime()) {
        throw new DaxEvalError(
          `${onde}: janela invertida — de ${de.toISOString()} até ${ate.toISOString()}. ` +
            `Nenhuma linha passaria, e o card mostraria vazio como se não houvesse dado.`,
        );
      }
      return (row) => {
        const v = valor(row);
        if (isBlank(v)) return false;
        const t = exigeData(v, onde).getTime();
        return t >= de.getTime() && t <= ate.getTime();
      };
    }

    case 'desconhecido':
      throw new DaxEvalError(
        `${onde}: condição que o extrator não traduziu: ${JSON.stringify(c.raw)}. ` +
          `Ela existe no PBIP e não pode ser ignorada — o lugar de traduzi-la é ` +
          `tools/extractor (traduzCondicao).`,
      );

    default: {
      const desconhecida = c as { op?: unknown };
      throw new DaxEvalError(`${onde}: operador de filtro não suportado: ${JSON.stringify(desconhecida.op)}.`);
    }
  }
}

function exigeData(v: DaxValue, onde: string): Date {
  if (v instanceof Date) return v;
  throw new DaxEvalError(
    `${onde}: filtro de data sobre valor ${JSON.stringify(v)}, que não é data. ` +
      `Várias colunas desta base chegam como texto DD/MM/YYYY — comparar direto ` +
      `ordenaria por dia e daria um número plausível e errado.`,
  );
}

function confereEspecie(v: DaxValue, valores: readonly DaxValue[], onde: string): void {
  const doDado = especie(v);
  if (!doDado) return;
  for (const alvo of valores) {
    const doFiltro = especie(alvo);
    if (doFiltro && doFiltro !== doDado) {
      throw new DaxEvalError(
        `${onde}: o filtro compara ${doFiltro} com ${doDado} (dado: ${JSON.stringify(v)}, ` +
          `filtro: ${JSON.stringify(alvo)}). Nunca casa, e o card sairia vazio como se ` +
          `o filtro estivesse apenas apertado.`,
      );
    }
  }
}

function especie(v: DaxValue): string | null {
  if (isBlank(v)) return null;
  if (v instanceof Date) return 'data';
  return typeof v === 'number' ? 'número' : typeof v === 'boolean' ? 'booleano' : 'texto';
}
