// Sonda das LISTAS DOS SELETORES sem a página do snapshot (passo 3,
// docs/DECISAO-AO-VIVO.md, ACHADOS #248):
//
//   1. seletor comum, em toda página que sabe ser ao vivo: a lista pela carga só dos
//      seletores (`idDosSeletores`, sem a forma completa do tempo real) é IGUAL à da página
//      inteira do snapshot — o caminho de antes?
//   2. seletor de coluna de relato (Agendamento Field): a lista da agregada
//      `valores-do-relato`, rodada agora no SRD, contra a da página inteira do snapshot (a
//      agenda completa). As duas são de instantes diferentes — a do snapshot é a da última
//      carga do grupo `frio` —, então uma diferença pequena pode ser dado novo; a sonda diz
//      quantos valores ficam só de um lado.
//
//   npm run probe:valores-ao-vivo [-- --dir=snapshot] [-- --sem-srd]
//
// A parte 2 lê o SRD (só leitura, credencial do `.env`); `--sem-srd` a pula. Imprime
// contagens; NUNCA valor de linha.
//
// Memória: carrega cada página inteira, a Agendamento Field com a agenda completa. Rode
// com heap folgado (o script npm já passa 8 GB).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { rotuloDeColuna } from '../../../packages/semantic-model/src/projecao.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import type { DaxValue } from '../../../packages/measure-engine/src/value.ts';
import type { Evaluator } from '../../../packages/measure-engine/src/evaluator.ts';
import { SABEM_SER_AO_VIVO } from '../../../api/src/ao-vivo-da-api.ts';
import { segmentacaoDe, type Segmentacao } from '../../../api/src/calcula.ts';
import { montaContextoAoVivo } from '../../../api/src/contexto-ao-vivo.ts';
import { distintosOrdenados, serializaValor, valoresDistintos } from '../../../api/src/valores-segmentacao.ts';
import { formaDaPagina, formaDoRecorte } from './forma-do-servidor.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const arg = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const DIR = path.resolve(ROOT, arg('dir') ?? 'snapshot');
const model = SemanticModel.fromSpecsDir(SPECS);
const AGORA = new Date();

const gatilhos = new Map<string, string>();
for (const g of model.graoReduzido) for (const c of g.colunasGatilho) gatilhos.set(normalizeName(rotuloDeColuna(g.tabela, c)), g.tabela);
const ehGatilho = (s: Segmentacao) => gatilhos.has(normalizeName(rotuloDeColuna(s.tabela, s.coluna)));

/** Os seletores que a rota `/valores` atende: hierarquia sem nível, ou coluna que filtra. */
function seletores(dash: DashboardSpec): Segmentacao[] {
  return (dash.visuals ?? [])
    .map((v) => segmentacaoDe(v))
    .filter((s): s is Segmentacao => s !== undefined && (s.niveis !== undefined || s.naoFiltra === undefined));
}

type Lista = ReturnType<typeof serializaValor>[];
const nivelDe = (s: Segmentacao) => (s.niveis !== undefined ? null : (s.nivel ?? null));
const rotulo = (s: Segmentacao) => `'${s.tabela}'[${s.coluna}]${s.nivel && !s.niveis ? `.[${s.nivel}]` : ''}`;
const lista = (ev: Evaluator, s: Segmentacao): Lista => valoresDistintos(ev, s.tabela, s.coluna, nivelDe(s)).map(serializaValor);
const chaves = (l: Lista) => new Set(l.map((v) => JSON.stringify(v)));
const soEm = (a: Lista, b: Lista) => {
  const kb = chaves(b);
  return [...chaves(a)].filter((k) => !kb.has(k)).length;
};

const paginas = loadDashboards(SPECS).filter((d) => SABEM_SER_AO_VIVO.has(d.id));
let iguais = 0;
let diferentes = 0;
/** As listas de relato da página inteira, para a parte 2. */
const daAgendaCompleta = new Map<string, { s: Segmentacao; lista: Lista }>();

console.log(`snapshot ${path.relative(ROOT, DIR) || DIR}; ${paginas.length} página(s) que sabem ser ao vivo\n`);
for (const dash of paginas) {
  const todos = seletores(dash);
  if (todos.length === 0) continue;
  const comuns = todos.filter((s) => !ehGatilho(s));
  const recorte = {
    ...dash,
    visuals: (dash.visuals ?? []).filter((v) => {
      const s = segmentacaoDe(v);
      return s !== undefined && !ehGatilho(s);
    }),
  };
  const formaInteira = formaDaPagina(dash, model);
  const formaRecorte = formaDoRecorte(recorte, model);

  let t0 = Date.now();
  const inteira = await carrega({ dir: DIR, model, dashboards: [dash], now: AGORA, liberaSobDemanda: [], precisaFormaCompleta: formaInteira, colunar: true });
  const msInteira = Date.now() - t0;
  const antes = new Map(todos.map((s) => [rotulo(s), lista(inteira.ev, s)]));
  for (const s of todos) if (ehGatilho(s)) daAgendaCompleta.set(rotulo(s), { s, lista: antes.get(rotulo(s))! });

  t0 = Date.now();
  const soSeletores = await carrega({ dir: DIR, model, dashboards: [recorte], now: AGORA, liberaSobDemanda: [], precisaFormaCompleta: formaRecorte, colunar: true });
  const msRecorte = Date.now() - t0;

  console.log(
    `${dash.id}: ${todos.length} seletor(es), ${comuns.length} pela carga só dos seletores; ` +
      `forma completa ${formaInteira.join(', ') || '—'} → ${formaRecorte.join(', ') || '—'}; ` +
      `carga ${(msInteira / 1000).toFixed(1)} s → ${(msRecorte / 1000).toFixed(1)} s`,
  );
  for (const s of comuns) {
    const a = antes.get(rotulo(s))!;
    const b = lista(soSeletores.ev, s);
    if (JSON.stringify(a) === JSON.stringify(b)) {
      iguais++;
      continue;
    }
    diferentes++;
    console.log(`  DIFERENTE ${rotulo(s)}: ${a.length} → ${b.length} valor(es); ${soEm(a, b)} só antes, ${soEm(b, a)} só agora`);
  }
}
console.log(`\nseletores comuns: ${iguais} iguais, ${diferentes} diferentes\n`);

// ---------------------------------------------------------------- 2. as listas de relato

const grao = model.graoReduzido.find((g) => g.valoresDosSeletores);
if (process.argv.includes('--sem-srd') || !grao) {
  console.log(`listas de relato: ${grao ? 'puladas (--sem-srd)' : 'nenhum grão reduzido declara valores_dos_seletores'}`);
} else {
  applyDotEnv(ROOT);
  const contexto = await montaContextoAoVivo(ROOT);
  if ('porque' in contexto) {
    console.log(`listas de relato: sem SRD — ${contexto.porque}`);
  } else {
    try {
      const spec = contexto.ctx.registry.get(grao.valoresDosSeletores!);
      const conector = contexto.ctx.connectors.get(spec.datasource ?? '');
      if (!conector) throw new Error(`sem conector para '${spec.datasource}'`);
      const t0 = Date.now();
      const linhas = (await conector.execute(spec, {})) as Record<string, unknown>[];
      console.log(
        `listas de relato — agregada '${spec.id}' no SRD: ${linhas.length} combinação(ões) em ${((Date.now() - t0) / 1000).toFixed(1)} s; ` +
          `contra a agenda completa do snapshot:`,
      );
      for (const { s, lista: doSnapshot } of daAgendaCompleta.values()) {
        const chave = Object.keys(linhas[0] ?? {}).find((k) => normalizeName(k) === normalizeName(s.coluna));
        if (chave === undefined) {
          console.log(`  ${rotulo(s)}: a agregada não traz a coluna`);
          diferentes++;
          continue;
        }
        const daAgregada = distintosOrdenados(linhas.map((l) => (l[chave] ?? null) as DaxValue)).map(serializaValor);
        const igual = JSON.stringify(daAgregada) === JSON.stringify(doSnapshot);
        console.log(
          `  ${rotulo(s)}: snapshot ${doSnapshot.length}, agregada ${daAgregada.length} — ` +
            (igual ? 'iguais, na mesma ordem' : `${soEm(doSnapshot, daAgregada)} só no snapshot, ${soEm(daAgregada, doSnapshot)} só na agregada`),
        );
      }
    } finally {
      await contexto.fecha();
    }
  }
}

process.exitCode = diferentes > 0 ? 1 : 0;
