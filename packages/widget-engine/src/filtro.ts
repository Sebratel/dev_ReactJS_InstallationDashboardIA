// Filtro de spec -> `TableFilter` do measure-engine.
//
// **Onde está o número errado que este arquivo evita.** Um card computado sem o
// filtro dele mostra o total geral com cara de total filtrado. Foi por isso que a
// Fase 3 começou pelos filtros (ACHADOS #27) e não pelo cálculo.
//
// **A regra que dá forma ao arquivo, e é fácil errar:** filtro de página e filtro
// de visual sobre a **mesma coluna** se somam (E), não se substituem. No
// measure-engine, `FilteredContext.with()` implementa a substituição do DAX — filtro
// novo derruba o antigo que toque a mesma coluna. Aplicar em duas etapas
// (`.with(pagina).with(visual)`) faria o filtro de visual **apagar** o da página e
// alargar o número em silêncio. Por isso `traduzFiltros` devolve uma lista só, para
// um `with()` único: dentro de um mesmo `with()` os filtros novos não se substituem
// entre si.

import { normalizeName as normaliza } from '../../semantic-model/src/model.ts';
import type { Position } from '../../measure-engine/src/ast.ts';
import type { EvalScope, Evaluator } from '../../measure-engine/src/evaluator.ts';
import type { TableFilter } from '../../measure-engine/src/filter.ts';
import type { Row } from '../../measure-engine/src/dataset.ts';
import {
  DaxEvalError,
  type DaxValue,
  compareValues,
  identityKey,
  isBlank,
} from '../../measure-engine/src/value.ts';
import { FUNCAO_DA_AGREGACAO } from './agregacao.ts';
import { resolveBorda, resolveSpan, truncar } from './datas.ts';
import type { CondicaoSpec, FiltroSpec, SpanSpec } from './spec.ts';

/** Comparações que a spec pode trazer, e o sinal que cada uma aceita. */
const COMPARA: Record<string, (c: number) => boolean> = {
  eq: (c) => c === 0,
  gt: (c) => c > 0,
  ge: (c) => c >= 0,
  lt: (c) => c < 0,
  le: (c) => c <= 0,
};

/** Unidades abaixo do dia. Nelas um `DateSpan` é um instante, não um intervalo. */
const SUBDIA = new Set(['second', 'minute', 'hour']);

/** Nó sintético: não veio de texto, então não há posição real a apontar. */
const SEM_POSICAO: Position = { start: 0, line: 1, col: 1 };

function ehSpan(r: unknown): r is SpanSpec {
  return typeof r === 'object' && r !== null && 'anchor_kind' in r;
}

/**
 * O filtro age sobre **linha** ou sobre **grupo**?
 *
 * `left_aggregation` é o que separa os dois: com ele, o lado esquerdo da comparação
 * é `COUNT(coluna)`, e a pergunta passa a ser sobre o grupo inteiro. São 10 no
 * relatório (ACHADOS #30).
 */
export function ehFiltroDeGrupo(f: FiltroSpec): boolean {
  return (f.conditions ?? []).some((c) => c.op === 'comparison' && !!c.left_aggregation);
}

/** Separa os dois tipos. Um filtro é inteiro de um ou de outro — ver `predicadoDeGrupo`. */
export function separaFiltros(filtros: readonly FiltroSpec[]): {
  deLinha: FiltroSpec[];
  deGrupo: FiltroSpec[];
} {
  const deLinha: FiltroSpec[] = [];
  const deGrupo: FiltroSpec[] = [];
  for (const f of filtros) (ehFiltroDeGrupo(f) ? deGrupo : deLinha).push(f);
  return { deLinha, deGrupo };
}

/**
 * Traduz um filtro sobre valor agregado num predicado de **grupo** (o HAVING).
 *
 * Ele recebe o escopo do grupo — já com os filtros do grupo aplicados — e avalia a
 * agregação ali dentro. É por isso que ele não podia existir antes do agrupamento:
 * sem grupo não há o que agregar, e aplicado ao valor cru vira outro filtro
 * (ACHADOS #30).
 *
 * **A função de agregação sai do mesmo mapa dos campos de visual**, e isso liga
 * este filtro à pergunta em aberto PERGUNTAS-NEGOCIO #6: se `count` for contagem de
 * não-vazios em vez de distinta, muda aqui junto. Ligar de propósito, num mapa só —
 * duas cópias divergiriam no dia da resposta.
 */
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
      // Um filtro que mistura condição de grupo e de linha teria de ser aplicado em
      // dois momentos diferentes. Não ocorre na base (todo filtro tem uma condição
      // só), e resolver às cegas é escolher um dos dois momentos no escuro.
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
      // Grupo cuja agregação é BLANK não passa em comparação de ordem — vazio não é
      // "menor que tudo". Mesma regra do filtro de linha.
      if (isBlank(valor)) return inverte;
      return aceita(compareValues(valor, alvo, false, rotulo)) !== inverte;
    };
  });

  return { origem: rotulo, passa: (escopo) => testes.every((t) => t(escopo)) };
}

/**
 * Traduz uma lista de filtros de spec (página + visual, juntos) em `TableFilter[]`.
 *
 * Falha alto em tudo que não souber: `op: desconhecido`, comparação sem tradução,
 * unidade de tempo estranha. Um filtro descartado em silêncio é um número errado.
 *
 * **Filtro sobre agregado não passa por aqui** — ele erra alto (ver `predicado`).
 * Quem sabe agrupar chama `separaFiltros` antes e manda cada metade para o seu
 * lugar; quem não sabe (o card) recebe o erro, que é a resposta certa: um card não
 * tem grupos para filtrar.
 */
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

    // As condições de um filtro são cláusulas do mesmo `Where` do PBIP: valem
    // todas juntas (E). Como restringem a mesma coluna, vão para **um** predicado
    // em vez de um `TableFilter` por condição.
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

function predicado(
  c: CondicaoSpec,
  f: FiltroSpec,
  ev: Evaluator,
  onde: string,
): (row: Row) => boolean {
  const tabela = f.entity!;
  const coluna = f.property!;
  const valor = (row: Row): DaxValue => ev.columnValue(tabela, coluna, row);

  // **Filtro sobre agregado não é predicado de linha.** `left_aggregation` diz que
  // o lado esquerdo da comparação é `COUNT(coluna)`, não `coluna`: é o "filtrar por
  // valor agregado" do painel do Power BI, um HAVING, e ele decide quais **grupos**
  // do visual aparecem — não quais linhas entram na conta.
  //
  // São 10 no relatório (`count > 0` em 8, `count > 100` em 2), todos em tabela ou
  // gráfico; nenhum em card. Aplicado ao valor cru, `COUNT(protocolo) > 0` vira
  // `protocolo > 0`, que é outro filtro inteiramente — e num campo numérico ele
  // aceitaria quase tudo, em silêncio. O lugar de implementá-lo é o agrupamento do
  // visual, que é a próxima fatia; até lá, parar é o certo.
  if (c.op === 'comparison' && c.left_aggregation) {
    throw new DaxEvalError(
      `${onde}: o filtro compara ${c.left_aggregation.toUpperCase()}([${c.left_property}]) ` +
        `e não [${c.left_property}] — é filtro sobre valor agregado (HAVING), que decide ` +
        `quais grupos o visual mostra. Como predicado de linha ele vira outro filtro, ` +
        `e num campo numérico aceitaria quase tudo sem erro nenhum. ` +
        `Implementá-lo exige o agrupamento do visual (tabela/gráfico), que ainda não existe.`,
    );
  }

  // A coluna da condição tem de ser a do filtro. Hoje coincidem nos 108 filtros do
  // relatório; se um dia divergirem, aplicar a condição na coluna errada daria um
  // número plausível e errado — então o certo é parar.
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

      // `coluna = null` é como o Power BI escreve "é vazio" no painel de filtro, e
      // ele é tratado como **vazio mesmo** — não pelo `=` do DAX, sob o qual BLANK
      // equivale a 0 e a "". A diferença só apareceria numa coluna numérica com
      // zeros; nas de data deste relatório não muda nada. DESVIO DELIBERADO,
      // registrado: a intenção do painel é "vazio", não "igual a zero".
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

        // `coluna = DateSpan(agora, mês)` NÃO é igualdade: `DateSpan` é um
        // intervalo, e `eq` contra intervalo significa "cai dentro dele". É assim
        // que o Power BI escreve "este mês".
        if (c.kind === 'eq') {
          return (row) => {
            const v = valor(row);
            if (isBlank(v)) return inverte;
            const truncado = truncar(exigeData(v, onde), unidade, onde);
            return (truncado.getTime() === alvo.getTime()) !== inverte;
          };
        }

        // Ordem contra um intervalo: em unidade abaixo do dia o intervalo é um
        // instante e a comparação é exata. Acima do dia, "maior que este mês"
        // depende de o Power BI comparar com o início ou com o fim do intervalo —
        // convenção que este relatório não exercita, e que não se adivinha.
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
      // `Between` do PBIP é inclusivo nas duas pontas.
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

/**
 * Espécies diferentes nas duas pontas do filtro nunca casam, e o resultado seria
 * zero com cara de filtro apertado.
 *
 * É a mesma armadilha que `restringe` já cobre nas junções (measure-engine/filter.ts):
 * coluna que chega como texto `DD/MM/YYYY` contra valor de data. Aqui a checagem é
 * feita na primeira linha vista, não no resultado — um filtro que legitimamente não
 * casa com nada é possível, e não deve virar erro.
 */
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
