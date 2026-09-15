#!/usr/bin/env node
// `npm run bench:pagina-fases` — de uma página fria, quanto é CARREGAR e quanto é CALCULAR.
//
// **A pergunta que este programa responde, e o erro que ele corrigiu.** O plano de
// desempenho de 12/09/2026 partia de "os dados demoram a carregar" e a Fase 2 inteira
// (armazenamento colunar) foi construída em cima disso. O colunar entregou memória —
// RSS 5.360 → 3.097 MB na API — e **empatou** no tempo, o que na época foi lido como
// "falta trocar o formato do arquivo". Estava errado. Medido aqui em 13/09/2026, nas
// 14 páginas reais: **carga 15,1 s, cálculo 48,1 s**. O cálculo era 3,2x a carga.
//
// Trocar o JSONL por um formato binário teria atacado um terço de um quarto do custo.
// `npm run bench:carga` já mostrava o porquê e ninguém tinha olhado: `JSON.parse` é
// **3,1%** da carga; o caro é montar a linha.
//
// **Por que separar as duas fases num programa próprio.** `bench:carga --paginas` mede
// a carga e `bench:colunar-paridade` mede as duas juntas — nenhum dos dois diz a
// PROPORÇÃO, que é o número que decide onde trabalhar. E ele é por página de propósito:
// o total esconde que uma única página concentrava 21,4 s dos 48,1 s de cálculo, e um
// único visual dentro dela, 16,1 s. Otimizar pela média teria passado longe.
//
// **O que ele não mede.** Processo novo a cada execução seria mais honesto para o custo
// frio, mas as 14 páginas num processo só é o que cabe em um comando; os arquivos ficam
// no cache do SO depois da primeira leitura, como na API depois do aquecimento. Use
// `--pagina=` para isolar uma num processo limpo.
//
// ⚠ **E o cálculo daqui é o custo FRIO, sem o memo de resposta — não é o que o
// usuário espera na tela.** Descoberto em 15/09/2026 (ACHADOS #111): uma tabela
// visual avalia o campo de agregação **por linha do resultado**, e
// `protocolos-detalhados` tem 94.166 linhas. Isso não é desperdício: `tabelaCompleta`
// calcula a tabela inteira UMA vez, memoiza, e toda janela seguinte sai de um `slice`.
// Na API, é o aquecimento que paga — 14 páginas quentes em 31,6 s, medido — e depois
// as respostas saem em 1,8 a 4,4 ms.
//
// Ou seja: o número deste programa é o que um **refresh** volta a cobrar, e o teto de
// um cache frio. Lê-lo como "abrir a página custa isto" é errar por duas ordens de
// grandeza — e era uma leitura fácil de fazer, porque o programa não dizia o contrário.
//
// REGRA DE SAÍDA, a mesma do resto de `tools/`: id, contagem, nome de coluna e tempo.
// **Nunca valor de linha** — uma tabela calculada é dado de cliente.
//
//   npm run bench:pagina-fases
//   npm run bench:pagina-fases -- --pagina=instalacao-reincidente
//   npm run bench:pagina-fases -- --pagina=instalacao-reincidente --visuais

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculaPagina } from '../../../apps/api/src/calcula.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, DIRETORIO_PADRAO);

const args = process.argv.slice(2);
const pedidas = args.filter((a) => a.startsWith('--pagina=')).map((a) => a.slice(9));
const porVisual = args.includes('--visuais');
/**
 * Saída legível por máquina, para quem vai COMPARAR duas execuções.
 *
 * **Existe por defeito medido, não por completude.** A bateria de A/B extraía os
 * números da linha `TOTAL` com `sed`, e em 14/09/2026 duas execuções de ~20
 * devolveram lixo — `carga 1.077.288 ms` numa rodada que durou dois minutos. Um par
 * lixo que passe despercebido não atrasa a medição: ele INVERTE a conclusão, porque
 * a comparação é por par adjacente. Texto formatado para humano é fonte ruim para
 * máquina, e a resposta certa não é um `sed` melhor.
 */
const json = args.includes('--json');

for (const a of args) {
  const ok = ['--visuais', '--json'].includes(a) || a.startsWith('--pagina=');
  if (!ok) {
    console.error(`argumento desconhecido: ${a}`);
    process.exit(2);
  }
}

const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
const agora = new Date();
const todas = loadDashboards(path.join(ROOT, 'specs')) as DashboardSpec[];
const paginas = pedidas.length ? todas.filter((d) => pedidas.includes(d.id)) : todas;

if (!paginas.length) {
  console.error(`nenhuma página para: ${pedidas.join(', ')}`);
  process.exit(1);
}

let somaCarga = 0;
let somaCalc = 0;

interface MedidaDePagina {
  pagina: string;
  visuais: number;
  linhas: number;
  cargaMs: number;
  calculoMs: number;
}
const medidas: MedidaDePagina[] = [];

if (!json) {
  console.log('página                     visuais     linhas      carga    cálculo   cálc%');
  console.log('─'.repeat(78));
}

for (const d of paginas) {
  const t0 = performance.now();
  const r = await carrega({ dir: DIR, model, dashboards: [d], now: agora, colunar: true });
  const tCarga = performance.now() - t0;

  const t1 = performance.now();
  const p = calculaPagina(d, r.ev);
  const tCalc = performance.now() - t1;

  somaCarga += tCarga;
  somaCalc += tCalc;

  const linhas = [...r.linhasPorTabela.values()].reduce((s, n) => s + n, 0);
  medidas.push({
    pagina: d.id,
    visuais: d.visuals?.length ?? 0,
    linhas,
    cargaMs: Math.round(tCarga),
    calculoMs: Math.round(tCalc),
  });
  if (!json) {
    console.log(
      `${d.id.padEnd(26)} ${String(d.visuals?.length ?? 0).padStart(4)} ` +
        `${linhas.toLocaleString('pt-BR').padStart(10)} ${tCarga.toFixed(0).padStart(7)} ms ` +
        `${tCalc.toFixed(0).padStart(7)} ms ${((tCalc / (tCalc + tCarga)) * 100).toFixed(0).padStart(5)}%`,
    );
  }

  // O detalhe por visual só com `--visuais`: é ele que achou o visual de 16,1 s, mas
  // imprimi-lo para 14 páginas são 300 linhas que escondem o quadro.
  if (porVisual && !json) {
    const ord = [...p.visuais].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0)).filter((v) => (v.ms ?? 0) > 0);
    const soma = ord.reduce((s, v) => s + (v.ms ?? 0), 0) || 1;
    for (const v of ord.slice(0, 10)) {
      console.log(
        `    ${v.id.slice(0, 22).padEnd(23)} ${String(v.tipo).slice(0, 18).padEnd(19)} ` +
          `${String(v.ms ?? 0).padStart(6)} ms ${(((v.ms ?? 0) / soma) * 100).toFixed(0).padStart(4)}%`,
      );
    }
    if (ord.length > 10) console.log(`    (+${ord.length - 10} visuais abaixo de ${ord[9]!.ms} ms)`);
  }
}

const total = somaCarga + somaCalc;

if (json) {
  console.log(JSON.stringify({
    cargaMs: Math.round(somaCarga),
    calculoMs: Math.round(somaCalc),
    paginas: medidas,
  }));
  process.exit(0);
}

console.log('─'.repeat(78));
console.log(
  `TOTAL ${paginas.length} página(s)   carga ${somaCarga.toFixed(0)} ms (${((somaCarga / total) * 100).toFixed(0)}%)   ` +
    `cálculo ${somaCalc.toFixed(0)} ms (${((somaCalc / total) * 100).toFixed(0)}%)`,
);
console.log(
  somaCalc > somaCarga
    ? `\n  O cálculo é ${(somaCalc / somaCarga).toFixed(1)}x a carga — otimizar leitura de arquivo rende pouco aqui.`
    : `\n  A carga é ${(somaCarga / somaCalc).toFixed(1)}x o cálculo — aí sim o formato do arquivo importa.`,
);
console.log('  Arquivo em cache do SO. Um processo para todas as páginas; use --pagina= para isolar.');
console.log(
  '  Custo FRIO e SEM o memo de resposta: a API calcula a tabela inteira uma vez no\n' +
    '  aquecimento e depois serve janelas de um slice. Isto é o teto de um cache frio,\n' +
    '  não o que o usuário espera na tela. Ver docs/ACHADOS.md #111.\n',
);
