// Sonda do MÊS DA AGENDA com a FIELD AGENDA completa (docs/DECISAO-AO-VIVO.md): a
// Agendamento Field calculada sobre o que a busca do mês traz dá os mesmos números que o
// snapshot de hoje — agora com os seis visuais de relato e os filtros nas colunas deles?
//
//   npm run probe:ao-vivo-agenda [-- --dir=snapshot --meses=2026-09,2026-10]
//
// Sem banco, sobre um snapshot em disco, e por isso sem diferença de instante:
//   - referência: a página carregada como a produção carrega — a FIELD AGENDA completa
//     (as fontes do tempo real a pedem) e as calculadas congeladas pelo refresh;
//   - ao vivo: a pasta do mês montada como o filho da busca monta (`geracao-do-conjunto.ts`)
//     — FIELD AGENDA completa e PROTOCOLOS GERAL pelo MESMO recorte da busca
//     (`aplicaRecorte` com o `ao-vivo.yaml`), as pequenas copiadas, e o `Status Protocolo
//     Dia` congelado pela tradução nativa sobre a pasta (`congelaStatusDoDia`).
// Que a consulta costurada traz as mesmas linhas que o recorte da original é a prova de
// `npm run probe:ao-vivo` (a mesma view aberta da agenda de slot).
//
// Cenários por mês: como abre, mais um filtro MOTIVO (o primeiro valor do mês) e um
// PRODUTIVO? = Improdutiva — os filtros de relato que até 25/10/2026 tiravam o pedido do
// ao vivo. Imprime contagens e a forma das diferenças; NUNCA valor de linha.
//
// Memória: lê a agenda completa inteira do snapshot. Rode com heap folgado, ex.:
//   node --max-old-space-size=6144 backend/tools/probe/src/ao-vivo-agenda.ts

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leCatalogoAoVivo } from '../../../packages/ao-vivo/src/catalogo.ts';
import { decideAoVivo } from '../../../packages/ao-vivo/src/periodo.ts';
import { aplicaRecorte, celula, texto } from '../../../packages/ao-vivo/src/recorte.ts';
import { congelaStatusDoDia, escreveSnapshotDoPeriodo, type TabelaDoPeriodo } from '../../../packages/ao-vivo/src/snapshot-do-periodo.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { le, leCabecalho, type Escalar } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery } from '../../../packages/snapshot/src/manifesto.ts';
import { recalculosAoVivo } from '../../../packages/snapshot/src/nativas.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { rotuloDeColuna } from '../../../packages/semantic-model/src/projecao.ts';
import { codificaFiltro, decodificaFiltros, type FiltroDeTela } from '../../../packages/widget-engine/src/filtro-url.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { calculaPagina, LINHAS_MAXIMO } from '../../../api/src/calcula.ts';
import { calculaNoDiretorio, comparaPaginas, queriesPequenas } from '../../../api/src/pagina-ao-vivo.ts';
import { mescladoresDe, overlaySobreBuscaAoVivo } from '../../../api/src/overlay-realtime.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const DIR = path.resolve(ROOT, arg('dir') ?? 'snapshot');
const model = SemanticModel.fromSpecsDir(SPECS);
const catalogo = leCatalogoAoVivo(SPECS);
const AGORA = new Date();
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** A forma completa que o servidor pede para a página (`#liberacaoDaPagina`, servidor.ts). */
function formaCompleta(dash: DashboardSpec): string[] {
  const gatilhos = new Map<string, string>();
  for (const g of model.graoReduzido) for (const c of g.colunasGatilho) gatilhos.set(normalizeName(rotuloDeColuna(g.tabela, c)), g.tabela);
  const fora = new Set<string>();
  const olha = (e: string | null, p: string | null) => {
    const t = e && p ? gatilhos.get(normalizeName(rotuloDeColuna(e, p))) : undefined;
    if (t) fora.add(t);
  };
  for (const v of dash.visuals ?? []) {
    for (const c of v.fields ?? []) if (c.kind !== 'measure') olha(c.entity, c.property);
    for (const f of v.filters ?? []) olha(f.entity, f.property);
  }
  for (const f of dash.filters ?? []) olha(f.entity, f.property);
  const recalc = recalculosAoVivo();
  for (const c of planeja([dash], model).calculadas) for (const f of recalc.get(normalizeName(c))?.fontes ?? []) fora.add(f);
  return [...fora];
}

/** A forma completa que o servidor pede para os de fora (`#liberacaoDosForaDoAoVivo`): sem o tempo real. */
function formaDosFora(dash: DashboardSpec): string[] {
  const gatilhos = new Map<string, string>();
  for (const g of model.graoReduzido) for (const c of g.colunasGatilho) gatilhos.set(normalizeName(rotuloDeColuna(g.tabela, c)), g.tabela);
  const fora = new Set<string>();
  const olha = (e: string | null, p: string | null) => {
    const t = e && p ? gatilhos.get(normalizeName(rotuloDeColuna(e, p))) : undefined;
    if (t) fora.add(t);
  };
  for (const v of dash.visuals ?? []) {
    for (const c of v.fields ?? []) if (c.kind !== 'measure') olha(c.entity, c.property);
    for (const f of v.filters ?? []) olha(f.entity, f.property);
  }
  for (const f of dash.filters ?? []) olha(f.entity, f.property);
  return [...fora];
}

/**
 * Uma query do snapshot, com as linhas sob os nomes do cabeçalho — como a busca as entrega —
 * e as brutas, com as chaves do dataset — como o poller entrega o delta.
 */
async function daQuery(query: string): Promise<TabelaDoPeriodo & { brutas: Record<string, Escalar>[]; geradoEm: string }> {
  const arquivo = arquivoDaQuery(DIR, query);
  const cab = leCabecalho(arquivo);
  const colunas = cab.colunas.map((c) => c.nome);
  const { linhas } = await le(arquivo);
  return {
    query,
    colunas,
    linhas: linhas.map((l) => Object.fromEntries(colunas.map((c) => [c, (l[normalizeName(c)] ?? null) as Escalar]))),
    brutas: linhas as Record<string, Escalar>[],
    geradoEm: cab.geradoEm,
  };
}

/** O instante de uma célula de data, ou -∞. */
const instante = (v: Escalar): number => (v instanceof Date ? v.getTime() : Number.NEGATIVE_INFINITY);

const dash = loadDashboards(SPECS).find((d) => d.id === 'agendamento-field')!;
const mesesPedidos = (arg('meses') ?? `${AGORA.getFullYear()}-${String(AGORA.getMonth()).padStart(2, '0')},${AGORA.getFullYear()}-${String(AGORA.getMonth() + 1).padStart(2, '0')}`)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const agenda = await daQuery('field-agenda');
const pg = await daQuery('protocolos-geral');
const completa = formaCompleta(dash);
console.log(
  `snapshot ${path.relative(ROOT, DIR) || DIR}: FIELD AGENDA completa ${agenda.linhas.length} linha(s), PG ${pg.linhas.length}; ` +
    `a referência carrega na forma completa: ${completa.join(', ') || '(nenhuma)'}\n`,
);

const tRef = Date.now();
const ref = await carrega({ dir: DIR, model, dashboards: [dash], now: AGORA, liberaSobDemanda: [], precisaFormaCompleta: completa, colunar: true });
console.log(`referência carregada em ${((Date.now() - tRef) / 1000).toFixed(1)} s\n`);

let diferentes = 0;
for (const mes of mesesPedidos) {
  const [ano, m] = mes.split('-').map(Number) as [number, number];
  const periodo = { desde: `${ano}-${String(m).padStart(2, '0')}-01`, ate: new Date(Date.UTC(ano, m, 1)).toISOString().slice(0, 10) };
  const cal: FiltroDeTela[] = [
    { tabela: 'calendar', coluna: 'Data', nivel: 'Ano', valores: [ano] },
    { tabela: 'calendar', coluna: 'Data', nivel: 'Mês', valores: [MESES[m - 1]!] },
  ];

  // A pasta do mês, como o filho a monta.
  const linhasAgenda = aplicaRecorte(agenda.linhas, catalogo.get('field-agenda')!.recorte, periodo);
  const lista = [...new Set(linhasAgenda.map((l) => texto(celula(l, 'Protocolo'))))];
  const linhasPg = aplicaRecorte(pg.linhas, catalogo.get('protocolos-geral')!.recorte, { protocolos: lista });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-vivo-agenda-'));
  try {
    const tMonta = Date.now();
    await escreveSnapshotDoPeriodo(
      tmp,
      model,
      { consultas: [{ ...agenda, linhas: linhasAgenda }, { ...pg, linhas: linhasPg }] },
      AGORA.toISOString(),
      { dir: DIR, queries: queriesPequenas(dash, model) },
    );
    await congelaStatusDoDia(tmp, model, dash, AGORA, AGORA.toISOString());
    console.log(
      `${mes}: ${lista.length} protocolo(s), FIELD AGENDA ${linhasAgenda.length} de ${agenda.linhas.length} linha(s), PG ${linhasPg.length}; ` +
        `pasta montada em ${((Date.now() - tMonta) / 1000).toFixed(1)} s`,
    );

    const motivo = linhasAgenda.map((l) => celula(l, 'ClassificacaoRelato')).find((v) => v !== null && v !== '');
    const cenarios: [string, FiltroDeTela[]][] = [['como abre', cal]];
    if (motivo !== undefined) cenarios.push(['+ MOTIVO (o primeiro do mês)', [...cal, { tabela: 'FIELD AGENDA', coluna: 'ClassificacaoRelato', valores: [motivo as string] }]]);
    cenarios.push(['+ PRODUTIVO? = Improdutiva', [...cal, { tabela: 'FIELD AGENDA', coluna: 'CategoriaProdutividade', valores: ['Improdutiva'] }]]);

    for (const [nome, filtros] of cenarios) {
      const daTela = decodificaFiltros(filtros.map(codificaFiltro));
      const d = decideAoVivo(dash, daTela, model);
      if ('porque' in d) {
        console.log(`  ${nome}: NÃO VAI AO VIVO — ${d.porque}`);
        diferentes++;
        continue;
      }
      const alvo = { ...dash, filters: [...(dash.filters ?? []), ...daTela] };
      const janela = { de: 0, linhas: LINHAS_MAXIMO };
      const pRef = calculaPagina(alvo, ref.ev, janela);
      const tVivo = Date.now();
      const vivo = await calculaNoDiretorio({
        dir: tmp,
        model,
        dash,
        alvo,
        fora: d.fora,
        ...(d.formaCompleta ? { formaCompleta: d.formaCompleta } : {}),
        janela,
        clicados: [],
        agora: AGORA,
      });
      const c = comparaPaginas(pRef, vivo.pagina, d.fora);
      console.log(
        `  ${nome}: ${c.comparados} visuais, ${c.iguais} iguais, ${c.soOrdem.length} só na ordem, ${c.diferentes.length} diferentes, ` +
          `${c.fora} fora; erros ${pRef.resumo.falharam} na referência, ${vivo.pagina.resumo.falharam} ao vivo; ` +
          `carga + cálculo ${((Date.now() - tVivo) / 1000).toFixed(1)} s`,
      );
      for (const x of [...c.soOrdem, ...c.diferentes]) console.log(`    ${(x.titulo ?? x.id).slice(0, 40).padEnd(40)} ${x.porque}`);
      diferentes += c.diferentes.length + vivo.pagina.resumo.falharam;

      // Os de fora, como o servidor os pede agora (`idDosForaDoAoVivo`): a carga só deles,
      // sem a forma completa do tempo real — contra a mesma referência.
      const soFora = { ...dash, visuals: (dash.visuals ?? []).filter((v) => d.fora.has(v.id)) };
      const cFora = await carrega({ dir: DIR, model, dashboards: [soFora], now: AGORA, liberaSobDemanda: [], precisaFormaCompleta: formaDosFora(soFora), colunar: true });
      const pFora = calculaPagina({ ...alvo, visuals: soFora.visuals }, cFora.ev, janela);
      const so = (p: typeof pRef) => ({ ...p, visuais: p.visuais.filter((v) => d.fora.has(v.id)) });
      const cf = comparaPaginas(so(pRef), so(pFora), new Map());
      const fa = (m: ReadonlyMap<string, number>) => m.get('FIELD AGENDA') ?? 0;
      console.log(
        `    os ${cf.comparados} de fora com a carga só deles: ${cf.iguais} iguais, ${cf.diferentes.length} diferentes; ` +
          `FIELD AGENDA ${fa(ref.linhasPorTabela)} → ${fa(cFora.linhasPorTabela)} linhas`,
      );
      for (const x of cf.diferentes) console.log(`    ${(x.titulo ?? x.id).slice(0, 40).padEnd(40)} ${x.porque}`);
      diferentes += cf.diferentes.length + pFora.resumo.falharam;
    }

    // O TEMPO REAL sobre o mês ao vivo (`overlaySobreBuscaAoVivo`, servidor.ts): um delta
    // como o poller entrega — 10 protocolos do mês reentregues sem o relato mais novo, e um
    // protocolo de fora do mês reentregue inteiro — aplicado ao snapshot inteiro (com o corte
    // do poller) e à pasta do mês (com o corte da busca). As duas pontas têm de dar o mesmo;
    // e o delta tem de mudar algum número, ou a prova não prova nada.
    {
      const doMes = new Set(lista.slice(0, 10));
      const porProtocolo = new Map<string, Record<string, Escalar>[]>();
      for (const l of agenda.brutas) {
        const p = texto(l['protocolo'] ?? null);
        if (!doMes.has(p) && porProtocolo.size > 10) continue;
        const ls = porProtocolo.get(p) ?? [];
        ls.push(l);
        porProtocolo.set(p, ls);
      }
      const delta: Record<string, Escalar>[] = [];
      for (const p of doMes) {
        // TODAS as linhas do relato mais novo: o grão relato repete linha (os dois ramos
        // do append), e tirar uma cópia só não muda o que a tela mostra.
        const ls = porProtocolo.get(p) ?? [];
        const maisNovo = Math.max(...ls.map((l) => instante(l['data relato'] ?? null)));
        delta.push(...ls.filter((l) => !Number.isFinite(maisNovo) || instante(l['data relato'] ?? null) !== maisNovo));
      }
      const deFora = [...porProtocolo.keys()].find((p) => !lista.includes(p));
      if (deFora) delta.push(...porProtocolo.get(deFora)!);
      const overlays = new Map([
        [
          normalizeName('FIELD AGENDA'),
          { linhas: delta, corte: new Date(agenda.geradoEm), chave: ['Protocolo'], marca: ['Data Criado', 'Inicio relato', 'Fim relato', 'Data Relato'] },
        ],
      ]);
      const daTela = decodificaFiltros(cal.map(codificaFiltro));
      const d = decideAoVivo(dash, daTela, model);
      if (!('porque' in d)) {
        const alvo = { ...dash, filters: [...(dash.filters ?? []), ...daTela] };
        const janela = { de: 0, linhas: LINHAS_MAXIMO };
        const refOv = await carrega({
          dir: DIR,
          model,
          dashboards: [dash],
          now: AGORA,
          liberaSobDemanda: [],
          precisaFormaCompleta: completa,
          colunar: true,
          overlay: mescladoresDe(overlays),
        });
        const pRefOv = calculaPagina(alvo, refOv.ev, janela);
        const vivo = await calculaNoDiretorio({
          dir: tmp,
          model,
          dash,
          alvo,
          fora: d.fora,
          ...(d.formaCompleta ? { formaCompleta: d.formaCompleta } : {}),
          overlay: overlaySobreBuscaAoVivo(overlays, AGORA.toISOString()),
          janela,
          clicados: [],
          agora: AGORA,
        });
        const mudou = comparaPaginas(calculaPagina(alvo, ref.ev, janela), pRefOv, d.fora).diferentes.length;
        const c = comparaPaginas(pRefOv, vivo.pagina, d.fora);
        console.log(
          `  + tempo real (${delta.length} linhas de ${doMes.size + (deFora ? 1 : 0)} protocolos): ${c.comparados} visuais, ` +
            `${c.iguais} iguais, ${c.diferentes.length} diferentes; o delta mudou ${mudou} visual(is) da referência; ` +
            `erros ${pRefOv.resumo.falharam} na referência, ${vivo.pagina.resumo.falharam} ao vivo`,
        );
        for (const x of c.diferentes) console.log(`    ${(x.titulo ?? x.id).slice(0, 40).padEnd(40)} ${x.porque}`);
        diferentes += c.diferentes.length + vivo.pagina.resumo.falharam + (mudou === 0 ? 1 : 0);
        if (mudou === 0) console.log('    o delta não mudou nada — a prova não vale');
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(`\n${diferentes === 0 ? 'PARIDADE: o mês da agenda com a FIELD AGENDA completa dá os mesmos números.' : 'HÁ DIFERENÇA — ver acima.'}`);
process.exit(diferentes === 0 ? 0 : 1);
