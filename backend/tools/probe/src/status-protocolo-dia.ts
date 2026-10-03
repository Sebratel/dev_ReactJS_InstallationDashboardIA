#!/usr/bin/env node
// `npm run probe:status-dia` — prova que `Status Protocolo Dia` é um GROUP BY.
//
// **Por que existe.** Congelar essa tabela custa 26 min hoje (ACHADOS #68), e antes
// custava 14 h 28 min. Enquanto isso não roda, cinco páginas devolvem HTTP 409 pelo
// guarda de idade — o dashboard não abre. O custo não é buscar dado: é avaliar, linha
// a linha, um DAX que faz 31.985 × 104.671 varreduras candidatas para produzir o que
// uma agregação por hash produz numa passada.
//
// Este arquivo NÃO grava nada e NÃO muda o pipeline. Ele recalcula a tabela por hash
// a partir do MESMO snapshot que o DAX lê, e compara célula a célula com o
// `calc.status-protocolo-dia.jsonl` que está em disco.
//
// **A troca ACONTECEU** (04/09/2026): a agregação por hash mora em
// `backend/packages/snapshot/src/nativas.ts` e é ela que `materializaCalculada` roda. Esta
// sonda é a conferência DELA contra o dado real — por isso ela **importa** a
// implementação em vez de ter uma cópia. Enquanto tinha a própria, o "0 células
// divergentes" provava a cópia, e não o código que roda no refresh; as duas
// divergiriam sem ninguém notar. Mesmo argumento do `normalizeName` importado em
// `formato.ts`.
//
// **A fidelidade é o ponto, não a velocidade.** Reimplementar DAX em JS é exatamente
// como se produz número plausível e errado. Por isso cada regra em `nativas.ts` cita a
// função do motor que reproduz, e a conferência é contra o arquivo real — não contra
// uma amostra e não contra o que eu acho que o DAX faz.
//
// Para reconferir depois de mexer no DAX: rode isto, confirme 0 divergências e
// atualize `shaConferido` em `nativas.ts` — sem isso o caminho nativo se recusa a
// rodar e o refresh volta aos 211 s, dizendo por quê.
//
// REGRA DE SAÍDA: contagem, nome de coluna e tempo. Divergência imprime no máximo 5
// exemplos com protocolo e dia, que é o mínimo para alguém investigar.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { le } from '../../../packages/snapshot/src/formato.ts';
import type { Escalar } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery, DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { statusProtocoloDia } from '../../../packages/snapshot/src/nativas.ts';

/** A MESMA regra de `nativas.ts` — aqui só para casar a chave da comparação. */
function chaveTexto(v: Escalar): string {
  return v === null || v === undefined ? '' : String(v).trim().toLocaleLowerCase('pt-BR');
}

const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** A chave da comparação: protocolo por collation e dia em série truncada. */
const k = (p: string, d: number): string => `${p} ${d}`;

function dia(v: Escalar): number {
  if (v === null || v === undefined) return 0;
  if (v instanceof Date) return Math.trunc((v.getTime() - EPOCH_MS) / DAY_MS);
  if (typeof v === 'number') return Math.trunc(v);
  return 0;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DIR = path.join(ROOT, DIRETORIO_PADRAO);

// --------------------------------------------------------------- o cálculo
//
// A semântica DAX (TRUNC, o collation de texto, MAX, ISBLANK) e as duas passadas de
// agregação vivem em `nativas.ts`, com o comentário de cada regra. Aqui só se mede.

const t0 = process.hrtime.bigint();

console.log('lendo o snapshot (as mesmas tabelas que o DAX lê)…');

const fa = await le(arquivoDaQuery(DIR, 'field-agenda'));
const pg = await le(arquivoDaQuery(DIR, 'protocolos-geral'));
const tLido = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`  FIELD AGENDA      ${fa.linhas.length.toLocaleString('pt-BR')} linhas`);
console.log(`  PROTOCOLOS GERAL  ${pg.linhas.length.toLocaleString('pt-BR')} linhas`);
console.log(`  ${tLido.toFixed(0)} ms de leitura\n`);

const tCalc = process.hrtime.bigint();
const produzidas = statusProtocoloDia(fa.linhas, pg.linhas);
const msCalc = Number(process.hrtime.bigint() - tCalc) / 1e6;

// Por (protocolo, dia), a mesma chave que o arquivo usa na comparação abaixo.
const calculado = new Map<string, Record<string, Escalar>>();
for (const l of produzidas) {
  const d = l['dia'];
  const serie = d instanceof Date ? Math.trunc((d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000) : 0;
  calculado.set(`${chaveTexto(l['protocolo'] ?? null)} ${serie}`, l);
}

console.log(
  `── agregação por hash: ${calculado.size.toLocaleString('pt-BR')} linhas em ${msCalc.toFixed(0)} ms ──\n`,
);

// --------------------------------------------------------------- a conferência
const arquivo = arquivoDaQuery(DIR, 'calc.status-protocolo-dia');
const congelado = await le(arquivo);
console.log(
  `── contra ${path.basename(arquivo)} (${congelado.linhas.length.toLocaleString('pt-BR')} linhas, DAX de ${congelado.cabecalho.geradoEm}) ──`,
);

const COLUNAS = [
  'status',
  'base dia',
  'turno dia',
  'rank protocolo dia',
  'tipo protocolo dia',
] as const;
const divergencias = new Map<string, number>(COLUNAS.map((c) => [c, 0]));
const exemplos: string[] = [];
let soNoArquivo = 0;
const vistas = new Set<string>();

const igual = (a: Escalar, b: Escalar): boolean => {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (a instanceof Date || b instanceof Date) return dia(a) === dia(b);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return chaveTexto(a) === chaveTexto(b);
};

for (const l of congelado.linhas) {
  const chave = k(chaveTexto(l['protocolo'] ?? null), dia(l['dia'] ?? null));
  vistas.add(chave);
  const meu = calculado.get(chave);
  if (meu === undefined) {
    soNoArquivo++;
    continue;
  }
  for (const c of COLUNAS) {
    if (!igual(l[c] ?? null, meu[c] ?? null)) {
      divergencias.set(c, divergencias.get(c)! + 1);
      if (exemplos.length < 5) {
        exemplos.push(
          `    protocolo ${String(l['protocolo'])} dia ${dia(l['dia'] ?? null)} · ${c}: ` +
            `arquivo ${JSON.stringify(l[c] ?? null)} · hash ${JSON.stringify(meu[c] ?? null)}`,
        );
      }
    }
  }
}
const soNoHash = [...calculado.keys()].filter((c) => !vistas.has(c)).length;

console.log(`  linhas só no arquivo (o hash não produziu): ${soNoArquivo}`);
console.log(`  linhas só no hash (o arquivo não tem):      ${soNoHash}`);
console.log('\n  coluna | linhas divergentes');
let total = 0;
for (const [c, n] of divergencias) {
  total += n;
  console.log(`  ${c} | ${n}`);
}
if (exemplos.length) {
  console.log('\n  primeiros exemplos:');
  for (const e of exemplos) console.log(e);
}

const conferem = total === 0 && soNoArquivo === 0 && soNoHash === 0;
console.log(
  `\n${conferem ? '✔ IDÊNTICO' : '✘ DIVERGE'} — ${calculado.size.toLocaleString('pt-BR')} linhas, ${total} células divergentes.`,
);
/**
 * O tempo do DAX para a MESMA tabela, medido — não citado.
 *
 * **Não use o 26 min 14 s do ACHADOS #68 aqui.** Aquele número está certo para o
 * insumo dele: `FIELD AGENDA` tinha 1.466.202 linhas. Hoje tem 104.671, e o mesmo
 * congelamento levou 263 s (medido em 24/08/2026, `snapshot:calculadas --tabela=
 * "Status Protocolo Dia"`). Imprimir 1.574 s daria um ganho de 2.881× onde o real é
 * ~480× — plausível, impressionante e errado, que é exatamente o que este repositório
 * não publica. Quando o insumo mudar de novo, remeça e troque a constante.
 */
const DAX_S = 263;
console.log(`  DAX sobre o mesmo insumo (medido 24/08/2026): ${DAX_S} s`);
console.log(
  `  hash, aqui e agora:                          ${(msCalc / 1000).toFixed(1)} s de cálculo (+ ${(tLido / 1000).toFixed(1)} s de leitura)`,
);
if (conferem) {
  console.log(`  fator: ${(DAX_S / (msCalc / 1000)).toFixed(0)}× mais rápido, mesmo resultado.`);
}
process.exit(conferem ? 0 : 1);
