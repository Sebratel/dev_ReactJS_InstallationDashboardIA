// Sonda do passo 5 do ao vivo (docs/DECISAO-AO-VIVO.md): as páginas que o snapshot ainda
// serve dão os mesmos números SEM a agenda completa?
//
//   npm run probe:snapshot-sem-completa [-- --dir=snapshot]
//
// Sem banco. Numa CÓPIA do snapshot, a agenda de slot é tirada da própria agenda completa
// (o arquivo de slot é de outro instante, e a diferença de instante apareceria como
// diferença de forma — ACHADOS #247). Então, com os filtros com que cada página abre:
//
//   1. Relatório do Mês e Agendamento Field (menos os três visuais de relato, que sem a
//      completa voltam indisponíveis): a carga com a completa, como hoje, contra a carga
//      com o slot, como o servidor faz com `completa_no_snapshot: false`;
//   2. o Relatório do Mês com TEMPO REAL: um delta do poller que muda o horário de 10
//      protocolos (grão relato, como o poller entrega) recalcula o `calendar` nas duas
//      pontas — sobre a completa, como hoje, e sobre o slot, como depois do passo 5. O
//      delta tem de mudar algum número, ou a prova não prova nada.
//
// A Agendamento Field com tempo real não entra: sem a completa, o overlay das fontes do
// `Status Protocolo Dia` não vai à carga dela (`#overlayDoSnapshot`, ACHADOS #250).
// Imprime contagens; NUNCA valor de linha.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { materializaColunas } from '../../../packages/snapshot/src/colunas-calculadas.ts';
import { escreve, le, leCabecalho, type Escalar } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery } from '../../../packages/snapshot/src/manifesto.ts';
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { codificaFiltro, decodificaFiltros } from '../../../packages/widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../../packages/widget-engine/src/filtros-padrao.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { calculaPagina, LINHAS_MAXIMO } from '../../../api/src/calcula.ts';
import { mescladoresDe, type OverlayDeTabela } from '../../../api/src/overlay-realtime.ts';
import { comparaPaginas } from '../../../api/src/pagina-ao-vivo.ts';
import { formaDaPagina } from './forma-do-servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const DIR = path.resolve(ROOT, arg('dir') ?? 'snapshot');
const model = SemanticModel.fromSpecsDir(SPECS);
const AGORA = new Date();
const paginas = loadDashboards(SPECS);
const RELATO = new Set(['HISTÓRICO DE RELATOS', 'HISTÓRICO DE RELATOS COMPLETOS', 'MOTIVO IMPRODUTIVO/ PRODUTIVO']);
const janela = { de: 0, linhas: LINHAS_MAXIMO };
const texto = (v: Escalar | undefined): string => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? '∅' : String(v));

const g = model.graoReduzido.find((x) => normalizeName(x.tabela) === normalizeName('FIELD AGENDA'))!;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-sem-completa-'));
let problemas = 0;
try {
  fs.cpSync(DIR, tmp, { recursive: true });

  // O slot tirado da completa, com o cabeçalho (colunas e `geradoEm`) do arquivo de slot.
  const completa = await le(arquivoDaQuery(DIR, g.queryCompleta));
  const arqSlot = arquivoDaQuery(tmp, g.queryPadrao);
  const cabSlot = leCabecalho(arqSlot);
  const colunas = cabSlot.colunas.map((c) => c.nome);
  const vistos = new Set<string>();
  const slot: Record<string, Escalar>[] = [];
  for (const l of completa.linhas as Record<string, Escalar>[]) {
    const linha = Object.fromEntries(colunas.map((c) => [c, l[normalizeName(c)] ?? null]));
    const k = colunas.map((c) => texto(linha[c])).join('\u0001');
    if (vistos.has(k)) continue;
    vistos.add(k);
    slot.push(linha);
  }
  await escreve(arqSlot, { query: cabSlot.query, tabelas: cabSlot.tabelas, geradoEm: cabSlot.geradoEm }, colunas, slot);
  console.log(
    `cópia do snapshot com o slot tirado da completa: ${slot.length} horários de ${completa.linhas.length} linhas ` +
      `(o arquivo de slot tinha ${cabSlot.linhas})\n`,
  );

  const abre = (dash: DashboardSpec) => ({ ...dash, filters: [...(dash.filters ?? []), ...decodificaFiltros(filtrosPadrao(dash.id, AGORA).map(codificaFiltro))] });
  const cargas = (dash: DashboardSpec, overlay?: ReadonlyMap<string, OverlayDeTabela>) =>
    Promise.all([
      carrega({ dir: tmp, model, dashboards: [dash], now: AGORA, liberaSobDemanda: [], precisaFormaCompleta: formaDaPagina(dash, model), colunar: true, ...(overlay ? { overlay: mescladoresDe(overlay) } : {}) }),
      carrega({ dir: tmp, model, dashboards: [dash], now: AGORA, liberaSobDemanda: [], precisaFormaCompleta: [], colunar: true, ...(overlay ? { overlay: mescladoresDe(overlay) } : {}) }),
    ]);

  // 1. Sem tempo real.
  for (const id of ['relatorio-do-mes', 'agendamento-field']) {
    const dash = paginas.find((d) => d.id === id)!;
    const alvo = abre(dash);
    const [comCompleta, comSlot] = await cargas(dash);
    const fora = new Map((dash.visuals ?? []).filter((v) => RELATO.has(v.title ?? '')).map((v) => [v.id, 'lê relato: indisponível sem a completa']));
    const c = comparaPaginas(calculaPagina(alvo, comCompleta.ev, janela), calculaPagina(alvo, comSlot.ev, janela), fora);
    console.log(`1. ${id}: ${c.comparados} visuais, ${c.iguais} iguais, ${c.soOrdem.length} só na ordem, ${c.diferentes.length} diferentes, ${c.fora} fora (relato)`);
    for (const x of [...c.soOrdem, ...c.diferentes]) console.log(`     ${(x.titulo ?? x.id).slice(0, 40).padEnd(40)} ${x.porque}`);
    problemas += c.diferentes.length;
  }

  // 2. Relatório do Mês com tempo real. A página abre sem filtro de período: o gráfico de
  // agenda por turno lê o `calendar` dos próximos dias. Então 10 protocolos com horário nos
  // próximos 7 dias, reentregues com o horário um dia adiante — muda a conta por dia.
  const mes = paginas.find((d) => d.id === 'relatorio-do-mes')!;
  const alvo = abre(mes);
  const [semDelta] = await cargas(mes);
  const pSemDelta = calculaPagina(alvo, semDelta.ev, janela);
  const porProtocolo = new Map<string, Record<string, Escalar>[]>();
  for (const l of completa.linhas as Record<string, Escalar>[]) {
    const p = texto(l['protocolo']);
    porProtocolo.set(p, [...(porProtocolo.get(p) ?? []), l]);
  }
  const UM_DIA = 86_400_000;
  const hoje = Date.UTC(AGORA.getUTCFullYear(), AGORA.getUTCMonth(), AGORA.getUTCDate());
  const naSemana = (v: Escalar | undefined) => v instanceof Date && v.getTime() >= hoje && v.getTime() < hoje + 7 * UM_DIA;
  const escolhidos = [...porProtocolo.keys()].filter((p) => (porProtocolo.get(p) ?? []).some((l) => naSemana(l['slot agenda']))).slice(0, 10);
  // Como o poller entrega: as colunas da consulta, e as calculadas da agenda (`Data`, de onde
  // o `calendar` lê, entre elas) recalculadas sobre as linhas buscadas
  // (`colunas_calculadas` em realtime-poll.yaml) — copiar as do disco levaria a data velha.
  const tabelaDaAgenda = model.table('FIELD AGENDA')!;
  const calculadas = new Set(tabelaDaAgenda.columns.filter((c) => c.dax).map((c) => normalizeName(c.name)));
  const delta: Record<string, Escalar>[] = escolhidos.flatMap((p) =>
    (porProtocolo.get(p) ?? []).map((l): Record<string, Escalar> => {
      const fisica = Object.fromEntries(Object.entries(l).filter(([k]) => !calculadas.has(k)));
      return { ...fisica, 'slot agenda': l['slot agenda'] instanceof Date ? new Date((l['slot agenda'] as Date).getTime() + UM_DIA) : l['slot agenda'] };
    }),
  );
  materializaColunas(tabelaDaAgenda, model, delta, AGORA);
  for (let i = 0; i < delta.length; i++) delta[i] = Object.fromEntries(Object.entries(delta[i]!).map(([k, v]) => [normalizeName(k), v]));
  const doMes = escolhidos;
  const overlay = new Map<string, OverlayDeTabela>([
    [
      normalizeName('FIELD AGENDA'),
      { linhas: delta, corte: new Date(completa.cabecalho.geradoEm), chave: ['Protocolo'], marca: ['Data Criado', 'Inicio relato', 'Fim relato', 'Data Relato'] },
    ],
  ]);
  const [comCompleta, comSlot] = await cargas(mes, overlay);
  const pCompleta = calculaPagina(alvo, comCompleta.ev, janela);
  const pSlot = calculaPagina(alvo, comSlot.ev, janela);
  const mudou = comparaPaginas(pSemDelta, pCompleta, new Map()).diferentes.length;
  const c = comparaPaginas(pCompleta, pSlot, new Map());
  const recalculou = (r: string[]) => r.some((x) => x.startsWith('calendar:'));
  console.log(
    `\n2. relatorio-do-mes + tempo real (${delta.length} linhas de ${doMes.length} protocolos dos próximos 7 dias, horário um dia adiante): ` +
      `${c.comparados} visuais, ${c.iguais} iguais, ${c.diferentes.length} diferentes; ` +
      `o delta mudou ${mudou} visual(is); calendar recalculado: completa ${recalculou(comCompleta.recalculadas) ? 'sim' : 'NÃO'}, ` +
      `slot ${recalculou(comSlot.recalculadas) ? 'sim' : 'NÃO'}`,
  );
  for (const x of c.diferentes) console.log(`     ${(x.titulo ?? x.id).slice(0, 40).padEnd(40)} ${x.porque}`);
  problemas += c.diferentes.length;
  if (mudou === 0) {
    console.log('     o delta não mudou nada — a prova não vale');
    problemas++;
  }
  if (!recalculou(comCompleta.recalculadas) || !recalculou(comSlot.recalculadas)) problemas++;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${problemas === 0 ? 'OK' : `${problemas} problema(s)`}`);
process.exitCode = problemas === 0 ? 0 : 1;
