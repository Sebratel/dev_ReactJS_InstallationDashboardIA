// Sonda do passo 2 do ao vivo (docs/DECISAO-AO-VIVO.md): o `Status Protocolo Dia` que o
// refresh vai congelar SEM a agenda completa — agenda de slot + PROTOCOLOS GERAL + as
// contagens de `relatos-do-dia` (`statusProtocoloDiaDasContagens`) — é o mesmo que a
// tradução nativa dá sobre a agenda completa?
//
//   npm run probe:status-dia-sem-completa [-- --dir=snapshot]
//
// Sem banco, sobre um snapshot em disco que tenha a agenda completa E o arquivo
// `relatos-do-dia` (`npm run snapshot -- --query=relatos-do-dia --refazer --sem-calculadas`).
// Duas provas:
//   1. A REGRA: as contagens tiradas da própria agenda completa (o que o SQL agrupa — houve
//      relato improdutivo, houve relato de técnico, por protocolo e dia) dão a MESMA tabela
//      que a nativa, célula a célula. Mesmo instante nas duas pontas: tem de dar zero.
//   2. O SQL: as contagens do arquivo `relatos-do-dia`, que veio do SRD, contra as tiradas da
//      agenda completa — nos dias anteriores ao da agenda em disco, que já não mudam.
// Imprime contagens; NUNCA valor de linha.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginaDasFontesDoStatusDia, statusProtocoloDiaDasContagens } from '../../../packages/ao-vivo/src/status-dia.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { le, leCabecalho, type Escalar } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery } from '../../../packages/snapshot/src/manifesto.ts';
import { statusProtocoloDia } from '../../../packages/snapshot/src/nativas.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const DIR = path.resolve(ROOT, arg('dir') ?? 'snapshot');
const model = SemanticModel.fromSpecsDir(SPECS);
const agendaPagina = loadDashboards(SPECS).find((d) => d.id === 'agendamento-field')!;
const AGORA = new Date();

type Linha = Record<string, Escalar>;
const rows = (c: Awaited<ReturnType<typeof carrega>>, t: string) => c.ev.dataset.rows(t) as unknown as Linha[];
const texto = (v: Escalar | undefined): string =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? '∅' : String(v);

/** Uma tabela como mapa chave → linha (as colunas em ordem), para comparar célula a célula. */
function porChave(ls: readonly Linha[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of ls) {
    const chave = `${texto(l['protocolo'])}|${texto(l['data'] ?? l['dia'] ?? null)}`;
    const corpo = Object.keys(l).sort().map((k) => `${k}=${texto(l[k])}`).join(';');
    m.set(chave, m.has(chave) ? `${m.get(chave)}#${corpo}` : corpo);
  }
  return m;
}

function compara(rotulo: string, a: readonly Linha[], b: readonly Linha[]): number {
  const ma = porChave(a);
  const mb = porChave(b);
  let soA = 0;
  let soB = 0;
  let diferentes = 0;
  for (const [k, v] of ma) {
    if (!mb.has(k)) soA++;
    else if (mb.get(k) !== v) diferentes++;
  }
  for (const k of mb.keys()) if (!ma.has(k)) soB++;
  console.log(
    `${rotulo}: ${a.length} × ${b.length} linha(s); ${diferentes} chave(s) com célula diferente, ` +
      `${soA} só na nativa, ${soB} só nas contagens`,
  );
  return diferentes + soA + soB;
}

/** O que o SQL de `relatos-do-dia` agrupa, tirado da agenda completa: por protocolo e dia do relato. */
function contagensDaCompleta(completa: readonly Linha[]): Linha[] {
  const grupos = new Map<string, { protocolo: string; dia: string | null; improdutivo: boolean; tecnico: boolean }>();
  for (const l of completa) {
    const relato = l['data relato'];
    const dia = relato instanceof Date ? relato.toISOString().slice(0, 10) : null;
    const k = `${texto(l['protocolo'])}|${dia}`;
    const g = grupos.get(k) ?? { protocolo: texto(l['protocolo']), dia, improdutivo: false, tecnico: false };
    if (texto(l['categoriaprodutividade']).toLowerCase() === 'improdutiva') g.improdutivo = true;
    if (l['skill'] !== null && l['skill'] !== undefined) g.tecnico = true;
    grupos.set(k, g);
  }
  return [...grupos.values()].map((g) => ({ Protocolo: g.protocolo, 'Dia Relato': g.dia, Improdutivo: g.improdutivo, Tecnico: g.tecnico }));
}

const geradoEmDaAgenda = leCabecalho(arquivoDaQuery(DIR, 'field-agenda')).geradoEm;
// A carga das fontes, como o congelador faz (`paginaDasFontesDoStatusDia`): com a página da
// agenda inteira e `lerCalculadas: false`, o corpo da calculada sairia pelo DAX.
const fontes = paginaDasFontesDoStatusDia(agendaPagina);
const completa = await carrega({ dir: DIR, model, dashboards: [fontes], now: AGORA, lerCalculadas: false, precisaFormaCompleta: ['FIELD AGENDA'] });
const deSlot = await carrega({ dir: DIR, model, dashboards: [fontes], now: AGORA, lerCalculadas: false, precisaFormaCompleta: [] });
const faCompleta = rows(completa, 'FIELD AGENDA');
const pg = rows(completa, 'PROTOCOLOS GERAL');
const slot = rows(deSlot, 'FIELD AGENDA');
console.log(
  `snapshot ${path.relative(ROOT, DIR) || DIR}: agenda completa ${faCompleta.length} linha(s) (de ${geradoEmDaAgenda}), ` +
    `de slot ${slot.length}, PG ${pg.length}\n`,
);

const nativa = statusProtocoloDia(faCompleta, pg, []);
let problemas = 0;

// 1. A regra — com a agenda de slot TIRADA da completa: o arquivo de slot é buscado em outro
// instante (medido em 24/10/2026: 4 horários novos entre os dois), e a diferença de instante
// apareceria como diferença de regra.
const colunasDeSlot = Object.keys(slot[0] ?? {});
const vistos = new Set<string>();
const slotDaCompleta: Linha[] = [];
for (const l of faCompleta) {
  const k = colunasDeSlot.map((c) => texto(l[c])).join('\u0001');
  if (vistos.has(k)) continue;
  vistos.add(k);
  slotDaCompleta.push(Object.fromEntries(colunasDeSlot.map((c) => [c, l[c] ?? null])));
}
const tiradas = contagensDaCompleta(faCompleta);
problemas += compara(
  `1. a regra (slot e contagens tirados da agenda completa: ${slotDaCompleta.length} horários)`,
  nativa,
  statusProtocoloDiaDasContagens(slotDaCompleta, tiradas, pg),
);
// Informativo: o arquivo de slot de verdade, de outro instante.
compara('   (com o arquivo de slot, de outro instante — informativo)', nativa, statusProtocoloDiaDasContagens(slot, tiradas, pg));

// 2. O SQL.
const { linhas: doSrd, cabecalho } = await le(arquivoDaQuery(DIR, 'relatos-do-dia'));
const ate = geradoEmDaAgenda.slice(0, 10);
const fechado = (l: Linha) => {
  const d = l['dia relato'] ?? l['Dia Relato'];
  return d === null || d === undefined || String(d) < ate;
};
const chaveDasContagens = (l: Linha) =>
  `${texto(l['protocolo'] ?? l['Protocolo'])}|${texto(l['dia relato'] ?? l['Dia Relato'] ?? null)}|${texto(l['improdutivo'] ?? l['Improdutivo'])}|${texto(l['tecnico'] ?? l['Tecnico'])}`;
// O SRD olha a janela de HOJE (3 meses para trás a partir de agora); a agenda em disco, a do
// dia em que foi buscada. Compara só os protocolos que as duas pontas conhecem, nos dias fechados.
const protocolosDaCompleta = new Set(faCompleta.map((l) => texto(l['protocolo'])));
const doSrdComparavel = (doSrd as Linha[]).filter((l) => fechado(l) && protocolosDaCompleta.has(texto(l['protocolo'] ?? l['Protocolo'])));
const protocolosDoSrd = new Set((doSrd as Linha[]).map((l) => texto(l['protocolo'] ?? l['Protocolo'])));
const tiradasComparavel = tiradas.filter((l) => fechado(l) && protocolosDoSrd.has(texto(l['Protocolo'])));
const a = new Set(doSrdComparavel.map(chaveDasContagens));
const b = new Set(tiradasComparavel.map(chaveDasContagens));
const soSrd = [...a].filter((k) => !b.has(k)).length;
const soCompleta = [...b].filter((k) => !a.has(k)).length;
console.log(
  `2. o SQL (relatos-do-dia de ${cabecalho.geradoEm}, dias antes de ${ate}): ${a.size} × ${b.size} contagem(ns); ` +
    `${soSrd} só no SRD, ${soCompleta} só na agenda completa`,
);
problemas += soSrd + soCompleta;

console.log(`\n${problemas === 0 ? 'IGUAL: o Status Protocolo Dia sai das contagens sem a agenda completa.' : 'HÁ DIFERENÇA — ver acima.'}`);
process.exit(problemas === 0 ? 0 : 1);
