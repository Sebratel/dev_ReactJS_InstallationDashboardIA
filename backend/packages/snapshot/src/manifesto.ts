// O índice do snapshot: o que está em disco, com quantas linhas e de quando.
//
// **Por que um índice, se os arquivos estão ali.** Duas perguntas que ninguém deve
// responder abrindo 16 arquivos: *a página X calcula com o que já foi
// materializado?* e *de quando é este número?*. A segunda é da tela — o relatório
// do Power BI mostra a hora do refresh, e a plataforma tem de mostrar a dela.
//
// O manifesto **acumula**. Materializar uma segunda página não pode apagar do
// índice o que a primeira deixou em disco — senão a terceira execução rebuscaria
// tudo, e rebuscar `field-agenda` custa 1,4 milhão de linhas.

import fs from 'node:fs';
import path from 'node:path';
import { renomeiaComRetentativa } from './escrita-atomica.ts';
import { escolheGemeo, SUFIXO_COMPRIMIDO, SUFIXO_CRU } from './formato.ts';

/** Onde o snapshot mora por padrão, relativo à raiz do repositório. */
export const DIRETORIO_PADRAO = 'snapshot';

const MANIFESTO = 'manifesto.json';

export interface EntradaDeManifesto {
  query: string;
  tabelas: string[];
  linhas: number;
  colunas: number;
  bytes: number;
  /** ISO UTC de quando a query foi materializada. */
  geradoEm: string;
  /** Copiados do cabeçalho do arquivo — ver `CabecalhoDeSnapshot` em `formato.ts`. */
  marca?: string;
  modo?: 'completo' | 'incremental';
  completoEm?: string;
}

export interface Manifesto {
  formato: 1;
  tabelas: EntradaDeManifesto[];
}

/**
 * O arquivo de uma query que está EM DISCO. O nome é o id — é o que foi materializado.
 *
 * Comprimido tem precedência, e os dois juntos erram alto (ver `escolheGemeo` em
 * `formato.ts`). Sem nenhum dos dois, devolve o caminho do cru: é o que permite a
 * `carrega.ts` e ao `snapshot` testarem `fs.existsSync` no resultado.
 *
 * **Não use isto para escolher onde GRAVAR** — se o cru já existe, ele devolveria o
 * cru e a carga seguinte nunca migraria para comprimido. Quem grava chama
 * `arquivoDeEscrita`.
 */
export function arquivoDaQuery(dir: string, query: string): string {
  return escolheGemeo(path.join(dir, `${query}${SUFIXO_CRU}`));
}

/**
 * Onde GRAVAR o arquivo de uma query. Não olha o disco: o sufixo vem da decisão de
 * quem chama, e é `escreve()` que apaga o gêmeo do outro sufixo depois de gravar.
 */
export function arquivoDeEscrita(dir: string, query: string, comprimido: boolean): string {
  return path.join(dir, `${query}${comprimido ? SUFIXO_COMPRIMIDO : SUFIXO_CRU}`);
}

export function leManifesto(dir: string): Manifesto | null {
  const p = path.join(dir, MANIFESTO);
  if (!fs.existsSync(p)) return null;
  const m = JSON.parse(fs.readFileSync(p, 'utf8')) as Manifesto;
  if (m.formato !== 1) {
    throw new Error(`${p}: manifesto de formato ${m.formato}, esperado 1.`);
  }
  return m;
}

// NÃO acrescente aqui uma "assinatura barata" do manifesto (`mtime` + tamanho) para
// evitar o `leManifesto` do caminho quente da API. Foi tentado em 17/08/2026 e é
// insuficiente: reescrever o manifesto trocando só a hora de `geradoEm` não muda o
// tamanho (a data tem largura fixa), e o `mtime` desta máquina tem granularidade
// medida de ~2,45 ms. Duas reescritas dentro dessa janela ficam indistinguíveis, e o
// preço do erro é a API servir o número anterior ao refresh. Ver ACHADOS #69.

/**
 * Atômica (DEPLOY.md §4.2, ACHADOS #79): grava em `manifesto.json.parcial`, `fsync`
 * antes de fechar — o arquivo tem ~5 KB, o fsync custa ~1 ms, e é o que fecha a
 * janela de queda de energia entre o rename e o dado estar de fato no disco — e só
 * então renomeia por cima do destino, com novas tentativas se `leManifesto` de
 * outro pedido tiver o arquivo aberto no instante exato (Windows/NTFS).
 */
export async function escreveManifesto(dir: string, tabelas: EntradaDeManifesto[]): Promise<Manifesto> {
  fs.mkdirSync(dir, { recursive: true });
  const m: Manifesto = { formato: 1, tabelas };
  const destino = path.join(dir, MANIFESTO);
  const temp = `${destino}.parcial`;
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(m, null, 2) + '\n', null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  await renomeiaComRetentativa(temp, destino);
  return m;
}

/** A materialização mais antiga do conjunto — a idade real do que a tela mostra. */
export function maisAntigo(m: Manifesto): string | null {
  const datas = m.tabelas.map((t) => t.geradoEm).sort();
  return datas[0] ?? null;
}
