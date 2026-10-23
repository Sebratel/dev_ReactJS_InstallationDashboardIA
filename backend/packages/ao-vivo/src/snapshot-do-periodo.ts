// Um snapshot PEQUENO, só do período: o formato que o refresh grava, para que o
// carregador (`carrega.ts`) e o cálculo da página rodem sem mudança nenhuma em cima do
// que veio ao vivo do SRD. Ver docs/DECISAO-AO-VIVO.md.
//
// Por que um diretório, e não o `Dataset` montado à mão: o carregador faz mais do que
// ler — converte tipo pelo modelo, preserva a espécie das junções, projeta colunas,
// confere o DAX das colunas calculadas e a idade das calculadas, ordena as calculadas
// por dependência. Repetir isso aqui seriam duas regras para o mesmo dado; gravar o
// mesmo arquivo custa milissegundos para um mês de agenda.
//
// O que entra:
//   - `field-agenda-slot` (FIELD AGENDA no grão de slot) e `protocolos-geral`, ao vivo
//     e recortados (`aplicaRecorte`) — o MESMO recorte que a sonda provou igual;
//   - `Status Protocolo Dia`, congelada como o refresh congela, a partir de
//     `statusProtocoloDiaAoVivo` (as contagens de relato vêm do banco já agrupadas);
//   - as queries pequenas da página (capacidade, clima, hora), copiadas do snapshot de
//     quem chama ou passadas prontas;
//   - `calendar` NÃO: sem arquivo, o carregador a calcula pelo DAX sobre a agenda do
//     período, como calcularia qualquer calculada sem congelado.

import fs from 'node:fs';
import path from 'node:path';
import { normalizeName, type SemanticModel } from '../../semantic-model/src/model.ts';
import { escreve, leCabecalho, type Escalar } from '../../snapshot/src/formato.ts';
import { arquivoDaQuery, arquivoDeEscrita, escreveManifesto, type EntradaDeManifesto } from '../../snapshot/src/manifesto.ts';
import { arquivoDaCalculada, paraGravacao, shaDaCalculada } from '../../snapshot/src/tabelas-calculadas.ts';
import type { AgregadaAoVivo } from './catalogo.ts';
import { buscaAoVivo, calculadasDaQuery, type BuscaFeita, type ContextoAoVivo } from './executor.ts';
import type { PeriodoAoVivo } from './periodo.ts';
import { aplicaRecorte, celula, texto } from './recorte.ts';
import { buscaRelatosDoDia, statusProtocoloDiaAoVivo } from './status-dia.ts';

export interface TabelaDoPeriodo {
  readonly query: string;
  readonly colunas: readonly string[];
  readonly linhas: readonly Record<string, Escalar>[];
}

export interface DadosDoPeriodo {
  readonly periodo: PeriodoAoVivo;
  readonly consultas: readonly TabelaDoPeriodo[];
  /** As linhas de `Status Protocolo Dia`, com as chaves da tradução nativa. */
  readonly statusProtocoloDia: readonly Record<string, Escalar>[];
  readonly protocolos: number;
  readonly buscas: readonly BuscaFeita[];
  readonly ms: { readonly agenda: number; readonly relatos: number; readonly protocolos: number; readonly total: number };
}

const AGENDA = 'field-agenda-slot';
const PROTOCOLOS = 'protocolos-geral';
const STATUS_DIA = 'Status Protocolo Dia';

/**
 * A agenda, os protocolos e as contagens de relato do período, ao vivo.
 *
 * A agenda e as contagens saem juntas (as duas só dependem do período); os protocolos
 * esperam a agenda, porque o recorte deles é a lista de protocolos dela.
 */
export async function buscaDoPeriodo(
  ctx: ContextoAoVivo,
  relatosDoDia: AgregadaAoVivo,
  periodo: PeriodoAoVivo,
  agora: Date,
): Promise<DadosDoPeriodo> {
  const inicio = Date.now();
  const cAgenda = ctx.catalogo.get(AGENDA);
  const cProtocolos = ctx.catalogo.get(PROTOCOLOS);
  if (!cAgenda || !cProtocolos) throw new Error(`ao-vivo.yaml sem '${!cAgenda ? AGENDA : PROTOCOLOS}'`);

  let msRelatos = 0;
  const [agenda, relatos] = await Promise.all([
    buscaAoVivo(ctx, { query: AGENDA, params: { desde: periodo.desde, ate: periodo.ate }, agora }),
    (async () => {
      const t = Date.now();
      const r = await buscaRelatosDoDia(ctx, relatosDoDia, periodo);
      msRelatos = Date.now() - t;
      return r;
    })(),
  ]);
  const linhasAgenda = aplicaRecorte(agenda.linhas, cAgenda.recorte, periodo);
  const lista = [...new Set(linhasAgenda.map((l) => texto(celula(l, 'Protocolo'))))];

  const protocolos = await buscaAoVivo(ctx, { query: PROTOCOLOS, params: { protocolos: lista }, agora });
  const linhasProtocolos = aplicaRecorte(protocolos.linhas, cProtocolos.recorte, { protocolos: lista });

  return {
    periodo,
    consultas: [
      { query: AGENDA, colunas: agenda.colunas, linhas: linhasAgenda },
      { query: PROTOCOLOS, colunas: protocolos.colunas, linhas: linhasProtocolos },
    ],
    statusProtocoloDia: statusProtocoloDiaAoVivo(linhasAgenda, relatos, linhasProtocolos),
    protocolos: lista.length,
    buscas: [...agenda.buscas, ...protocolos.buscas],
    ms: { agenda: agenda.ms.total, relatos: msRelatos, protocolos: protocolos.ms.total, total: Date.now() - inicio },
  };
}

/** As tabelas do modelo que carregam do arquivo de uma query — o `tabelas` do cabeçalho. */
function tabelasDoArquivo(model: SemanticModel, query: string): string[] {
  return calculadasDaQuery(model, query).map((t) => t.tabela);
}

/**
 * Grava o snapshot do período em `dir` (que tem de existir e estar vazio).
 *
 * `geradoEm` é o MESMO em todo arquivo gravado: a calculada congelada não pode ser mais
 * velha que as origens dela (`confereIdadeDaCalculada`), e um carimbo por arquivo
 * dependeria da ordem de gravação. As queries copiadas de `copia.dir` mantêm o carimbo
 * delas — é o que a tela mostra como idade do dado.
 */
export async function escreveSnapshotDoPeriodo(
  dir: string,
  model: SemanticModel,
  dados: Pick<DadosDoPeriodo, 'consultas' | 'statusProtocoloDia'>,
  geradoEm: string,
  copia?: { readonly dir: string; readonly queries: readonly string[] },
): Promise<void> {
  if (fs.readdirSync(dir).length > 0) throw new Error(`snapshot do período: ${dir} não está vazio`);
  const arquivos: { query: string; arquivo: string }[] = [];

  for (const c of dados.consultas) {
    const arquivo = arquivoDeEscrita(dir, c.query, true);
    await escreve(arquivo, { query: c.query, tabelas: tabelasDoArquivo(model, c.query), geradoEm }, c.colunas, c.linhas);
    arquivos.push({ query: c.query, arquivo });
  }

  for (const q of copia?.queries ?? []) {
    const origem = arquivoDaQuery(copia!.dir, q);
    if (!fs.existsSync(origem)) throw new Error(`snapshot do período: '${q}' não está em ${copia!.dir}`);
    const arquivo = path.join(dir, path.basename(origem));
    fs.copyFileSync(origem, arquivo);
    arquivos.push({ query: q, arquivo });
  }

  // Como `calculadas.ts` do refresh grava a tradução nativa: as colunas físicas e as
  // calculadas do modelo, com as chaves que o cabeçalho declara.
  const t = model.table(STATUS_DIA);
  if (!t) throw new Error(`snapshot do período: o modelo não tem '${STATUS_DIA}'`);
  const nomes = [
    ...t.columns.filter((x) => !x.calculated).map((x) => x.name),
    ...t.columns.filter((x) => x.calculated && x.dax).map((x) => x.name),
  ];
  await escreve(
    arquivoDaCalculada(dir, t.name),
    {
      query: `calc.${normalizeName(t.name).replace(/[^a-z0-9]+/g, '-')}`,
      tabelas: [t.name],
      geradoEm,
      tabelaSha: shaDaCalculada(t),
    },
    nomes,
    paraGravacao(dados.statusProtocoloDia, nomes, t.name),
  );

  const entradas: EntradaDeManifesto[] = arquivos.map(({ query, arquivo }) => {
    const cab = leCabecalho(arquivo);
    return {
      query,
      tabelas: cab.tabelas,
      linhas: cab.linhas,
      colunas: cab.colunas.length,
      bytes: fs.statSync(arquivo).size,
      geradoEm: cab.geradoEm,
    };
  });
  await escreveManifesto(dir, entradas.sort((a, b) => a.query.localeCompare(b.query)));
}
