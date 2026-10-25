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
//   - `field-agenda` (FIELD AGENDA COMPLETA, no grão relato) e `protocolos-geral`, ao vivo
//     e recortados (`aplicaRecorte`) — o MESMO recorte que a sonda provou igual. Até
//     25/10/2026 era a `field-agenda-slot`, e os seis visuais de relato seguiam pelo
//     snapshot, que por isso guardava a agenda completa inteira (633 mil linhas);
//   - `Status Protocolo Dia`, congelada como o refresh congela (`congelaStatusDoDia`);
//   - as queries pequenas da página (capacidade, clima, hora), copiadas do snapshot de
//     quem chama ou passadas prontas;
//   - `calendar` NÃO: sem arquivo, o carregador a calcula pelo DAX sobre a agenda do
//     período, como calcularia qualquer calculada sem congelado.

import fs from 'node:fs';
import path from 'node:path';
import { normalizeName, type SemanticModel } from '../../semantic-model/src/model.ts';
import { carrega } from '../../snapshot/src/carrega.ts';
import { escreve, le, leCabecalho, type Escalar } from '../../snapshot/src/formato.ts';
import { arquivoDaQuery, arquivoDeEscrita, escreveManifesto, type EntradaDeManifesto } from '../../snapshot/src/manifesto.ts';
import { traducaoDe } from '../../snapshot/src/nativas.ts';
import { arquivoDaCalculada, paraGravacao, shaDaCalculada } from '../../snapshot/src/tabelas-calculadas.ts';
import type { DashboardSpec } from '../../widget-engine/src/spec.ts';
import { buscaAoVivo, calculadasDaQuery, type BuscaFeita, type ContextoAoVivo } from './executor.ts';
import { FORMA_DA_AGENDA, type PeriodoAoVivo } from './periodo.ts';
import { aplicaRecorte, celula, texto } from './recorte.ts';

export interface TabelaDoPeriodo {
  readonly query: string;
  readonly colunas: readonly string[];
  readonly linhas: readonly Record<string, Escalar>[];
}

export interface DadosDoPeriodo {
  readonly periodo: PeriodoAoVivo;
  readonly consultas: readonly TabelaDoPeriodo[];
  readonly protocolos: number;
  readonly buscas: readonly BuscaFeita[];
  readonly ms: { readonly agenda: number; readonly protocolos: number; readonly total: number };
}

const AGENDA = 'field-agenda';
const PROTOCOLOS = 'protocolos-geral';
const STATUS_DIA = 'Status Protocolo Dia';

/**
 * A agenda completa e os protocolos do período, ao vivo — uma busca depois da outra: o
 * recorte dos protocolos é a lista de protocolos da agenda.
 */
export async function buscaDoPeriodo(ctx: ContextoAoVivo, periodo: PeriodoAoVivo, agora: Date): Promise<DadosDoPeriodo> {
  const inicio = Date.now();
  const cAgenda = ctx.catalogo.get(AGENDA);
  const cProtocolos = ctx.catalogo.get(PROTOCOLOS);
  if (!cAgenda || !cProtocolos) throw new Error(`ao-vivo.yaml sem '${!cAgenda ? AGENDA : PROTOCOLOS}'`);

  const agenda = await buscaAoVivo(ctx, { query: AGENDA, params: { desde: periodo.desde, ate: periodo.ate }, agora });
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
    protocolos: lista.length,
    buscas: [...agenda.buscas, ...protocolos.buscas],
    ms: { agenda: agenda.ms.total, protocolos: protocolos.ms.total, total: Date.now() - inicio },
  };
}

/**
 * O `Status Protocolo Dia` do período, congelado em `dir` como o refresh congela
 * (`backend/tools/snapshot/src/calculadas.ts`): a pasta carregada pelo carregador de
 * sempre, sem calculadas lidas e com a FIELD AGENDA completa, e a tradução nativa sobre
 * as linhas dela. Sem o congelado, o carregador cairia no DAX — horas.
 *
 * Mesma regra da tabela inteira, sobre o recorte: os mapas da tradução são chaveados por
 * (protocolo, dia), e o recorte traz cada protocolo com TODAS as suas linhas.
 */
export async function congelaStatusDoDia(
  dir: string,
  model: SemanticModel,
  agenda: DashboardSpec,
  agora: Date,
  geradoEm: string,
): Promise<void> {
  const t = model.table(STATUS_DIA);
  if (!t) throw new Error(`o modelo não tem '${STATUS_DIA}'`);
  const nativa = traducaoDe(t);
  if (!('traducao' in nativa)) throw new Error(`${STATUS_DIA} sem tradução nativa válida: ${nativa.porque}`);
  const c = await carrega({ dir, model, dashboards: [agenda], now: agora, lerCalculadas: false, precisaFormaCompleta: [...FORMA_DA_AGENDA] });
  const fontes = nativa.traducao.fontes.map((nome) => c.ev.dataset.rows(nome) as unknown as Record<string, Escalar>[]);
  await escreveCalculadas(dir, model, [{ tabela: t.name, linhas: nativa.traducao.calcula(fontes) }], geradoEm);
}

/** Uma tabela calculada já pronta, com as chaves do dataset (normalizadas). */
export interface CalculadaPronta {
  readonly tabela: string;
  readonly linhas: readonly Record<string, Escalar>[];
}

/**
 * As calculadas CONGELADAS do snapshot de hoje, para entrarem no snapshot do período.
 *
 * Existe por causa do CALENDARIO INSTALADO da Premiação e do Diário: o corte da página
 * deixa a PG só do ano, mas a calendário fica a congelada, que nasceu da PG INTEIRA
 * (desde 2025) — de propósito, ver `corte-por-pagina.yaml` e ACHADOS #205. Calculada
 * sobre a PG do ano, um filtro de "ano corrente" manteria todo o calendário e o motor o
 * trataria como "sem filtro", contando protocolo sem data de instalação. Então ela vem do
 * snapshot, igual à da tela de hoje.
 *
 * Erra alto se a calculada não está lá ou se o DAX dela mudou desde o congelamento: quem
 * busca cai para o snapshot, em vez de servir calendário de outra definição.
 */
export async function calculadasCongeladas(
  snapshotDir: string,
  model: SemanticModel,
  tabelas: readonly string[],
): Promise<CalculadaPronta[]> {
  const saida: CalculadaPronta[] = [];
  for (const nome of tabelas) {
    const t = model.table(nome);
    if (!t) throw new Error(`calculada congelada: o modelo não tem '${nome}'`);
    const arquivo = arquivoDaCalculada(snapshotDir, t.name);
    if (!fs.existsSync(arquivo)) throw new Error(`calculada congelada: '${t.name}' não está em ${snapshotDir}`);
    const cab = leCabecalho(arquivo);
    if (cab.tabelaSha !== shaDaCalculada(t)) {
      throw new Error(`calculada congelada: o DAX de '${t.name}' mudou desde o congelamento — espera o refresh recongelar`);
    }
    const { linhas } = await le(arquivo);
    saida.push({ tabela: t.name, linhas });
  }
  return saida;
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
  /**
   * `calculadas`: as que vêm prontas de outro lugar (`calculadasCongeladas`), gravadas
   * congeladas com o `geradoEm` deste snapshot.
   */
  dados: Pick<DadosDoPeriodo, 'consultas'> & { readonly calculadas?: readonly CalculadaPronta[] },
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

  await escreveCalculadas(dir, model, dados.calculadas ?? [], geradoEm);

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

/**
 * Grava calculadas congeladas como `calculadas.ts` do refresh grava a tradução nativa: as
 * colunas físicas e as calculadas do modelo, com as chaves que o cabeçalho declara. Fora
 * do manifesto, como no snapshot de hoje.
 */
async function escreveCalculadas(
  dir: string,
  model: SemanticModel,
  calculadas: readonly CalculadaPronta[],
  geradoEm: string,
): Promise<void> {
  for (const c of calculadas) {
    const t = model.table(c.tabela);
    if (!t) throw new Error(`snapshot do período: o modelo não tem '${c.tabela}'`);
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
      paraGravacao(c.linhas, nomes, t.name),
    );
  }
}
