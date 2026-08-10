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
import { colunasUsadas, omissiveis, sobDemandaLiberada } from './colunas-usadas.ts';
import { arquivoDaCalculada, shaDaCalculada } from './tabelas-calculadas.ts';
import { le, leCabecalho, shaDeDax, type CabecalhoDeSnapshot, type Escalar } from './formato.ts';
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
  /**
   * Projetar colunas? Padrão `true`.
   *
   * `false` carrega o arquivo inteiro, e existe para uma coisa só: comparar o
   * mesmo cálculo com e sem projeção. É o interruptor honesto que o teste de
   * diferencial precisa — o mesmo papel que `MINIMO_PARA_INDEXAR` faz no índice.
   */
  projetar?: boolean;
  /**
   * Colunas sob demanda a **liberar** nesta carga, como `'TABELA'[coluna]`.
   *
   * É o outro lado de `specs/_catalog/projecao.yaml`: a coluna fica fora da abertura
   * da página, e entra quando alguém pede o visual que depende dela. Liberar só o que
   * foi pedido — e não tudo — é o que mantém o pedido caro proporcional ao que ele
   * mostra, em vez de trazer todo o texto livre da base de volta por um clique.
   */
  liberaSobDemanda?: readonly string[];
  /**
   * Ler tabela calculada de disco quando houver arquivo? Padrão `true`.
   *
   * `false` força o cálculo a partir do DAX, e existe para duas coisas: o programa que
   * **grava** esses arquivos (senão ele leria o que deveria produzir) e o teste
   * diferencial, que compara ler contra calcular. É o mesmo interruptor honesto de
   * `projetar`.
   */
  lerCalculadas?: boolean;
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
  /**
   * As colunas que a projeção deixou fora da carga, como `'TABELA'[coluna]`.
   *
   * Sai no resultado pelo mesmo motivo de `convertidas`: é a outra coisa que o
   * carregamento faz e que **muda o que o avaliador enxerga**. Carga que omite sem
   * dizer é indistinguível de bug; esta lista é o que a torna auditável.
   */
  omitidas: string[];
  /**
   * Tabelas calculadas que vieram **de disco** em vez de serem recalculadas.
   *
   * Como `convertidas` e `omitidas`: o que o carregamento faz de diferente tem de ser
   * dizível. Uma tabela congelada é um valor que o avaliador não desconfia, e saber
   * quais são é o que separa "rápido" de "misteriosamente rápido".
   */
  congeladas: string[];
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

  // As colunas que estas páginas alcançam. Tudo que sobra é candidato a não entrar
  // na memória — ver `colunas-usadas.ts` e `docs/DECISAO-DESEMPENHO.md`.
  const usadas = opts.projetar === false ? null : colunasUsadas(opts.dashboards, opts.model);
  const omitidas: string[] = [];
  const liberadas = new Set((opts.liberaSobDemanda ?? []).map((r) => normaliza(r)));

  const convertidas: string[] = [];
  for (const t of plano.tabelas) {
    if (t.query === null) continue;
    const arquivo = arquivoDaQuery(opts.dir, t.query);
    const fora = usadas === null
      ? []
      : omissiveis(
          t.nome,
          leCabecalho(arquivo).colunas.map((c) => c.nome),
          usadas,
          opts.model,
          sobDemandaLiberada(t.nome, opts.model.sobDemanda, liberadas),
        );
    for (const c of fora) omitidas.push(`'${t.nome}'[${c}]`);

    const { cabecalho, linhas } = await le(arquivo, new Set(fora));
    conferaColunasCalculadas(opts.model.table(t.nome)!, cabecalho, t.query, opts.dir);
    // `fora` também aqui, e não é detalhe: sem ele a conversão de tipo escreveria
    // `linha[chave] = aplicaTipo(col, null)` na coluna omitida e a **traria de
    // volta**, agora valendo BLANK em todas as linhas. Seria a projeção produzindo
    // exatamente o número errado silencioso que ela promete não produzir.
    convertidas.push(
      ...aplicaTiposDeclarados(opts.model.table(t.nome)!, cabecalho, linhas, new Set(fora)),
    );
    // **Adotar, não copiar.** `addTable` remonta objeto por objeto para normalizar o
    // nome das colunas — trabalho que em `field-agenda` são 1,46 milhão de linhas
    // reconstruídas campo a campo, e um segundo exemplar delas vivo até o GC passar,
    // numa máquina de 16 GB. `le` já devolve chave normalizada, então não há o que
    // normalizar: a cópia era pura perda. Se algum dia deixar de ser verdade,
    // `adotaTabela` erra alto nomeando a chave — não devolve BLANK calado.
    dataset.adotaTabela(t.nome, linhas as never, fora);
    linhasPorTabela.set(t.nome, linhas.length);
    datas.push(cabecalho.geradoEm);
  }

  const ev = new Evaluator({ model: opts.model, dataset, now: opts.now });

  // Só as calculadas do plano, e na ordem de dependência que o modelo dita: uma
  // tabela calculada pode nascer de outra, e materializar fora de ordem daria
  // "não está no dataset" longe da causa.
  const noPlano = new Set(plano.calculadas.map(normaliza));
  const congeladas: string[] = [];
  for (const t of calculatedTableOrder(opts.model)) {
    if (!noPlano.has(normaliza(t.name))) continue;

    // Congelada em disco? Então não recalcula. Foram ~21 dos ~25 minutos de
    // `agendamento-field` (ACHADOS #53): quatro colunas calculadas desta tabela,
    // recalculadas a cada abertura de página. O Power BI as calcula no refresh.
    const arq = arquivoDaCalculada(opts.dir, t.name);
    if (opts.lerCalculadas !== false && fs.existsSync(arq)) {
      const { cabecalho, linhas } = await le(arq);
      confereTabelaCalculada(t, cabecalho, opts.dir);
      dataset.adotaTabela(t.name, linhas as never);
      linhasPorTabela.set(t.name, linhas.length);
      datas.push(cabecalho.geradoEm);
      congeladas.push(t.name);
      continue;
    }

    const m = materializeCalculatedTable(ev, t);
    linhasPorTabela.set(t.name, m.rowCount);
  }

  return {
    ev,
    plano,
    linhasPorTabela,
    convertidas,
    omitidas,
    congeladas,
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
  /** Colunas que não foram carregadas. Converter uma delas a ressuscitaria como BLANK. */
  omitidas: ReadonlySet<string> = new Set(),
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
    if (chave === undefined || omitidas.has(chave)) continue;
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

/**
 * Confere que toda coluna calculada gravada no arquivo ainda corresponde ao DAX
 * que o modelo declara hoje.
 *
 * **É o guarda que torna materializar coluna calculada uma coisa segura de fazer.**
 * Uma coluna calculada em disco é um valor congelado, e o avaliador não desconfia
 * dela: `columnValue` acha o nome na linha e devolve o valor sem perguntar de onde
 * veio. Sem esta conferência, mudar o DAX no Power BI e rodar `npm run extract`
 * deixaria o relatório servindo o número velho **sem nenhum sinal** — que é o erro
 * plausível e silencioso que este projeto não pode cometer.
 *
 * Erra alto em vez de recalcular. Recalcular calado seria defensável se fosse
 * barato, e não é: são os 104 minutos do achado #46 reaparecendo no meio de uma
 * carga que deveria levar 25 segundos, sem ninguém entender por quê.
 */
function conferaColunasCalculadas(
  tabela: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  query: string,
  dir: string,
): void {
  for (const c of cabecalho.colunas) {
    if (c.daxSha === undefined) continue;
    const col = tabela.columns.find((x) => normaliza(x.name) === normaliza(c.nome));

    // A coluna deixou de ser calculada (ou sumiu) no modelo: o valor em disco não
    // tem mais dono, e mantê-lo seria servir o resultado de um DAX que não existe.
    if (!col?.calculated || !col.dax) {
      throw new Error(
        `Snapshot desatualizado: '${tabela.name}'[${c.nome}] está materializada em ` +
          `${arquivoDaQuery(dir, query)}, mas ${col ? 'não é mais coluna calculada' : 'não existe mais'} ` +
          `no modelo. Rode: npm run snapshot -- --query=${query}`,
      );
    }

    const agora = shaDeDax(col.dax);
    if (agora !== c.daxSha) {
      throw new Error(
        `Snapshot desatualizado: o DAX de '${tabela.name}'[${c.nome}] mudou desde a ` +
          `materialização (${c.daxSha} -> ${agora}). O valor em disco é o do DAX antigo. ` +
          `Rode: npm run snapshot -- --query=${query}`,
      );
    }
  }
}

/**
 * Confere que a tabela calculada em disco ainda corresponde ao DAX de hoje.
 *
 * **É o guarda que torna congelar tabela calculada uma coisa segura de fazer**, e é o
 * do ACHADOS #47 um nível acima. Lá, o `sha256` cobria o DAX de uma coluna; aqui cobre
 * o corpo da tabela **e** o de todas as colunas calculadas dela, porque mudar o corpo
 * muda quais linhas existem — e um valor de coluna gravado contra as linhas antigas não
 * tem como ser aproveitado.
 *
 * Erra alto em vez de recalcular calado. Recalcular seria defensável se fosse barato, e
 * não é: são os ~21 minutos do #53 reaparecendo no meio de uma carga que deveria levar
 * segundos, sem ninguém entender por quê.
 */
function confereTabelaCalculada(
  t: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  dir: string,
): void {
  const comando = `npm run snapshot:calculadas -- --tabela=${t.name}`;
  if (cabecalho.tabelaSha === undefined) {
    throw new Error(
      `${arquivoDaCalculada(dir, t.name)} não declara 'tabelaSha' — ele não foi gravado ` +
        `como tabela calculada, ou é de um formato anterior. Rode: ${comando}`,
    );
  }
  const agora = shaDaCalculada(t);
  if (agora !== cabecalho.tabelaSha) {
    throw new Error(
      `Snapshot desatualizado: a definição de '${t.name}' mudou desde a materialização ` +
        `(${cabecalho.tabelaSha} -> ${agora}). As linhas em disco são as do DAX antigo — ` +
        `da tabela ou de alguma coluna calculada dela. Rode: ${comando}`,
    );
  }
}
