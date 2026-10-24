// Sonda do conjunto da JANELA (docs/DECISAO-AO-VIVO.md, fase 2): as páginas de protocolos
// calculadas sobre o que o conjunto traz dão os mesmos números que o snapshot de hoje?
//
//   npm run probe:ao-vivo-janela [-- --dir=snapshot]
//
// Sem banco, sobre um snapshot em disco, e por isso sem diferença de instante:
//   - referência: a página carregada como a produção carrega — a agenda completa quando o
//     servidor a pede (grão relato citado, ou o tempo real recalculando a `calendar`) e as
//     calculadas congeladas em disco;
//   - ao vivo: a MESMA página montada só com o que o conjunto da janela traria — PG,
//     telefonia e a agenda no GRÃO DE SLOT, mais as queries copiadas —, sem calculada em
//     disco (recalculadas no carregamento) e sem os visuais do grão relato.
// O que a sonda prova é exatamente a troca: agenda completa → slot, e calculada congelada →
// recalculada. Que as consultas do SRD trazem o mesmo que o refresh grava é o mesmo SQL.
//
// Imprime contagens e a forma das diferenças; NUNCA valor de linha.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGINAS_DA_JANELA, QUERIES_DA_JANELA } from '../../../packages/ao-vivo/src/janela-de-protocolos.ts';
import { visuaisForaDoAoVivo } from '../../../packages/ao-vivo/src/periodo.ts';
import { texto } from '../../../packages/ao-vivo/src/recorte.ts';
import {
  calculadasCongeladas,
  escreveSnapshotDoPeriodo,
  type TabelaDoPeriodo,
} from '../../../packages/ao-vivo/src/snapshot-do-periodo.ts';
import { le, leCabecalho, type Escalar } from '../../../packages/snapshot/src/formato.ts';
import { arquivoDaQuery } from '../../../packages/snapshot/src/manifesto.ts';
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { rotuloDeColuna } from '../../../packages/semantic-model/src/projecao.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { recalculosAoVivo } from '../../../packages/snapshot/src/nativas.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { codificaFiltro, decodificaFiltros, type FiltroDeTela } from '../../../packages/widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../../packages/widget-engine/src/filtros-padrao.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { calculaPagina, LINHAS_MAXIMO } from '../../../api/src/calcula.ts';
import { calculaNoDiretorio, comparaPaginas, queriesPequenas } from '../../../api/src/pagina-ao-vivo.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const DIR = path.resolve(ROOT, arg('dir') ?? 'snapshot');
const model = SemanticModel.fromSpecsDir(SPECS);
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

/**
 * A agenda no grão de slot TIRADA da completa do mesmo snapshot: um registro por horário,
 * só com as colunas do arquivo de slot. As duas queries são buscadas com minutos de
 * distância no refresh, e um reagendamento nesse meio aparecia como diferença (medido em
 * 24/10/2026: 4 horários novos e 1 reagendado entre as duas). Tirando uma da outra, a
 * única diferença que sobra é o grão — que é o que a sonda prova.
 */
async function agendaDeSlotDaCompleta(): Promise<TabelaDoPeriodo> {
  const colunas = leCabecalho(arquivoDaQuery(DIR, 'field-agenda-slot')).colunas.map((c) => c.nome);
  const { linhas } = await le(arquivoDaQuery(DIR, 'field-agenda'));
  const vistos = new Set<string>();
  const saida: Record<string, Escalar>[] = [];
  for (const l of linhas) {
    const linha = Object.fromEntries(colunas.map((c) => [c, (l[normalizeName(c)] ?? null) as Escalar]));
    const k = colunas.map((c) => texto(linha[c] ?? null)).join('\u0001');
    if (vistos.has(k)) continue;
    vistos.add(k);
    saida.push(linha);
  }
  return { query: 'field-agenda-slot', colunas, linhas: saida };
}

const paginasPedidas = arg('paginas')?.split(',');
let diferentes = 0;
const paginas = loadDashboards(SPECS).filter((d) => (paginasPedidas ?? PAGINAS_DA_JANELA).includes(d.id));
const slotDaCompleta = await agendaDeSlotDaCompleta();
console.log(`snapshot ${path.relative(ROOT, DIR) || DIR} — ${paginas.length} página(s); agenda de slot tirada da completa: ${slotDaCompleta.linhas.length} horário(s)\n`);
for (const dash of paginas) {
  const plano = planeja([dash], model);
  const fora = visuaisForaDoAoVivo(dash, model);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-vivo-janela-'));
  try {
    // O que o conjunto da janela grava: as três do SRD e as copiadas — aqui, do mesmo
    // snapshot, com a agenda de slot tirada da completa. Página com `Status Protocolo Dia`
    // (a Agendamento Field, se pedida) recebe a congelada: sem os relatos ela não sai do slot.
    const copiadas = [...new Set([...QUERIES_DA_JANELA, ...queriesPequenas(dash, model)])].filter(
      (q) => q !== 'field-agenda-slot' && (fs.existsSync(path.join(DIR, `${q}.jsonl.gz`)) || fs.existsSync(path.join(DIR, `${q}.jsonl`))),
    );
    const calculadas = plano.calculadas.includes('Status Protocolo Dia')
      ? await calculadasCongeladas(DIR, model, ['Status Protocolo Dia'])
      : [];
    await escreveSnapshotDoPeriodo(tmp, model, { consultas: [slotDaCompleta], calculadas }, AGORA.toISOString(), { dir: DIR, queries: copiadas });

    const tRef = Date.now();
    const completa = formaCompleta(dash);
    const ref = await carrega({ dir: DIR, model, dashboards: [dash], now: AGORA, liberaSobDemanda: [], precisaFormaCompleta: completa, colunar: true });
    const msRef = Date.now() - tRef;

    const cal = ['CALENDARIO INSTALADO', 'CALENDARIO CRIADO'].find((c) => plano.calculadas.includes(c));
    const coluna = cal === 'CALENDARIO INSTALADO' ? 'DATA INSTALADO' : 'DATA CRIADO';
    const mesFechado = new Date(AGORA.getFullYear(), AGORA.getMonth() - 1, 15);
    const cenarios: [string, FiltroDeTela[]][] = [['como abre', filtrosPadrao(dash.id, AGORA)]];
    if (cal) {
      cenarios.push([
        `${cal} = ${MESES[mesFechado.getMonth()]}`,
        [
          { tabela: cal, coluna, nivel: 'Ano', valores: [mesFechado.getFullYear()] },
          { tabela: cal, coluna, nivel: 'Mês', valores: [MESES[mesFechado.getMonth()]!] },
        ],
      ]);
    }
    for (const [nome, filtros] of cenarios) {
      const daTela = decodificaFiltros(filtros.map(codificaFiltro));
      const alvo = { ...dash, filters: [...(dash.filters ?? []), ...daTela] };
      const janela = { de: 0, linhas: LINHAS_MAXIMO };
      const pRef = calculaPagina(alvo, ref.ev, janela);
      const tVivo = Date.now();
      const vivo = await calculaNoDiretorio({ dir: tmp, model, dash, alvo, fora, janela, clicados: [], agora: AGORA });
      const c = comparaPaginas(pRef, vivo.pagina, fora);
      const fa = (m: ReadonlyMap<string, number>) => m.get('FIELD AGENDA') ?? 0;
      console.log(
        `${dash.id} — ${nome}: ${c.comparados} visuais, ${c.iguais} iguais, ${c.soOrdem.length} só na ordem, ` +
          `${c.diferentes.length} diferentes, ${c.fora} fora; erros ${pRef.resumo.falharam} na referência, ${vivo.pagina.resumo.falharam} ao vivo`,
      );
      console.log(
        `  FIELD AGENDA ${fa(ref.linhasPorTabela)} → ${fa(vivo.linhasPorTabela)} linhas` +
          `${completa.length ? ` (a referência carrega a completa: ${completa.join(', ')})` : ''}; ` +
          `carga ${(msRef / 1000).toFixed(1)} s → ${((Date.now() - tVivo) / 1000).toFixed(1)} s com o cálculo`,
      );
      for (const d of [...c.soOrdem, ...c.diferentes]) console.log(`    ${(d.titulo ?? d.id).slice(0, 40).padEnd(40)} ${d.porque}`);
      diferentes += c.diferentes.length + vivo.pagina.resumo.falharam;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
console.log(`\n${diferentes === 0 ? 'PARIDADE: o conjunto da janela dá os mesmos números.' : 'HÁ DIFERENÇA — ver acima.'}`);
process.exit(diferentes === 0 ? 0 : 1);
