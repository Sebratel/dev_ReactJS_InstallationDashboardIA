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
  /** Valor de `:parametro` numa carga COMPLETA — o piso histórico do recorte. */
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
    }
  >;
}

/**
 * Lê `specs/_catalog/incremental.yaml`. Sem o arquivo, ninguém é incremental —
 * que é o estado de hoje de 21 das 22 queries e não é erro.
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
    fora.set(query, {
      query,
      parametro: bruto.parametro!,
      piso: bruto.piso!,
      marca: bruto.marca,
      chave: bruto.chave,
      margemDias: bruto.margem_dias ?? 2,
      idadeMaximaDias: bruto.idade_maxima_dias ?? 7,
      costura: bruto.costura,
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
 */
export function mescla(opts: {
  antigas: readonly Record<string, Escalar>[];
  novas: readonly Record<string, Escalar>[];
  chave: readonly string[];
  marca: readonly string[];
  corte: Date;
}): Mesclagem {
  const chaves = opts.chave.map(normalizeName);
  const marcas = opts.marca.map(normalizeName);
  const corte = opts.corte.getTime();

  const identidade = (l: Record<string, Escalar>): string =>
    chaves.map((k) => (l[k] === null || l[k] === undefined ? ' ' : String(l[k]))).join('');

  const gruposNovos = new Set<string>();
  for (const l of opts.novas) gruposNovos.add(identidade(l));

  const linhas: Record<string, Escalar>[] = [];
  let substituidas = 0;
  let sumidas = 0;
  for (const l of opts.antigas) {
    if (gruposNovos.has(identidade(l))) {
      substituidas++;
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

  return { linhas, substituidas, sumidas, mantidas, novas: opts.novas.length };
}
