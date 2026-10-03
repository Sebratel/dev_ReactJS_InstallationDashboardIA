// Colunas que a página usa e que ficam fora da carga **por decisão**.
//
// Mora no `semantic-model` e não no `snapshot` para que o modelo carregue a lista uma
// vez e todo mundo a receba de graça — a alternativa era cada chamador de `carrega`
// lembrar de ler o arquivo, e o que se esquece de ler vira 350 MB de volta na memória
// sem ninguém notar.
//
// Não confundir com a projeção **derivada** de `backend/packages/snapshot/src/colunas-usadas.ts`,
// que descarta o que ninguém toca. Aquilo é dedução; isto é escolha, e escolha vai em
// arquivo humano com data, dono e motivo.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { normalizeName } from './model.ts';

/** Uma coluna que a página usa e que fica fora da carga assim mesmo. */
export interface SobDemanda {
  tabela: string;
  coluna: string;
  decidido: string;
  por: string;
  porque: string;
}

/**
 * Lê `backend/specs/_catalog/projecao.yaml` — as colunas deixadas de fora **por decisão**.
 *
 * Separado da derivação de propósito. `omissiveis` descarta o que ninguém toca, e isso
 * não é decisão de ninguém: é dedução, e se estiver errada o erro alto aparece. Isto
 * aqui é o oposto — a coluna **é** usada, e alguém escolheu pagar o preço de não a ter.
 * Escolha vai em arquivo humano, com data, dono e motivo, como o `cache-policies.yaml`
 * e o `divergencias.yaml`.
 */
export function leSobDemanda(specsDir: string): SobDemanda[] {
  const arq = path.join(specsDir, '_catalog', 'projecao.yaml');
  if (!fs.existsSync(arq)) return [];
  const spec = parseYaml(fs.readFileSync(arq, 'utf8')) as { sob_demanda?: SobDemanda[] };
  for (const s of spec.sob_demanda ?? []) {
    for (const campo of ['tabela', 'coluna', 'decidido', 'por', 'porque'] as const) {
      if (!s[campo]) {
        throw new Error(
          `projecao.yaml: entrada de sob_demanda sem '${campo}'. Toda coluna deixada ` +
            `de fora por decisão precisa dizer quem decidiu, quando e por quê — ` +
            `senão vira mistério de desempenho na próxima sessão.`,
        );
      }
    }
  }
  return spec.sob_demanda ?? [];
}

/** As colunas sob demanda de uma tabela, normalizadas. */
export function sobDemandaDe(tabela: string, lista: readonly SobDemanda[]): Set<string> {
  const alvo = normalizeName(tabela);
  return new Set(lista.filter((s) => normalizeName(s.tabela) === alvo).map((s) => normalizeName(s.coluna)));
}

/** Como uma coluna sob demanda é nomeada num pedido: `'TABELA'[coluna]`. */
export function rotuloDeColuna(tabela: string, coluna: string): string {
  return `'${tabela}'[${coluna}]`;
}

/**
 * As colunas sob demanda de `tabela` que continuam fora — descontando as liberadas.
 *
 * Liberar é sempre **explícito e por coluna**. A tentação seria um booleano "carregue
 * tudo", e ele acabaria ligado em algum caminho de teste ou de script até virar o
 * padrão de novo, calado. Uma lista obriga quem pede a nomear o que quer.
 */
export function sobDemandaLiberada(
  tabela: string,
  lista: readonly SobDemanda[],
  liberadas: ReadonlySet<string>,
): Set<string> {
  const alvo = normalizeName(tabela);
  const fora = new Set<string>();
  for (const s of lista) {
    if (normalizeName(s.tabela) !== alvo) continue;
    if (liberadas.has(normalizeName(rotuloDeColuna(s.tabela, s.coluna)))) continue;
    fora.add(normalizeName(s.coluna));
  }
  return fora;
}

/**
 * Uma tabela cujo GRÃO é reduzido por padrão — não coluna, LINHA.
 *
 * Mesmo espírito de `SobDemanda`, um nível acima: lá uma coluna fica fora da carga
 * por decisão; aqui a tabela inteira carrega, por padrão, de uma query mais barata
 * (menos linhas, sem os `JOIN`s que multiplicam) — e só escala para `queryCompleta`
 * quando o pedido de fato toca uma das `colunasGatilho`. O caso que motivou isto é
 * `FIELD AGENDA` (ACHADOS #82/#85/#86, `docs/DECISAO-GRAO-FIELD-AGENDA.md`): joins
 * de relato/skill multiplicam ~30 mil slots em ~645 mil linhas, e a maioria dos
 * visuais não precisa de nada além do slot.
 */
export interface GraoReduzido {
  tabela: string;
  queryPadrao: string;
  queryCompleta: string;
  colunasGatilho: string[];
  decidido: string;
  por: string;
  porque: string;
}

/**
 * Lê `backend/specs/_catalog/projecao.yaml` — as tabelas com grão reduzido **por decisão**.
 *
 * Mesma validação loud de `leSobDemanda`: falta de qualquer campo é erro alto, não
 * um `undefined` que vai aparecer como bug de desempenho três semanas depois.
 */
export function leGraoReduzido(specsDir: string): GraoReduzido[] {
  const arq = path.join(specsDir, '_catalog', 'projecao.yaml');
  if (!fs.existsSync(arq)) return [];
  const spec = parseYaml(fs.readFileSync(arq, 'utf8')) as {
    grao_reduzido?: Record<string, unknown>[];
  };
  const lista = spec.grao_reduzido ?? [];
  const obrigatorios = ['tabela', 'query_padrao', 'query_completa', 'colunas_gatilho', 'decidido', 'por', 'porque'] as const;
  for (const g of lista) {
    for (const campo of obrigatorios) {
      const v = g[campo];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        throw new Error(
          `projecao.yaml: entrada de grao_reduzido sem '${campo}'. Toda tabela com grão ` +
            `reduzido por decisão precisa da query padrão, da completa, do gatilho, de ` +
            `quem decidiu, quando e por quê — senão vira mistério de desempenho na ` +
            `próxima sessão.`,
        );
      }
    }
  }
  return lista.map((g) => ({
    tabela: g.tabela as string,
    queryPadrao: g.query_padrao as string,
    queryCompleta: g.query_completa as string,
    colunasGatilho: g.colunas_gatilho as string[],
    decidido: g.decidido as string,
    por: g.por as string,
    porque: g.porque as string,
  }));
}

/** O grão reduzido de `tabela`, se houver — `null` significa "sempre completa". */
export function graoReduzidoDe(tabela: string, lista: readonly GraoReduzido[]): GraoReduzido | null {
  const alvo = normalizeName(tabela);
  return lista.find((g) => normalizeName(g.tabela) === alvo) ?? null;
}
