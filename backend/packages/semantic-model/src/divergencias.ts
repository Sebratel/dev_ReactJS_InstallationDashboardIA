// Onde uma decisão de negócio pode divergir do Power BI sem virar edição em
// arquivo gerado.
//
// **O problema que isto resolve.** `backend/specs/_catalog/{tables,measures}/` é
// **sobrescrito** por `npm run extract` (regra 2 do CONTINUACAO). Então uma decisão
// como a da PERGUNTAS-NEGOCIO #1 — "sábado vale 0,5 e domingo 0,5, porque a equipe é
// reduzida" — não tinha onde morar: escrita na spec, ela sumia na próxima extração;
// não escrita, o relatório continuava servindo a conta que o negócio disse estar
// errada. A pergunta ficou respondida e não implementada por dois dias por causa
// disso.
//
// **Divergir é permitido; divergir em silêncio não.** É a regra 9. Cada divergência
// aqui declara a pergunta que a decidiu, a data, o porquê, e o `sha256` do DAX
// **original** que ela substitui.
//
// **O sha do original é a metade que importa.** Uma substituição sem ele é uma bomba
// de efeito retardado: alguém corrige a fórmula no Power BI, `npm run extract` traz a
// versão nova, e este arquivo silenciosamente a joga fora e continua aplicando um
// remendo decidido contra outra fórmula. Comparando, a extração que mudar o original
// **erra alto** e obriga alguém a reler a decisão. É o mesmo desenho do guarda de
// coluna materializada (ACHADOS #47), pela mesma razão.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

/** `sha256` de um DAX, normalizado em espaço em branco. Igual ao do snapshot. */
export function shaDeDax(dax: string): string {
  return createHash('sha256').update(dax.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

export interface Divergencia {
  /** Identificador curto, para mensagem de erro e para o relatório de paridade. */
  id: string;
  tipo: 'coluna' | 'medida';
  /** Tabela do objeto. Para medida, a tabela em que ela está declarada. */
  tabela: string;
  /** Nome da coluna ou da medida. */
  objeto: string;
  /** A pergunta que decidiu, como `PERGUNTAS-NEGOCIO#1`. */
  pergunta: string;
  /** `AAAA-MM-DD` da decisão. */
  decidido: string;
  porque: string;
  /** `sha256` do DAX gerado que esta divergência substitui. */
  original_sha: string;
  /** O DAX que passa a valer. */
  dax: string;
}

interface ArquivoDeDivergencias {
  divergencias?: Divergencia[];
}

export function leDivergencias(specsDir: string): Divergencia[] {
  const arq = path.join(specsDir, '_catalog', 'divergencias.yaml');
  if (!fs.existsSync(arq)) return [];
  const spec = parseYaml(fs.readFileSync(arq, 'utf8')) as ArquivoDeDivergencias;
  const vistos = new Set<string>();
  for (const d of spec.divergencias ?? []) {
    for (const campo of ['id', 'tipo', 'tabela', 'objeto', 'pergunta', 'decidido', 'porque', 'original_sha', 'dax'] as const) {
      if (!d[campo]) throw new Error(`divergencias.yaml: a divergência '${d.id ?? '(sem id)'}' não declara '${campo}'.`);
    }
    if (vistos.has(d.id)) throw new Error(`divergencias.yaml: id duplicado '${d.id}'.`);
    vistos.add(d.id);
  }
  return spec.divergencias ?? [];
}

/** O que uma divergência trocou de fato. Vai para o relatório, não para o cálculo. */
export interface Aplicada {
  divergencia: Divergencia;
  /** O DAX que estava lá antes — o que o Power BI diz. */
  original: string;
}

/**
 * Aplica as divergências ao modelo já carregado das specs.
 *
 * Erra alto em três casos, todos porque o silêncio seria pior:
 *
 *   1. o objeto não existe — a spec foi regenerada e ele mudou de nome ou sumiu;
 *   2. o objeto não tem DAX — trocar o DAX de uma coluna física não quer dizer nada;
 *   3. o `sha256` do original não bate — a fórmula do Power BI mudou desde a
 *      decisão, e aplicar o remendo por cima esconderia a mudança.
 */
export function aplicaDivergencias(
  model: {
    column(table: string, column: string): { calculated: boolean; dax: string | null } | null;
    measure(name: string): { dax: string } | null;
  },
  divergencias: readonly Divergencia[],
): Aplicada[] {
  const aplicadas: Aplicada[] = [];

  for (const d of divergencias) {
    const alvo =
      d.tipo === 'coluna'
        ? model.column(d.tabela, d.objeto)
        : model.measure(d.objeto);

    if (!alvo) {
      throw new Error(
        `divergencias.yaml: '${d.id}' aponta para ${d.tipo} '${d.tabela}'[${d.objeto}], ` +
          `que não existe no modelo. Ou a spec foi regenerada e o objeto mudou de nome, ` +
          `ou a divergência já não se aplica. Releia ${d.pergunta} antes de apagar.`,
      );
    }

    const original = alvo.dax;
    if (!original) {
      throw new Error(
        `divergencias.yaml: '${d.id}' aponta para '${d.tabela}'[${d.objeto}], que não tem ` +
          `DAX — trocar a fórmula de uma coluna física não significa nada.`,
      );
    }

    const agora = shaDeDax(original);
    if (agora !== d.original_sha) {
      throw new Error(
        `divergencias.yaml: '${d.id}' foi decidida contra um DAX que mudou desde então ` +
          `(${d.original_sha} -> ${agora}) em '${d.tabela}'[${d.objeto}]. Aplicar por cima ` +
          `esconderia a mudança do Power BI. Compare as duas fórmulas, releia ${d.pergunta}, ` +
          `e então atualize 'original_sha' — ou remova a divergência, se o Power BI já a ` +
          `incorporou.`,
      );
    }

    (alvo as { dax: string }).dax = d.dax;
    aplicadas.push({ divergencia: d, original });
  }

  return aplicadas;
}
