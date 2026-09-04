#!/usr/bin/env node
// `npm run snapshot:confere` — o snapshot em disco está servível?
//
// Lê **só o cabeçalho** de cada arquivo (a primeira linha) e responde as duas
// perguntas que ninguém respondia: alguma coluna veio inteira nula, e alguma tabela
// calculada é mais velha que o dado dela. Ver `packages/snapshot/src/confere.ts` para
// o porquê de cada uma.
//
// Roda em milissegundos sobre 1,3 GB de snapshot, e é para rodar **depois de todo
// refresh** — é o passo que separa "materializou" de "materializou certo".
//
//   npm run snapshot:confere
//   npm run snapshot:confere -- --avisos    # lista também o que ninguém lê
//
// Sai 1 quando há erro. Aviso sozinho sai 0: coluna vazia que nenhuma página lê é
// ruído, e transformar ruído em falha ensina a ignorar falha.
//
// REGRA DE SAÍDA: nunca imprime valor de linha.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { colunasUsadas } from '../../../packages/snapshot/src/colunas-usadas.ts';
import {
  confereSnapshot,
  contaPorGravidade,
  type ArquivoDeSnapshot,
} from '../../../packages/snapshot/src/confere.ts';
import { ehArquivoDeSnapshot, leCabecalho } from '../../../packages/snapshot/src/formato.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, DIRETORIO_PADRAO);

const args = process.argv.slice(2);
const mostraAvisos = args.includes('--avisos');
for (const a of args) {
  if (a !== '--avisos') {
    console.error(`argumento desconhecido: ${a}. Use: --avisos`);
    process.exit(2);
  }
}

if (!fs.existsSync(DIR)) {
  console.error(`Não há snapshot em ${path.relative(ROOT, DIR)}. Rode: npm run snapshot -- --todas`);
  process.exit(1);
}

const arquivos: ArquivoDeSnapshot[] = fs
  .readdirSync(DIR)
  .filter(ehArquivoDeSnapshot)
  .sort()
  .map((f) => ({
    arquivo: f,
    calculada: f.startsWith('calc.'),
    cabecalho: leCabecalho(path.join(DIR, f)),
  }));

if (arquivos.length === 0) {
  console.error(`Nenhum .jsonl/.jsonl.gz em ${path.relative(ROOT, DIR)}. Rode: npm run snapshot -- --todas`);
  process.exit(1);
}

const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
const usadas = colunasUsadas(loadDashboards(path.join(ROOT, 'specs')), model);
const problemas = confereSnapshot(arquivos, usadas);
const conta = contaPorGravidade(problemas);

const linhas = arquivos.reduce((a, x) => a + x.cabecalho.linhas, 0);
console.log(
  `${arquivos.length} arquivo(s), ${linhas.toLocaleString('pt-BR')} linhas ` +
    `(${arquivos.filter((a) => a.calculada).length} de tabela calculada).\n`,
);

for (const p of problemas) {
  if (p.gravidade === 'aviso' && !mostraAvisos) continue;
  console.log(`[${p.gravidade.toUpperCase().padEnd(5)}] ${p.onde}`);
  console.log(`         ${p.detalhe}`);
}

if (problemas.length === 0) {
  console.log('Nada a apontar: nenhuma coluna inteira nula, nenhuma calculada obsoleta.');
} else {
  console.log(
    `\n${conta.erro} erro(s), ${conta.aviso} aviso(s)` +
      (conta.aviso > 0 && !mostraAvisos ? ' — use --avisos para ver os avisos' : ''),
  );
}

process.exit(conta.erro > 0 ? 1 : 0);
