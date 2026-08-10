// Colunas que a página usa e que ficam fora da carga **por decisão**.
//
// Mora no `semantic-model` e não no `snapshot` para que o modelo carregue a lista uma
// vez e todo mundo a receba de graça — a alternativa era cada chamador de `carrega`
// lembrar de ler o arquivo, e o que se esquece de ler vira 350 MB de volta na memória
// sem ninguém notar.
//
// Não confundir com a projeção **derivada** de `packages/snapshot/src/colunas-usadas.ts`,
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
 * Lê `specs/_catalog/projecao.yaml` — as colunas deixadas de fora **por decisão**.
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
