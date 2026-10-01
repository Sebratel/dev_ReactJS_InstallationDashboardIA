#!/usr/bin/env node
// Compara uma carga INCREMENTAL mesclada com uma carga COMPLETA da mesma query — a prova
// que libera ligar a incremental no refresh (ACHADOS #165, `docs/PLANO-CARGA.md`).
//
// Como produzir os dois arquivos sem tocar o `snapshot/` da plataforma:
//
//   1. copie `snapshot/*.jsonl.gz` + `manifesto.json` para um diretório A;
//   2. carga completa em A (grava a marca no cabeçalho):
//        node tools/snapshot/src/index.ts --query=Q --refazer --sem-calculadas --saida=A
//   3. espere um intervalo real do grupo (30 min no `frio`) e copie A para I e para F;
//   4. AO MESMO TEMPO — as duas têm de ver o mesmo banco:
//        ... --query=Q --refazer --incremental=Q --sem-calculadas --saida=I
//        ... --query=Q --refazer               --sem-calculadas --saida=F
//   5. npm run probe:compara-incremental -- --i=I/Q.jsonl.gz --f=F/Q.jsonl.gz --chave=Protocolo
//
// Compara por GRUPO (a `chave` da política): grupos iguais, diferentes, só de um lado,
// e em quais colunas os diferentes divergem. **Nunca imprime valor de linha** — o
// snapshot tem dado de cliente (CLAUDE.md, regra 2).
//
// Diferença pequena só em colunas de evento em andamento (`Fim relato`, último play)
// é a distância entre as duas leituras, não perda: em 01/10 foram 6 de 10.848.

import { le, leCabecalho } from '../../../packages/snapshot/src/formato.ts';
import type { Escalar } from '../../../packages/snapshot/src/formato.ts';
import { normalizeName } from '../../../packages/semantic-model/src/model.ts';

function arg(nome: string): string | undefined {
  const bruto = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return bruto?.slice(nome.length + 3);
}

const arqI = arg('i');
const arqF = arg('f');
const chave = arg('chave');
if (!arqI || !arqF || !chave) {
  console.error('uso: --i=<incremental.jsonl.gz> --f=<completa.jsonl.gz> --chave=<coluna> [--ignorar=a,b]');
  process.exit(2);
}
const ignorar = new Set((arg('ignorar') ?? '').split(',').filter(Boolean).map(normalizeName));
const k = normalizeName(chave);

type Linha = Record<string, Escalar>;

for (const a of [arqI, arqF]) {
  const c = leCabecalho(a);
  console.log(
    a.split(/[\\/]/).slice(-2).join('/'),
    JSON.stringify({ geradoEm: c.geradoEm, modo: c.modo, marca: c.marca, completoEm: c.completoEm }),
  );
}
const I = (await le(arqI)).linhas as Linha[];
const F = (await le(arqF)).linhas as Linha[];
if (!F.length) {
  console.error('a carga completa está vazia — nada a comparar.');
  process.exit(2);
}
const colunas = Object.keys(F[0]!).filter((c) => !ignorar.has(c));

const valor = (x: Escalar | undefined): string =>
  x instanceof Date ? `D${x.getTime()}` : x === null || x === undefined ? '∅' : String(x);

function porGrupo(linhas: Linha[]): Map<string, Linha[]> {
  const m = new Map<string, Linha[]>();
  for (const l of linhas) {
    const g = valor(l[k]);
    const lista = m.get(g);
    if (lista) lista.push(l);
    else m.set(g, [l]);
  }
  return m;
}

/** Multiconjunto das linhas projetadas em `cs` — a multiplicidade conta (#165). */
function multi(linhas: Linha[], cs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of linhas) {
    const assinatura = cs.map((c) => valor(l[c])).join('\u0001');
    m.set(assinatura, (m.get(assinatura) ?? 0) + 1);
  }
  return m;
}

const iguais = (a: Map<string, number>, b: Map<string, number>): boolean =>
  a.size === b.size && [...a].every(([s, n]) => b.get(s) === n);

const gI = porGrupo(I);
const gF = porGrupo(F);
let mesmos = 0;
let diferentes = 0;
let soCompleta = 0;
const culpa = new Map<string, number>();
for (const [g, lf] of gF) {
  const li = gI.get(g);
  if (!li) {
    soCompleta++;
    continue;
  }
  if (iguais(multi(li, colunas), multi(lf, colunas))) {
    mesmos++;
    continue;
  }
  diferentes++;
  const cs = colunas.filter((c) => !iguais(multi(li, [c]), multi(lf, [c])));
  const rotulo = (cs.join(' + ') || '(só a combinação)') + (li.length !== lf.length ? ' [nº de linhas difere]' : '');
  culpa.set(rotulo, (culpa.get(rotulo) ?? 0) + 1);
}
const soIncremental = [...gI.keys()].filter((g) => !gF.has(g)).length;

console.log(
  `linhas: incremental ${I.length.toLocaleString('pt-BR')}, completa ${F.length.toLocaleString('pt-BR')}\n` +
    `grupos (${chave}): ${gF.size.toLocaleString('pt-BR')} na completa — ` +
    `${mesmos.toLocaleString('pt-BR')} iguais, ${diferentes} diferentes, ` +
    `${soIncremental} só na incremental, ${soCompleta} só na completa`,
);
for (const [rotulo, n] of [...culpa].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(n).padStart(6)}  ${rotulo}`);
}
