// `identityKey` por ID de dicionário: vale a pena, e quando?
//
// Depois de `leitorDeColuna` e `leitorDaChave`, o topo do perfil passou a ser
// `identityKey` — 804 ms, 18,4% de `instalacao-reincidente`. Ela JÁ é memoizada
// (99,46% de acerto), então o que sobra não é o cálculo: é o custo de existir —
// `isBlank`, a cadeia de `typeof`, e uma busca por hash num `Map`.
//
// A hipótese: no caminho colunar a coluna é um dicionário com POUCOS distintos
// (`item` tem 1 valor em 76.398 linhas; `cidade`, 17). Calcular `identityKey` uma
// vez POR DISTINTO e indexar por id troca a busca por hash por uma indexação de
// array. Para os dois sítios que dominam, dá para ir além e pré-computar a
// RESPOSTA por distinto, num `Uint8Array`:
//
//   grupos.ts  `identityKey(ler(row)) === alvo`      -> casa[ids[i]] === 1
//   filtro.ts  `permitidos.has(identityKey(v))`      -> casa[ids[i]] === 1
//
// **O que pode matar a ideia:** a pré-computação é O(distintos), e o laço pode não
// rodar (a lição de 14/09 — o `keep` que o índice de igualdade nunca chama). Por
// isso o bench mede DUAS cardinalidades e cobra o preparo dentro do cronômetro.
//
//   node backend/tools/bench/src/identidade-por-id.ts

import type { Row } from '../../../packages/measure-engine/src/dataset.ts';
import { identityKey, type DaxValue } from '../../../packages/measure-engine/src/value.ts';
import { normalizeName } from '../../../packages/semantic-model/src/model.ts';
import { ConstrutorDeTabela, type ColunaColunar } from '../../../packages/snapshot/src/tabela-colunar.ts';
import { VistaDeLinhas, indiceDaVista } from '../../../packages/snapshot/src/linha-vista.ts';

const LINHAS = 300_000;
const COLUNAS = 30;
const REPS = 5;
const RODADAS = 4;

const NOMES = Array.from({ length: COLUNAS }, (_, j) => `COLUNA ${j}`);
const ALVO = normalizeName(NOMES[13]!);

/** `distintos` valores distintos na coluna alvo; as outras 29 são constantes. */
function monta(distintos: number): { linhas: Row[]; coluna: ColunaColunar } {
  const c = new ConstrutorDeTabela('T', NOMES.map(normalizeName), LINHAS);
  for (let i = 0; i < LINHAS; i++) {
    c.poeLinha(NOMES.map((_, j) => (j === 13 ? `Valor ${i % distintos}` : `x${j}`)));
  }
  const t = c.fecha();
  return { linhas: new VistaDeLinhas(t).todas() as unknown as Row[], coluna: t.coluna(ALVO) };
}

let sumidouro = 0;

// ── cenário 1: igualdade contra um alvo fixo (o `keep` de grupos.ts) ──────────

function a_igualdade(linhas: Row[], alvo: string): number {
  const t = Date.now();
  for (let r = 0; r < REPS; r++) {
    for (let i = 0; i < linhas.length; i++) {
      if (identityKey(linhas[i]![ALVO] as DaxValue) === alvo) sumidouro++;
    }
  }
  return Date.now() - t;
}

function b_igualdade(linhas: Row[], coluna: ColunaColunar, alvo: string): number {
  const t = Date.now();
  for (let r = 0; r < REPS; r++) {
    // O preparo entra no cronômetro: é ele que a lição de 14/09 mandou cobrar.
    const casa = new Uint8Array(coluna.valores.length);
    for (let d = 0; d < coluna.valores.length; d++) {
      casa[d] = identityKey(coluna.valores[d] as DaxValue) === alvo ? 1 : 0;
    }
    const ids = coluna.ids;
    for (let i = 0; i < linhas.length; i++) {
      if (casa[ids[indiceDaVista(linhas[i]!)!]!] === 1) sumidouro++;
    }
  }
  return Date.now() - t;
}

// ── cenário 2: a chave de identidade em si (o índice de expansao.ts) ──────────

function a_chave(linhas: Row[]): number {
  const t = Date.now();
  for (let r = 0; r < REPS; r++) {
    for (let i = 0; i < linhas.length; i++) {
      sumidouro += identityKey(linhas[i]![ALVO] as DaxValue).length;
    }
  }
  return Date.now() - t;
}

function b_chave(linhas: Row[], coluna: ColunaColunar): number {
  const t = Date.now();
  for (let r = 0; r < REPS; r++) {
    const chaves = new Array<string>(coluna.valores.length);
    for (let d = 0; d < coluna.valores.length; d++) {
      chaves[d] = identityKey(coluna.valores[d] as DaxValue);
    }
    const ids = coluna.ids;
    for (let i = 0; i < linhas.length; i++) {
      sumidouro += chaves[ids[indiceDaVista(linhas[i]!)!]!]!.length;
    }
  }
  return Date.now() - t;
}

const fmt = (xs: number[]): string => xs.map((x) => String(x).padStart(5)).join(' ');

function bateria(
  nome: string,
  a: () => number,
  b: () => number,
): void {
  a();
  b();
  const as: number[] = [];
  const bs: number[] = [];
  for (let r = 0; r < RODADAS; r++) {
    if (r % 2 === 0) {
      as.push(a());
      bs.push(b());
    } else {
      bs.push(b());
      as.push(a());
    }
  }
  const ganhos = as.map((x, i) => ((x - bs[i]!) / x) * 100);
  console.log(`  ${nome}`);
  console.log(`    A  identityKey por linha ... ${fmt(as)}    melhor ${Math.min(...as)} ms`);
  console.log(`    B  por id de dicionário .... ${fmt(bs)}    melhor ${Math.min(...bs)} ms`);
  console.log(`       por par .................. ${ganhos.map((g) => `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`).join('  ')}`);
  console.log(`       B ganhou ${ganhos.filter((g) => g > 0).length} de ${RODADAS} pares`);
}

for (const distintos of [17, 997, LINHAS]) {
  const { linhas, coluna } = monta(distintos);
  const alvo = identityKey('Valor 3');
  console.log(`\n── ${distintos} distintos em ${LINHAS} linhas, ${REPS} repetições ──`);
  bateria('igualdade contra alvo fixo', () => a_igualdade(linhas, alvo), () => b_igualdade(linhas, coluna, alvo));
  bateria('a chave de identidade', () => a_chave(linhas), () => b_chave(linhas, coluna));
}

if (sumidouro === -1) console.log('inalcançável');
