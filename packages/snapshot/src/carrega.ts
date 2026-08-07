// Do snapshot em disco para um avaliador pronto.
//
// **É aqui que a plataforma passa a tocar dado real.** Até esta função, tudo o
// que as engines calculavam vinha de `Dataset` montado à mão no teste. O caminho
// completo é:
//
//   fontes → Query Engine → camada M → toDatasetRows → snapshot em disco
//                                                          │
//                                          carrega() ──────┘
//                                              │
//                        Dataset + tabelas calculadas materializadas
//                                              │
//                          Evaluator → Widget Engine → número na tela
//
// **Só o que a página precisa entra.** O plano manda: as tabelas de query vêm de
// arquivo, as calculadas nascem de DAX aqui, e nada mais é carregado. Carregar as
// 23 sempre puxaria `field-agenda` — 1,4 milhão de linhas — para páginas que não
// a mencionam.
//
// **Tabela faltando erra alto, e nomeia o comando.** A alternativa é o
// `Tabela não está no dataset` do avaliador no meio do cálculo de um visual, que
// diz o sintoma e não o que fazer.

import fs from 'node:fs';
import path from 'node:path';
import { Dataset } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import {
  calculatedTableOrder,
  materializeCalculatedTable,
} from '../../measure-engine/src/calculated.ts';
import { normalizeName as normaliza, type SemanticModel } from '../../semantic-model/src/model.ts';
import type { DashboardSpec } from '../../widget-engine/src/spec.ts';
import { aplicaTipo } from '../../measure-engine/src/calculated.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { le, type CabecalhoDeSnapshot, type Escalar } from './formato.ts';
import { arquivoDaQuery, leManifesto } from './manifesto.ts';
import { planeja, type PlanoDeSnapshot } from './plano.ts';

export interface CarregaOptions {
  /** Diretório do snapshot. */
  dir: string;
  model: SemanticModel;
  /** As páginas a servir. O plano sai delas. */
  dashboards: readonly DashboardSpec[];
  /**
   * O "agora" do cálculo. Injetado porque 25 das 121 expressões chamam `TODAY()`
   * — um resultado que muda à meia-noite não é conferível.
   */
  now: Date;
}

export interface Carregado {
  ev: Evaluator;
  plano: PlanoDeSnapshot;
  /** Nome da tabela → quantas linhas entraram, de arquivo ou de DAX. */
  linhasPorTabela: Map<string, number>;
  /**
   * As colunas cujo valor foi convertido para o tipo declarado no carregamento.
   *
   * Fica no resultado porque é a única parte do carregamento que **muda o dado**, e
   * conversão calada é a coisa que mais custa caro nesta base. Ver
   * `aplicaTiposDeclarados`.
   */
  convertidas: string[];
  /** A materialização mais antiga entre as tabelas usadas — a idade do dado. */
  dadoDe: string | null;
  ms: number;
}

/**
 * Monta o avaliador de uma ou mais páginas a partir do snapshot.
 *
 * Assíncrona porque a leitura é em streaming: `field-agenda` não cabe
 * confortavelmente numa string só, e ler linha a linha mantém o pico de memória
 * na ordem da tabela, não do dobro dela.
 */
export async function carrega(opts: CarregaOptions): Promise<Carregado> {
  const inicio = Date.now();
  const plano = planeja(opts.dashboards, opts.model);
  const dataset = new Dataset();
  const linhasPorTabela = new Map<string, number>();
  const datas: string[] = [];

  const faltando: { tabela: string; query: string }[] = [];
  for (const t of plano.tabelas) {
    if (t.query === null) continue;
    if (!fs.existsSync(arquivoDaQuery(opts.dir, t.query))) {
      faltando.push({ tabela: t.nome, query: t.query });
    }
  }
  if (faltando.length > 0) {
    const manifesto = leManifesto(opts.dir);
    throw new Error(
      `Snapshot incompleto em ${opts.dir}: falta(m) ${faltando.length} tabela(s) — ` +
        faltando.map((f) => `'${f.tabela}' (query ${f.query})`).join(', ') +
        `. Em disco: ${manifesto ? manifesto.tabelas.length : 0} query(s). ` +
        `Rode: npm run snapshot -- --pagina=${plano.dashboards.join(',')}`,
    );
  }

  const convertidas: string[] = [];
  for (const t of plano.tabelas) {
    if (t.query === null) continue;
    const { cabecalho, linhas } = await le(arquivoDaQuery(opts.dir, t.query));
    convertidas.push(...aplicaTiposDeclarados(opts.model.table(t.nome)!, cabecalho, linhas));
    dataset.addTable(t.nome, linhas);
    linhasPorTabela.set(t.nome, linhas.length);
    datas.push(cabecalho.geradoEm);
  }

  const ev = new Evaluator({ model: opts.model, dataset, now: opts.now });

  // Só as calculadas do plano, e na ordem de dependência que o modelo dita: uma
  // tabela calculada pode nascer de outra, e materializar fora de ordem daria
  // "não está no dataset" longe da causa.
  const noPlano = new Set(plano.calculadas.map(normaliza));
  for (const t of calculatedTableOrder(opts.model)) {
    if (!noPlano.has(normaliza(t.name))) continue;
    const m = materializeCalculatedTable(ev, t);
    linhasPorTabela.set(t.name, m.rowCount);
  }

  return {
    ev,
    plano,
    linhasPorTabela,
    convertidas,
    dadoDe: datas.sort()[0] ?? null,
    ms: Date.now() - inicio,
  };
}

/** Tipo de snapshot que cada tipo declarado do modelo espera encontrar. */
const ESPERADO: Record<string, string> = {
  int64: 'number',
  double: 'number',
  decimal: 'number',
  dateTime: 'date',
};

/**
 * O tipo declarado da coluna vale ao materializar — também para coluna **física**.
 *
 * **É a mesma regra do [ACHADOS](../../../docs/ACHADOS.md) #31, um nível acima.**
 * Lá, `'PROTOCOLOS GERAL'[CONTAGEM]` era DAX `"1"` declarada `int64`, e a conversão
 * entrou no caminho da coluna *calculada*. Coluna física ficou de fora porque em
 * dado sintético o teste sempre põe número em coluna numérica. Contra a base real,
 * não: `'CONSOLIDADO CLIENTES'[authentication_totalizer]` declara `int64` e a camada
 * M entrega o texto `"83205"`, e o `AVERAGE` do gráfico errava alto.
 *
 * **Medido em 07/08/2026, sobre as 14 tabelas materializadas:** de todas as colunas
 * físicas, **14** declaram número e chegam texto. Nelas, **todo** valor não-nulo é
 * literal numérico limpo — nenhum `"1.234,56"`, nenhum `"R$ 10"` —, então a
 * conversão não troca "funciona" por "erra alto" em lugar nenhum.
 *
 * **O sentido contrário fica de fora, de propósito.** Quatro colunas declaram texto
 * e chegam número ou data (`'PROTOCOLOS GERAL'[DATA FINAL]` é data e se declara
 * `string`). Converter uma data de verdade para texto quebraria todo `YEAR()` sobre
 * ela — perda, não ganho. Ficam como estão, e este comentário é o registro.
 *
 * A conversão é decidida pelo **tipo apurado no cabeçalho** do snapshot, que foi
 * varrido sobre a coluna inteira. Coluna que já chega no tipo certo não é tocada, e
 * é por isso que o custo disto é proporcional às 14, não às centenas.
 */
function aplicaTiposDeclarados(
  t: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  linhas: Record<string, Escalar>[],
): string[] {
  const doDisco = new Map(cabecalho.colunas.map((c) => [normaliza(c.nome), c]));
  const converter: { chave: string; col: (typeof t.columns)[number] }[] = [];
  const nomes: string[] = [];

  for (const col of t.columns) {
    if (col.calculated || !col.type || !ESPERADO[col.type]) continue;
    const chave = [col.sourceColumn, col.name]
      .filter((x): x is string => !!x)
      .map(normaliza)
      .find((k) => doDisco.has(k));
    if (chave === undefined) continue;
    const emDisco = doDisco.get(chave)!;
    // `vazia` é coluna só de nulos: não há o que converter.
    if (emDisco.tipo === 'vazia' || emDisco.tipo === ESPERADO[col.type]) continue;
    converter.push({ chave, col });
    nomes.push(`'${t.name}'[${col.name}] ${emDisco.tipo} -> ${col.type}`);
  }

  for (const linha of linhas) {
    for (const { chave, col } of converter) {
      linha[chave] = aplicaTipo(col, linha[chave] ?? null, t.name) as Escalar;
    }
  }
  return nomes;
}

/** O caminho padrão do snapshot, a partir da raiz do repositório. */
export function diretorioPadrao(root: string): string {
  return path.join(root, 'snapshot');
}
