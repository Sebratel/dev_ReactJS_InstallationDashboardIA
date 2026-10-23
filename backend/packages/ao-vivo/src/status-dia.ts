// `Status Protocolo Dia` ao vivo, sem trazer a agenda no grão relato para a API.
//
// A tabela é o agrupamento de `backend/packages/snapshot/src/nativas.ts`
// (`statusProtocoloDia`), conferido célula a célula contra o DAX (0 divergências em
// 13.045 linhas, `npm run probe:status-dia`). Ela tem duas metades:
//
//   1. o GRUPO por (protocolo, dia do slot), com o MAX de base, turno, rank e tipo — sai
//      da agenda no grão de slot, que já vem ao vivo;
//   2. três contagens por (protocolo, dia): instalado (de PROTOCOLOS GERAL), relato
//      improdutivo e relato de técnico. As duas últimas dependem do TEXTO e da skill
//      dos relatos — no grão relato são 220 mil linhas e ~3 min em 30 dias — e por isso
//      vêm do banco já contadas (`relatos-do-dia` em ao-vivo.yaml).
//
// A função de `nativas.ts` é usada COMO ESTÁ, e não reescrita (o arquivo tem um byte NUL
// e não pode ser editado por ferramenta; e duas cópias da regra divergem sem ninguém
// notar). Ela recebe uma entrada EQUIVALENTE à do grão relato: as linhas de slot, com os
// campos de relato vazios, mais uma linha "de relato" por (protocolo, dia) contado — cópia
// de uma linha de slot do MESMO protocolo, para não criar grupo nem mudar MAX. Para as
// contagens, só importa haver ou não linha naquele (protocolo, dia): o `SWITCH` testa
// `> 0`. `status-dia.test.ts` prova a equivalência contra o grão relato.

import type { ResolvedQuery } from '../../query-engine/src/types.ts';
import type { SemanticModel } from '../../semantic-model/src/model.ts';
import type { Escalar } from '../../snapshot/src/formato.ts';
import { statusProtocoloDia } from '../../snapshot/src/nativas.ts';
import { sqlDaAgregada, type AgregadaAoVivo } from './catalogo.ts';
import type { ContextoAoVivo } from './executor.ts';
import { celula, texto } from './recorte.ts';

export interface RelatoDoDia {
  readonly protocolo: string;
  /** `AAAA-MM-DD`, ou `null` quando o relato não tem data (vira o dia 0 do DAX). */
  readonly dia: string | null;
  readonly improdutivo: boolean;
  readonly tecnico: boolean;
}

export interface RegraDoRelato {
  /** O trecho procurado no texto do relato (`CONTAINSSTRING`, sem caixa). */
  readonly trecho: string;
  /** A `ClassificacaoRelato` que a regra devolve. */
  readonly classificacao: string;
  /** A `CategoriaProdutividade` que essa classificação dá, ou `null` (BLANK). */
  readonly categoria: string | null;
}

const REGRA = /CONTAINSSTRING\(\s*Texto\s*,\s*"([^"]+)"\s*\)\s*,\s*"([^"]+)"/g;

/**
 * As regras do relato, lidas das duas colunas DAX — na ordem do `SWITCH(TRUE())`, que é
 * a regra: a primeira que casa decide. Recusa se o DAX mudar de forma, em vez de gerar
 * SQL que já não corresponde ao modelo.
 */
export function regrasDoRelato(daxClassificacao: string, daxCategoria: string): RegraDoRelato[] {
  if (!/VAR\s+Texto\s*=\s*'FIELD AGENDA'\[Relato\]/.test(daxClassificacao) || !/SWITCH\s*\(\s*TRUE\s*\(\s*\)/.test(daxClassificacao)) {
    throw new Error("ClassificacaoRelato mudou de forma (esperado VAR Texto = 'FIELD AGENDA'[Relato] e SWITCH(TRUE(), …)) — revise status-dia.ts");
  }
  const classificacoes = [...daxClassificacao.matchAll(REGRA)].map((m) => ({ trecho: m[1]!, classificacao: m[2]! }));
  const chamadas = daxClassificacao.match(/CONTAINSSTRING\s*\(/g)?.length ?? 0;
  if (classificacoes.length === 0 || classificacoes.length !== chamadas) {
    throw new Error(`ClassificacaoRelato: li ${classificacoes.length} regra(s) de ${chamadas} CONTAINSSTRING — o DAX tem forma que este gerador não conhece`);
  }
  if (!/VAR\s+Texto\s*=\s*'FIELD AGENDA'\[ClassificacaoRelato\]/.test(daxCategoria)) {
    throw new Error('CategoriaProdutividade mudou de forma (esperado VAR Texto = [ClassificacaoRelato]) — revise status-dia.ts');
  }
  const categorias = [...daxCategoria.matchAll(REGRA)].map((m) => ({ trecho: m[1]!, valor: m[2]! }));
  if (categorias.length !== (daxCategoria.match(/CONTAINSSTRING\s*\(/g)?.length ?? 0) || categorias.length === 0) {
    throw new Error('CategoriaProdutividade: forma que este gerador não conhece — revise status-dia.ts');
  }
  return classificacoes.map((c) => ({
    ...c,
    categoria: categorias.find((k) => c.classificacao.toLowerCase().includes(k.trecho.toLowerCase()))?.valor ?? null,
  }));
}

/** Literal de `ILIKE '%…%'`: aspas dobradas e `\ % _` escapados (o escape padrão do LIKE). */
function contem(coluna: string, trecho: string): string {
  const escapado = trecho.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/'/g, "''");
  return `${coluna} ILIKE '%${escapado}%'`;
}

/**
 * `CategoriaProdutividade` como expressão SQL sobre o texto do relato.
 *
 * Com um pré-filtro quando todo trecho contém "PROD": sem ele, as 38 comparações de
 * texto em todo relato custaram 50 s em 30 dias; com ele, 4,9 s (22/10/2026). O
 * pré-filtro só tira relato que de todo jeito cairia em BLANK.
 */
export function categoriaDoRelatoSql(model: SemanticModel, coluna = 'r.description'): string {
  const t = model.table('FIELD AGENDA');
  const dax = (nome: string) => t?.columns.find((c) => c.name === nome)?.dax ?? '';
  const regras = regrasDoRelato(dax('ClassificacaoRelato'), dax('CategoriaProdutividade'));
  const valor = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
  const casos = regras.map((r) => `WHEN ${contem(coluna, r.trecho)} THEN ${valor(r.categoria)}`).join('\n            ');
  const interno = `CASE\n            ${casos}\n            ELSE NULL END`;
  const preFiltro = regras.every((r) => r.trecho.toUpperCase().includes('PROD'));
  return preFiltro ? `CASE WHEN ${contem(coluna, 'PROD')} THEN (${interno}) END` : interno;
}

/** O SQL de `relatos-do-dia`, com a categoria gerada do modelo. */
export function sqlRelatosDoDia(ctx: Pick<ContextoAoVivo, 'registry' | 'model'>, agregada: AgregadaAoVivo): string {
  return sqlDaAgregada(ctx.registry.get(agregada.base).sql ?? '', agregada, {
    categoria_do_relato: categoriaDoRelatoSql(ctx.model),
  });
}

export async function buscaRelatosDoDia(
  ctx: ContextoAoVivo,
  agregada: AgregadaAoVivo,
  periodo: { readonly desde: string; readonly ate: string },
): Promise<RelatoDoDia[]> {
  const base = ctx.registry.get(agregada.base);
  const conector = ctx.connectors.get(base.datasource ?? '');
  if (!conector) throw new Error(`relatos-do-dia: sem conector para '${base.datasource}'`);
  const q: ResolvedQuery = { ...base, id: `${agregada.base}:${agregada.nome}`, sql: sqlRelatosDoDia(ctx, agregada) };
  const linhas = await conector.execute(q, { desde: periodo.desde, ate: periodo.ate });
  return linhas.map((l) => ({
    protocolo: String(l['Protocolo']),
    dia: l['Dia Relato'] === null || l['Dia Relato'] === undefined ? null : String(l['Dia Relato']),
    improdutivo: l['Improdutivo'] === true,
    tecnico: l['Tecnico'] === true,
  }));
}

/**
 * `Status Protocolo Dia` a partir da agenda no grão de slot, das contagens dos relatos e
 * de PROTOCOLOS GERAL — pela função de `nativas.ts`, com entrada equivalente à do grão
 * relato (ver o topo deste arquivo).
 */
export function statusProtocoloDiaAoVivo(
  agendaSlot: readonly Readonly<Record<string, Escalar>>[],
  relatos: readonly RelatoDoDia[],
  protocolosGeral: readonly Readonly<Record<string, Escalar>>[],
): Record<string, Escalar>[] {
  const slots: Record<string, Escalar>[] = agendaSlot.map((l) => ({
    protocolo: celula(l, 'Protocolo'),
    'slot agenda': celula(l, 'Slot Agenda'),
    base: celula(l, 'Base'),
    turno: celula(l, 'Turno'),
    rankdataprotocolo: celula(l, 'RankDataProtocolo'),
    'tipo de protocolo': celula(l, 'Tipo de Protocolo'),
    'data relato': null,
    categoriaprodutividade: null,
    skill: null,
  }));
  const modelo = new Map<string, Record<string, Escalar>>();
  for (const s of slots) {
    const p = texto(s['protocolo'] ?? null);
    if (!modelo.has(p)) modelo.set(p, s);
  }
  const deRelato: Record<string, Escalar>[] = [];
  for (const r of relatos) {
    if (!r.improdutivo && !r.tecnico) continue;
    const m = modelo.get(r.protocolo);
    // Relato de protocolo sem slot carregado não tem grupo onde contar — no grão relato
    // ele também não teria, porque a linha dele É uma linha de slot.
    if (!m) continue;
    deRelato.push({
      ...m,
      'data relato': r.dia === null ? null : new Date(`${r.dia}T00:00:00Z`),
      categoriaprodutividade: r.improdutivo ? 'Improdutiva' : null,
      skill: r.tecnico ? 'skill' : null,
    });
  }
  const pg = protocolosGeral.map((l) => ({
    'n°protocolo': celula(l, 'N°PROTOCOLO'),
    'data instalação': celula(l, 'DATA INSTALAÇÃO'),
  }));
  return statusProtocoloDia([...slots, ...deRelato], pg);
}
