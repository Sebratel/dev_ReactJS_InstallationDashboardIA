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
import { relogioDeParede } from '../../measure-engine/src/relogio.ts';
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

/** Divide `[desde, ate)` em fatias contíguas de no máximo `diasPorFatia` dias (padrão: 7 = semana). */
export function fatiaPeriodoEmSemanas(
  periodo: PeriodoAoVivo,
  diasPorFatia = 7,
): PeriodoAoVivo[] {
  const passo = Math.max(1, Math.trunc(diasPorFatia));
  const inicioMs = Date.parse(`${periodo.desde}T00:00:00Z`);
  const fimMs = Date.parse(`${periodo.ate}T00:00:00Z`);
  if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs) || inicioMs >= fimMs) {
    return [];
  }
  const diaMs = 86_400_000;
  const fatias: PeriodoAoVivo[] = [];
  for (let t = inicioMs; t < fimMs; t += passo * diaMs) {
    const prox = Math.min(fimMs, t + passo * diaMs);
    fatias.push({
      desde: new Date(t).toISOString().slice(0, 10),
      ate: new Date(prox).toISOString().slice(0, 10),
    });
  }
  return fatias;
}

function chaveProtocolo(linha: Record<string, Escalar>): string {
  return texto(celula(linha, 'Protocolo'));
}

function chaveProtocoloPg(linha: Record<string, Escalar>): string {
  const v = linha['N°PROTOCOLO'] ?? linha['PROTOCOLO'] ?? celula(linha, 'N°PROTOCOLO');
  return texto(v ?? null);
}

function dentroDaJanela(valor: Escalar, desde: string, ate: string): boolean {
  const iso =
    valor instanceof Date
      ? valor.toISOString().slice(0, 10)
      : typeof valor === 'string'
        ? valor.slice(0, 10)
        : '';
  return iso >= desde && iso < ate;
}

function agrupaPorProtocolo(
  linhas: readonly Record<string, Escalar>[],
  destino: Map<string, Record<string, Escalar>[]>,
): void {
  const porSemana = new Map<string, Record<string, Escalar>[]>();
  for (const l of linhas) {
    const k = chaveProtocolo(l);
    let arr = porSemana.get(k);
    if (!arr) {
      arr = [];
      porSemana.set(k, arr);
    }
    arr.push(l);
  }
  for (const [k, arr] of porSemana) {
    destino.set(k, arr);
  }
}

async function buscaAgendaFatiada(
  ctx: ContextoAoVivo,
  periodo: PeriodoAoVivo,
  agora: Date,
  diasPorFatia: number,
): Promise<{
  colunas: readonly string[];
  porProtocolo: Map<string, Record<string, Escalar>[]>;
  buscas: BuscaFeita[];
  ms: number;
}> {
  const cAgenda = ctx.catalogo.get(AGENDA)!;
  const fatias = fatiaPeriodoEmSemanas(periodo, diasPorFatia);
  const porProtocolo = new Map<string, Record<string, Escalar>[]>();
  const buscas: BuscaFeita[] = [];
  let colunas: readonly string[] = [];
  let ms = 0;

  for (const fatia of fatias) {
    const agenda = await buscaAoVivo(ctx, {
      query: AGENDA,
      params: { desde: fatia.desde, ate: fatia.ate },
      agora,
    });
    if (colunas.length === 0) colunas = agenda.colunas;
    const recortadas = aplicaRecorte(agenda.linhas, cAgenda.recorte, fatia);
    agrupaPorProtocolo(recortadas, porProtocolo);
    buscas.push(...agenda.buscas);
    ms += agenda.ms.total;
  }

  return { colunas, porProtocolo, buscas, ms };
}

/**
 * A agenda completa e os protocolos do período, ao vivo, em fatias semanais:
 * - na primeira carga, busca semana a semana (evita pico de 640–800 MB em 1 query só);
 * - quando já existe uma geração anterior em `anteriorDir`, busca apenas a última semana
 *   (7 dias) e mescla incrementalmente com o disco anterior.
 */
export async function buscaDoPeriodo(
  ctx: ContextoAoVivo,
  periodo: PeriodoAoVivo,
  agora: Date,
  opcoes?: { readonly diasPorFatia?: number; readonly anteriorDir?: string },
): Promise<DadosDoPeriodo> {
  const inicio = Date.now();
  const cAgenda = ctx.catalogo.get(AGENDA);
  const cProtocolos = ctx.catalogo.get(PROTOCOLOS);
  if (!cAgenda || !cProtocolos) throw new Error(`ao-vivo.yaml sem '${!cAgenda ? AGENDA : PROTOCOLOS}'`);

  const diasPorFatia = opcoes?.diasPorFatia ?? 7;
  const arqAgendaAnt = opcoes?.anteriorDir ? arquivoDaQuery(opcoes.anteriorDir, AGENDA) : null;
  const arqPgAnt = opcoes?.anteriorDir ? arquivoDaQuery(opcoes.anteriorDir, PROTOCOLOS) : null;

  if (arqAgendaAnt && arqPgAnt && fs.existsSync(arqAgendaAnt) && fs.existsSync(arqPgAnt)) {
    const hoje = relogioDeParede(agora).toISOString().slice(0, 10);
    const refMs = Math.min(Date.parse(`${hoje}T00:00:00Z`), Date.parse(`${periodo.ate}T00:00:00Z`));
    const seteDiasAntes = new Date(refMs - diasPorFatia * 86_400_000).toISOString().slice(0, 10);
    const desdeInc = seteDiasAntes > periodo.desde ? seteDiasAntes : periodo.desde;

    const {
      colunas: colAgenda,
      porProtocolo: novosPorProto,
      buscas: buscasAgenda,
      ms: msAgenda,
    } = await buscaAgendaFatiada(ctx, { desde: desdeInc, ate: periodo.ate }, agora, diasPorFatia);

    const novosProtocolos = [...novosPorProto.keys()];
    const antAgenda = await le(arqAgendaAnt);
    const antPg = await le(arqPgAnt);

    const substituir = new Set<string>(novosProtocolos);
    for (const l of antAgenda.linhas) {
      if (dentroDaJanela(celula(l, 'Slot Agenda'), desdeInc, periodo.ate)) {
        substituir.add(chaveProtocolo(l));
      }
    }

    const linhasAgenda: Record<string, Escalar>[] = antAgenda.linhas.filter(
      (l) => !substituir.has(chaveProtocolo(l)),
    );
    for (const arr of novosPorProto.values()) {
      for (const l of arr) linhasAgenda.push(l);
    }

    let linhasProtocolos: Record<string, Escalar>[] = antPg.linhas.filter(
      (l) => !substituir.has(chaveProtocoloPg(l)),
    );
    let colPg: readonly string[] = antPg.cabecalho.colunas.map((c) => c.nome);
    const buscasPg: BuscaFeita[] = [];
    let msPg = 0;

    if (novosProtocolos.length > 0) {
      const pgNovos = await buscaAoVivo(ctx, {
        query: PROTOCOLOS,
        params: { protocolos: novosProtocolos },
        agora,
      });
      if (pgNovos.colunas.length > 0) colPg = pgNovos.colunas;
      const recortadasPg = aplicaRecorte(pgNovos.linhas, cProtocolos.recorte, {
        protocolos: novosProtocolos,
      });
      linhasProtocolos = [...linhasProtocolos, ...recortadasPg];
      buscasPg.push(...pgNovos.buscas);
      msPg = pgNovos.ms.total;
    }

    const todosProtocolos = new Set(linhasAgenda.map(chaveProtocolo));
    return {
      periodo,
      consultas: [
        {
          query: AGENDA,
          colunas: colAgenda.length > 0 ? colAgenda : antAgenda.cabecalho.colunas.map((c) => c.nome),
          linhas: linhasAgenda,
        },
        { query: PROTOCOLOS, colunas: colPg, linhas: linhasProtocolos },
      ],
      protocolos: todosProtocolos.size,
      buscas: [...buscasAgenda, ...buscasPg],
      ms: { agenda: msAgenda, protocolos: msPg, total: Date.now() - inicio },
    };
  }

  const {
    colunas: colAgenda,
    porProtocolo,
    buscas: buscasAgenda,
    ms: msAgenda,
  } = await buscaAgendaFatiada(ctx, periodo, agora, diasPorFatia);
  const lista = [...porProtocolo.keys()];
  const linhasAgenda = [...porProtocolo.values()].flat();

  const protocolos = await buscaAoVivo(ctx, { query: PROTOCOLOS, params: { protocolos: lista }, agora });
  const linhasProtocolos = aplicaRecorte(protocolos.linhas, cProtocolos.recorte, { protocolos: lista });

  return {
    periodo,
    consultas: [
      { query: AGENDA, colunas: colAgenda, linhas: linhasAgenda },
      { query: PROTOCOLOS, colunas: protocolos.colunas, linhas: linhasProtocolos },
    ],
    protocolos: lista.length,
    buscas: [...buscasAgenda, ...protocolos.buscas],
    ms: { agenda: msAgenda, protocolos: protocolos.ms.total, total: Date.now() - inicio },
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
