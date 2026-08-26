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
  /**
   * Cópia do que o cabeçalho do arquivo diz sobre a carga incremental. Ausentes
   * em query que não é incremental — que é o caso de 21 das 22.
   *
   * Cópia, e não fonte: quem manda é o cabeçalho (ver `CabecalhoDeSnapshot`).
   * Estão aqui só para `npm run snapshot` responder "de quando é isto e há
   * quantos dias não roda uma completa" sem abrir 22 arquivos.
   */
  marca?: string;
  modo?: 'completo' | 'incremental';
  completoEm?: string;
}

export interface Manifesto {
  formato: 1;
  tabelas: EntradaDeManifesto[];
}

/** O arquivo de uma query. O nome é o id — é o que foi materializado. */
export function arquivoDaQuery(dir: string, query: string): string {
  return path.join(dir, `${query}.jsonl`);
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

export function escreveManifesto(dir: string, tabelas: EntradaDeManifesto[]): Manifesto {
  fs.mkdirSync(dir, { recursive: true });
  const m: Manifesto = { formato: 1, tabelas };
  fs.writeFileSync(path.join(dir, MANIFESTO), JSON.stringify(m, null, 2) + '\n', 'utf8');
  return m;
}

/** A materialização mais antiga do conjunto — a idade real do que a tela mostra. */
export function maisAntigo(m: Manifesto): string | null {
  const datas = m.tabelas.map((t) => t.geradoEm).sort();
  return datas[0] ?? null;
}
