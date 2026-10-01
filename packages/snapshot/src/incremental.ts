// Carga incremental: rebuscar só o que mudou e mesclar com o que já está em disco.
//
// **O número que justifica isto** (medido em 25/08/2026,
// `npm run probe:custo-incremental`). `protocolos-produtividade` custa **190,3 s**
// no dbVoalle quando busca 2026 inteiro e **24,9 s** com a janela em 7 dias. Não é
// economia de rede: o plano muda de 16 varreduras sequenciais — uma delas em
// `financial_receivable_titles`, 16 GB — para 8, todas em tabelas de apoio.
//
// Ponta a ponta, a materialização inteira dessa query caiu de **238 s para 67 s**.
// A diferença entre os 24,9 s de banco e os 67 s é o custo fixo desta abordagem:
// ler os 58 MB anteriores, mesclar, recalcular as colunas de DAX e regravar.
//
// **Não confunda com o recorte ingênuo.** Trocar só o literal de data por
// `a.created >= :desde` dá 1,2 s — e traz 2.140 linhas onde o recorte correto traz
// 3.956. As 1.816 de diferença são solicitações antigas que MUDARAM, e um
// incremental que as perdesse não erraria alto: serviria número velho, calado.
//
// **Por que a política mora fora da spec.** As specs de `specs/_catalog/queries`
// são GERADAS e `npm run extract` as sobrescreve. "Quanto de histórico rebuscar",
// "o que identifica a linha" e "quando exigir carga completa" são decisões
// humanas, e por isso vivem em `specs/_catalog/incremental.yaml`, ao lado de
// `cache-policies.yaml` e `juncoes.yaml`, que existem pela mesma razão.
//
// -----------------------------------------------------------------------------
// AS TRÊS ARMADILHAS, E O QUE CADA UMA COBRA
// -----------------------------------------------------------------------------
//
// **1. A marca não pode ser a data de criação.** Medido em 25/08/2026: 6.248
// solicitações criadas antes do corte de 30 dias foram MODIFICADAS depois dele.
// Uma janela sobre `created` deixaria essas 6.248 congeladas no valor velho, sem
// erro nenhum — a falha mais cara que este projeto pode cometer. A marca é o
// **máximo** entre criação e modificação, e o SQL incremental recorta por ela.
//
// **2. O recorte é por GRUPO, não por linha.** O SQL usa
// `ROW_NUMBER() OVER (PARTITION BY "SOLICITACAO")` para escolher qual linha
// sobrevive. Medido: 9,57% dos títulos de 2026 se repetem entre solicitações
// diferentes. Trazer meia partição daria um `PERSONA1` diferente e mudaria o
// resultado. Por isso `chave` nomeia o grupo que é reentregue inteiro, e a
// mesclagem apaga o grupo antes de inserir o novo — nunca linha a linha.
//
// **3. Nem tudo que muda a linha toca a solicitação.** Uma alocação de patrimônio
// registrada hoje muda `INSTALADO POR:` de um protocolo de março. Medido: só
// 84,2% das alocações recentes marcam a solicitação-pai como modificada — 15,8%
// escapariam. É por isso que a costura do SQL tem mais de um ramo em `alvos`, e
// não só `assignments.modified`.
//
// **O que a carga incremental NÃO faz, e por isso existe `idade_maxima_dias`.**
// Ela não vê linha que sumiu da fonte sem deixar rastro de data. `--incremental`
// se recusa a rodar quando a última carga completa é mais velha que o teto, e diz
// o que rodar. É melhor a ferramenta parar e explicar do que servir um conjunto
// que ninguém sabe mais de quando é.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { normalizeName } from '../../semantic-model/src/model.ts';
import type { Escalar } from './formato.ts';

const ARQUIVO = path.join('_catalog', 'incremental.yaml');

/** Uma costura de texto no SQL completo, com âncora exata. */
export interface Costura {
  /** Trecho literal do SQL da spec. Some do SQL ⇒ a carga incremental para. */
  de: string;
  /** O que entra no lugar. É onde o `:parametro` aparece. */
  para: string;
}

export interface PoliticaIncremental {
  query: string;
  /** O `:nome` que o SQL costurado cita. */
  parametro: string;
  /** Valor de `:parametro` numa carga COMPLETA — o piso histórico do recorte.
   * Aceita `'ano-corrente'` para resolver automaticamente para `YYYY-01-01` do ano atual.
   */
  piso: string;
  /**
   * Colunas do RESULTADO cujo **máximo** é a marca d'água da linha.
   *
   * Lista, e não uma coluna: a criação e a modificação vivem em colunas
   * diferentes, e a modificação é nula em linha que nunca mudou. Ver a armadilha 1.
   */
  marca: string[];
  /** Colunas que identificam o GRUPO reentregue junto. Ver a armadilha 2. */
  chave: string[];
  /** Quantos dias antes da marca a busca recomeça — folga contra relógio torto. */
  margemDias: number;
  /** Depois disto sem carga completa, `--incremental` se recusa a rodar. */
  idadeMaximaDias: number;
  costura: Costura[];
  /** Só para fonte com recorte DESLIZANTE. Ver `PisoDeJanela`. */
  pisoDeJanela?: PisoDeJanela;
}

/**
 * O recorte deslizante da fonte, repetido do lado de cá — `field-agenda` foi a
 * primeira (ACHADOS #165).
 *
 * **Por que a mesclagem precisa saber dele.** A carga completa traz só
 * `coluna >= CURRENT_DATE - meses`. A incremental reentrega só quem MUDOU, e uma
 * linha que apenas envelheceu para fora da janela não muda — não volta, e a
 * mesclagem a manteria para sempre. O arquivo cresceria um dia por dia, e a tela
 * passaria a contar o que a fonte já não conta. Este piso descarta, das linhas
 * antigas, o que a fonte já descartou.
 */
export interface PisoDeJanela {
  /** Coluna do RESULTADO que o SQL recorta (`Slot Agenda`). */
  coluna: string;
  /** O `INTERVAL '<meses> months'` do SQL. `costura` confere que ele está lá. */
  meses: number;
}

interface ArquivoIncremental {
  formato?: number;
  queries?: Record<
    string,
    {
      parametro?: string;
      piso?: string;
      marca?: string[];
      chave?: string[];
      margem_dias?: number;
      idade_maxima_dias?: number;
      costura?: Costura[];
      piso_de_janela?: { coluna?: string; meses?: number };
    }
  >;
}

/** Resolve o token `'ano-corrente'` para `YYYY-01-01` do ano atual (UTC). */
function resolverPiso(piso: string): string {
  if (piso === 'ano-corrente') {
    return `${new Date().getUTCFullYear()}-01-01`;
  }
  return piso;
}

/**
 * Lê `specs/_catalog/incremental.yaml`. Sem o arquivo, ninguém é incremental —
 * que é o estado de 21 das 23 queries (01/10/2026) e não é erro.
 */
export function lePoliticas(specsDir: string): Map<string, PoliticaIncremental> {
  const p = path.join(specsDir, ARQUIVO);
  const fora = new Map<string, PoliticaIncremental>();
  if (!fs.existsSync(p)) return fora;

  const doc = (parseYaml(fs.readFileSync(p, 'utf8')) ?? {}) as ArquivoIncremental;
  if (doc.formato !== undefined && doc.formato !== 1) {
    throw new Error(`${p}: formato ${doc.formato}, esperado 1.`);
  }
  for (const [query, bruto] of Object.entries(doc.queries ?? {})) {
    const falta = (['parametro', 'piso'] as const).filter((k) => !bruto[k]);
    if (falta.length) throw new Error(`${p}: ${query} não declara ${falta.join(', ')}.`);
    if (!bruto.marca?.length) throw new Error(`${p}: ${query} não declara 'marca'.`);
    if (!bruto.chave?.length) throw new Error(`${p}: ${query} não declara 'chave'.`);
    if (!bruto.costura?.length) throw new Error(`${p}: ${query} não declara 'costura'.`);
    const janela = bruto.piso_de_janela;
    if (janela && (!janela.coluna || !Number.isInteger(janela.meses) || janela.meses! <= 0)) {
      throw new Error(`${p}: ${query} declara 'piso_de_janela' sem 'coluna' ou com 'meses' não inteiro positivo.`);
    }
    fora.set(query, {
      query,
      parametro: bruto.parametro!,
      piso: resolverPiso(bruto.piso!),
      marca: bruto.marca,
      chave: bruto.chave,
      margemDias: bruto.margem_dias ?? 2,
      idadeMaximaDias: bruto.idade_maxima_dias ?? 7,
      costura: bruto.costura,
      ...(janela ? { pisoDeJanela: { coluna: janela.coluna!, meses: janela.meses! } } : {}),
    });
  }
  return fora;
}

/**
 * Aplica as costuras ao SQL completo e devolve o SQL incremental.
 *
 * **Erra alto quando a âncora não existe, e nunca cai calada na consulta
 * completa.** Uma âncora que sumiu significa que o SQL mudou embaixo da política;
 * seguir em frente traria o recorte errado — ou nenhum recorte — e a mesclagem
 * gravaria isso em disco como se fosse verdade.
 *
 * **Uma âncora tem de casar exatamente uma vez.** Duas ocorrências fariam
 * `String.replace` trocar só a primeira, e o SQL sairia meio costurado.
 */
export function costura(sql: string, p: PoliticaIncremental): string {
  // O piso de janela repete, do lado de cá, um número que mora no SQL. Se o SQL
  // passar a recortar outra janela, a mesclagem descartaria pelo número velho —
  // linha que a fonte ainda traz sumiria do arquivo, ou a que ela já tirou ficaria.
  if (p.pisoDeJanela && !sql.includes(`INTERVAL '${p.pisoDeJanela.meses} months'`)) {
    throw new Error(
      `${p.query}: 'piso_de_janela' diz ${p.pisoDeJanela.meses} mês(es), e o SQL não cita ` +
        `INTERVAL '${p.pisoDeJanela.meses} months'. A janela da fonte mudou embaixo da política — ` +
        `corrija specs/_catalog/incremental.yaml ou rode a carga completa (--refazer).`,
    );
  }
  let saida = sql;
  for (const c of p.costura) {
    const quantas = saida.split(c.de).length - 1;
    if (quantas !== 1) {
      throw new Error(
        `${p.query}: a âncora da costura incremental aparece ${quantas} vez(es) no SQL, ` +
          `esperado exatamente 1. Âncora:\n  ${c.de.split('\n')[0]}\n` +
          `Corrija specs/_catalog/incremental.yaml ou rode a carga completa (--refazer).`,
      );
    }
    saida = saida.replace(c.de, c.para);
  }
  if (!saida.includes(`:${p.parametro}`)) {
    throw new Error(
      `${p.query}: o SQL costurado não cita ':${p.parametro}'. ` +
        `Sem o parâmetro a consulta traria o conjunto inteiro e a mesclagem o gravaria como recorte.`,
    );
  }
  return saida;
}

// ------------------------------------------------------------------ marca d'água

/** A marca de uma linha: o maior valor entre as colunas de marca. Chave normalizada. */
function marcaDaLinha(linha: Record<string, Escalar>, chaves: readonly string[]): number | null {
  let maior: number | null = null;
  for (const k of chaves) {
    const v = linha[k];
    if (!(v instanceof Date)) continue;
    const t = v.getTime();
    if (Number.isNaN(t)) continue;
    if (maior === null || t > maior) maior = t;
  }
  return maior;
}

/**
 * A maior marca do conjunto — a data até onde este arquivo é verdade.
 *
 * `null` quando nenhuma linha tem data válida: aí não há de onde continuar, e
 * quem chama trata isso como "só a carga completa serve".
 */
export function marcaDe(
  linhas: readonly Record<string, Escalar>[],
  colunasDeMarca: readonly string[],
): Date | null {
  const chaves = colunasDeMarca.map(normalizeName);
  let maior: number | null = null;
  for (const l of linhas) {
    const m = marcaDaLinha(l, chaves);
    if (m !== null && (maior === null || m > maior)) maior = m;
  }
  return maior === null ? null : new Date(maior);
}

/** `YYYY-MM-DD` em UTC — o formato que o `:desde` do SQL recebe. */
export function comoDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * De onde a próxima busca começa: a marca menos a margem, nunca antes do piso.
 *
 * A margem existe porque a marca vem do **dado**, não do relógio desta máquina, e
 * as duas coisas não andam juntas: um registro gravado com data de ontem depois de
 * a materialização ter passado ficaria para trás para sempre. Dois dias de folga
 * custam segundos e fecham essa porta.
 */
export function desdeDe(marca: Date, p: PoliticaIncremental): string {
  const recuado = new Date(marca.getTime() - p.margemDias * 86_400_000);
  const dia = comoDia(recuado);
  return dia < p.piso ? p.piso : dia;
}

/**
 * O fuso do `CURRENT_DATE` do dbVoalle: `localtime`, -03, medido em 01/10/2026
 * (`current_setting('TimeZone')`). O dia que vale é o de Brasília, não o desta máquina
 * nem o UTC — às 22h de Brasília o UTC já virou o dia.
 */
const FUSO_DO_BANCO = 'America/Sao_Paulo';

/**
 * O `CURRENT_DATE - INTERVAL '<meses> months'` do banco, como o conector o entrega:
 * meia-noite daquele dia **lida como UTC** (`parseSemFuso` em `connectors-sql.ts` lê
 * `timestamp without time zone` sem mover o relógio). Comparar com a coluna da
 * linha, então, é comparar relógio de parede com relógio de parede.
 *
 * Mesma aritmética do Postgres para mês curto: o dia é limitado ao último do mês de
 * destino (`2026-05-31 - 3 months` = `2026-02-28`), sem transbordar para março como
 * `Date.setUTCMonth` faria.
 */
export function pisoDaJanela(agora: Date, meses: number): Date {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_BANCO }).format(agora);
  const [ano, mes, dia] = hoje.split('-').map(Number) as [number, number, number];
  const alvo = ano * 12 + (mes - 1) - meses;
  const anoAlvo = Math.floor(alvo / 12);
  const mesAlvo = alvo - anoAlvo * 12;
  const ultimoDia = new Date(Date.UTC(anoAlvo, mesAlvo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anoAlvo, mesAlvo, Math.min(dia, ultimoDia)));
}

// ---------------------------------------------------------------------- decisão

/** O que decidir sobre uma query incremental, olhando o cabeçalho anterior. */
export type Decisao =
  | { pode: true; desde: string; completoEm: string }
  | { pode: false; porque: string };

/** Só o que a decisão precisa do cabeçalho — o teste não monta um arquivo inteiro. */
export interface CabecalhoAnterior {
  marca?: string;
  modo?: 'completo' | 'incremental';
  completoEm?: string;
  geradoEm: string;
}

/**
 * Decide se dá para carregar incrementalmente, e devolve o motivo quando não dá.
 *
 * Função pura de propósito: é aqui que mora a **trava de idade**, e uma trava que
 * só dá para exercitar rodando uma carga de 4 minutos contra o banco é uma trava
 * que ninguém testa. Ver `packages/snapshot/test/incremental.test.ts`.
 *
 * **A idade que conta é a da última carga COMPLETA, não a do arquivo.** Uma
 * corrente de incrementais mantém `geradoEm` sempre novo e mesmo assim vai ficando
 * cega para o que sumiu da fonte sem deixar data — é exatamente esse o caso que a
 * trava existe para pegar.
 */
export function decideIncremental(
  cab: CabecalhoAnterior,
  p: PoliticaIncremental,
  agora: Date,
): Decisao {
  if (!cab.marca) return { pode: false, porque: 'o arquivo anterior é de antes da marca d’água' };

  const marca = new Date(cab.marca);
  if (Number.isNaN(marca.getTime())) {
    return { pode: false, porque: `a marca anterior não é data: ${cab.marca}` };
  }

  // `geradoEm` como reserva serve ao arquivo gravado antes de `completoEm` existir:
  // ele é, por definição, de uma carga completa.
  const completoEm = cab.completoEm ?? cab.geradoEm;
  const quando = new Date(completoEm);
  if (Number.isNaN(quando.getTime())) {
    return { pode: false, porque: `a data da última carga completa não é data: ${completoEm}` };
  }

  const dias = (agora.getTime() - quando.getTime()) / 86_400_000;
  if (dias > p.idadeMaximaDias) {
    return {
      pode: false,
      porque:
        `a última carga completa tem ${dias.toFixed(1)} dias (teto: ${p.idadeMaximaDias}). ` +
        `A incremental não enxerga linha que sumiu da fonte sem data`,
    };
  }
  // Marca no futuro é relógio torto ou dado com data errada. Seguir daria uma
  // janela vazia — a busca não traria nada e a mesclagem manteria tudo, com cara
  // de refresh que funcionou.
  if (marca.getTime() > agora.getTime() + 86_400_000) {
    return { pode: false, porque: `a marca (${comoDia(marca)}) está no futuro` };
  }

  return { pode: true, desde: desdeDe(marca, p), completoEm };
}

// -------------------------------------------------------------------- mesclagem

export interface Mesclagem {
  linhas: Record<string, Escalar>[];
  /** Linhas antigas que o grupo reentregue substituiu. */
  substituidas: number;
  /** Linhas antigas dentro da janela que a fonte NÃO reentregou — sumiram. */
  sumidas: number;
  /** Linhas antigas preservadas (fora da janela e sem grupo novo). */
  mantidas: number;
  /** Linhas antigas que envelheceram para fora do recorte deslizante da fonte. */
  expiradas: number;
  /** Linhas que a busca trouxe. */
  novas: number;
}

/**
 * Junta o que estava em disco com o que a busca incremental trouxe.
 *
 * **A regra, e por que ela tem duas metades.**
 *
 * 1. *A janela é reentregue inteira.* Tudo que a fonte diz existir a partir de
 *    `corte` está em `novas`. Uma linha antiga com marca dentro da janela que não
 *    voltou **deixou de existir** — foi cancelada, ou saiu do filtro. Manter seria
 *    ressuscitar dado que a fonte já não tem.
 *
 * 2. *Grupo que voltou substitui o grupo que estava.* Uma linha cuja marca era de
 *    março e passou a ser de hoje está nas duas pontas: fora da janela no arquivo
 *    e dentro dela na busca. Sem esta metade, ela apareceria duas vezes.
 *
 * A substituição é por **grupo** e não por linha porque a multiplicidade importa:
 * o append dos dois ramos entrega a mesma linha duas vezes de propósito, e um
 * `Map` por linha achataria isso. Apagar o grupo e inserir o que veio preserva a
 * contagem que a tela conta.
 *
 * **E uma terceira, só para fonte com recorte deslizante (`pisoDeJanela`).** Linha
 * antiga com a coluna abaixo do piso — ou nula, que o `>=` do SQL também deixa de
 * fora — sai, porque a carga completa de agora já não a traria. Vale só para as
 * ANTIGAS: as novas vieram do SQL, que recortou pelo `CURRENT_DATE` do próprio
 * banco, e recortá-las de novo por um relógio daqui só poderia discordar dele.
 */
export function mescla(opts: {
  antigas: readonly Record<string, Escalar>[];
  novas: readonly Record<string, Escalar>[];
  chave: readonly string[];
  marca: readonly string[];
  corte: Date;
  pisoDeJanela?: { coluna: string; desde: Date };
}): Mesclagem {
  const chaves = opts.chave.map(normalizeName);
  const marcas = opts.marca.map(normalizeName);
  const corte = opts.corte.getTime();
  const colunaDoPiso = opts.pisoDeJanela ? normalizeName(opts.pisoDeJanela.coluna) : null;
  const piso = opts.pisoDeJanela?.desde.getTime() ?? null;
  const expirou = (l: Record<string, Escalar>): boolean => {
    if (colunaDoPiso === null || piso === null) return false;
    const v = l[colunaDoPiso];
    return !(v instanceof Date) || Number.isNaN(v.getTime()) || v.getTime() < piso;
  };

  const identidade = (l: Record<string, Escalar>): string =>
    chaves.map((k) => (l[k] === null || l[k] === undefined ? ' ' : String(l[k]))).join('');

  const gruposNovos = new Set<string>();
  for (const l of opts.novas) gruposNovos.add(identidade(l));

  const linhas: Record<string, Escalar>[] = [];
  let substituidas = 0;
  let sumidas = 0;
  let expiradas = 0;
  for (const l of opts.antigas) {
    if (gruposNovos.has(identidade(l))) {
      substituidas++;
      continue;
    }
    if (expirou(l)) {
      expiradas++;
      continue;
    }
    const m = marcaDaLinha(l, marcas);
    if (m !== null && m >= corte) {
      sumidas++;
      continue;
    }
    linhas.push(l);
  }
  const mantidas = linhas.length;
  for (const l of opts.novas) linhas.push(l);

  return { linhas, substituidas, sumidas, mantidas, expiradas, novas: opts.novas.length };
}

// ---------------------------------------------------------------------- plano

/** O que buscar, e como gravar o cabeçalho depois — a fiação entre decisão e busca. */
export interface PlanoDeBusca {
  /** SQL a executar: costurado (incremental) ou o original, sem alteração (completo). */
  sql: string;
  /** Parâmetros nomeados do SQL (`:desde` etc.). Vazio em carga completa. */
  params: Record<string, unknown>;
  modo: 'completo' | 'incremental';
  /** Início da janela reentregue — só em modo incremental. `mescla()` usa como `corte`. */
  corte: Date | null;
  /** Vai para `CabecalhoDeSnapshot.completoEm`. */
  completoEm: string;
}

/**
 * Decide COMO buscar — a costura de `materializa()` com o resto de `incremental.ts`.
 *
 * Função pura de propósito, pela mesma razão de `decideIncremental`: a decisão de
 * qual SQL rodar não pode só ser exercitável rodando contra o `dbVoalle` de verdade.
 *
 * **Sem política, ou sem pedido de incremental, é sempre carga completa** — mesmo
 * que o arquivo anterior exista e tenha marca. Isso é intencional: `--incremental`
 * é a intenção do OPERADOR (ver o comentário em `tools/snapshot/src/index.ts` sobre
 * `rodaEmSubprocesso`), não algo que a ferramenta decide sozinha por a política
 * existir — um `npm run snapshot -- --query=x --refazer` sem `--incremental` deve
 * continuar buscando tudo, do jeito que sempre buscou.
 *
 * **Sem arquivo anterior, é sempre carga completa** — não há de onde `decideIncremental`
 * partir. É a primeira carga da query, e a primeira carga não tem o que ser incremental.
 *
 * Mesmo em carga completa, quando a query TEM política, o cabeçalho ainda precisa de
 * `modo: 'completo'` e `completoEm: agora` — é o que dá a uma carga incremental FUTURA
 * algo de onde partir. Sem isso, toda query com política ficaria presa em
 * "sem arquivo anterior" para sempre.
 */
export function planejaBusca(
  sqlOriginal: string,
  cabAnterior: CabecalhoAnterior | null,
  politica: PoliticaIncremental | undefined,
  agora: Date,
  tentarIncremental: boolean,
): { plano: PlanoDeBusca; aviso: string | null } {
  const completo = (aviso: string | null): { plano: PlanoDeBusca; aviso: string | null } => ({
    plano: {
      sql: sqlOriginal,
      params: {},
      modo: 'completo',
      corte: null,
      completoEm: agora.toISOString(),
    },
    aviso,
  });

  if (!politica || !tentarIncremental) return completo(null);
  if (!cabAnterior) return completo(null);

  const decisao = decideIncremental(cabAnterior, politica, agora);
  if (!decisao.pode) return completo(`incremental recusada (${decisao.porque}). Carga completa.`);

  return {
    plano: {
      sql: costura(sqlOriginal, politica),
      params: { [politica.parametro]: decisao.desde },
      modo: 'incremental',
      corte: new Date(decisao.desde),
      completoEm: decisao.completoEm,
    },
    aviso: null,
  };
}
