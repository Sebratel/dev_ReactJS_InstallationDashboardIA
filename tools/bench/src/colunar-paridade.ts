// A página inteira, calculada pelos DOIS caminhos, dá o mesmo resultado?
//
// `packages/snapshot/test/carrega-colunar-diferencial.test.ts` prova isso sobre um
// snapshot sintético, com os casos escolhidos a dedo. Aqui a mesma pergunta é feita
// contra o dado REAL e contra as páginas REAIS — que é onde moram a data de borda,
// o tipo misto, a coluna omitida pela projeção e o DAX que ninguém lembrava.
//
// É este programa que autoriza ligar `colunar: true` em produção. Sem ele, a troca
// de representação seria uma aposta: as duas leituras concordarem célula a célula
// (o que `bench:colunar` já prova) não garante que o CÁLCULO concorde, porque entre
// a célula e o número há filtro, transição de contexto e coluna calculada.
//
// REGRA DE SAÍDA, como o resto de `tools/`: id, contagem, nome de coluna e tempo.
// **Nunca valor de linha** — uma tabela ou matriz calculada É dado de cliente
// (CLIENTE, TELEFONE, endereço). Quando diverge, isto imprime o CAMINHO dentro do
// resultado e os TIPOS dos dois lados, nunca os valores.
//
//   npm run bench:colunar-paridade
//   node tools/bench/src/colunar-paridade.ts diario-instalacao

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculaPagina } from '../../../apps/api/src/calcula.ts';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, DIRETORIO_PADRAO);

/**
 * O resultado, sem o que muda de execução para execução.
 *
 * `ms` é tempo e não faz parte do resultado; compará-lo faria toda página divergir
 * e o programa não diria nada. Data vira ISO para a comparação não depender da
 * identidade do objeto `Date`.
 */
function comparavel(v: unknown): unknown {
  if (v instanceof Date) return `@${v.getTime()}`;
  if (Array.isArray(v)) return v.map(comparavel);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'ms') continue;
      out[k] = comparavel(x);
    }
    return out;
  }
  return v;
}

/**
 * O primeiro ponto em que os dois diferem, como CAMINHO — `visuais[3].linhas[17].c2`.
 *
 * Devolver o caminho e não os valores é o que torna este programa seguro de rodar:
 * o caminho basta para investigar, e não carrega nome, telefone nem endereço de
 * ninguém. Os tipos entram porque "número virou texto" é a falha mais provável, e
 * ela é visível sem o valor.
 */
function ondeDifere(a: unknown, b: unknown, caminho = ''): string | null {
  if (a === b) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return `${caminho || '(raiz)'}: ${ta} vs ${tb}`;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return `${caminho || '(raiz)'}: ${a.length} itens vs ${b.length}`;
    }
    for (let i = 0; i < a.length; i++) {
      const d = ondeDifere(a[i], b[i], `${caminho}[${i}]`);
      if (d) return d;
    }
    return null;
  }

  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length || ka.some((k) => !kb.includes(k))) {
      return `${caminho || '(raiz)'}: chaves diferentes (${ka.length} vs ${kb.length})`;
    }
    for (const k of ka) {
      const d = ondeDifere(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        caminho ? `${caminho}.${k}` : k,
      );
      if (d) return d;
    }
    return null;
  }

  // Mesmo tipo e valores diferentes: nomeia o caminho e o tipo, e cala o valor.
  return `${caminho || '(raiz)'}: dois ${ta} diferentes`;
}

const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
const agora = new Date();
const pedidas = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const todas = loadDashboards(path.join(ROOT, 'specs')) as DashboardSpec[];
const paginas = pedidas.length ? todas.filter((d) => pedidas.includes(d.id)) : todas;

if (!paginas.length) {
  console.error(`nenhuma página para: ${pedidas.join(', ') || '(todas)'}`);
  process.exit(1);
}

console.log(`${paginas.length} página(s), cada uma carregada e calculada DUAS vezes\n`);

let divergentes = 0;
let falharam = 0;
let msObjeto = 0;
let msColunar = 0;

for (const dash of paginas) {
  const rot = dash.id.padEnd(28);
  try {
    const t0 = performance.now();
    const o = await carrega({ dir: DIR, model, dashboards: [dash], now: agora, colunar: false });
    const co = calculaPagina(dash, o.ev);
    const tO = performance.now() - t0;

    const t1 = performance.now();
    const c = await carrega({ dir: DIR, model, dashboards: [dash], now: agora, colunar: true });
    const cc = calculaPagina(dash, c.ev);
    const tC = performance.now() - t1;

    msObjeto += tO;
    msColunar += tC;

    const d = ondeDifere(comparavel(co), comparavel(cc));
    const linhas = [...o.linhasPorTabela.values()].reduce((s, n) => s + n, 0);
    console.log(
      `${rot} ${String(dash.visuals?.length ?? 0).padStart(3)} visuais, ` +
        `${linhas.toLocaleString('pt-BR').padStart(9)} linhas   ` +
        `objeto ${tO.toFixed(0).padStart(6)} ms   colunar ${tC.toFixed(0).padStart(6)} ms   ` +
        (d ? `DIVERGE em ${d}` : 'iguais'),
    );
    if (d) divergentes++;
  } catch (e) {
    falharam++;
    console.log(`${rot} ERRO: ${(e as Error).message.slice(0, 90)}`);
  }
}

console.log('');
console.log('─'.repeat(100));
console.log(
  `páginas ................ ${paginas.length}  ` +
    `(${divergentes} divergente(s), ${falharam} com erro)`,
);
console.log(
  `tempo total ............ objeto ${msObjeto.toFixed(0)} ms   colunar ${msColunar.toFixed(0)} ms`,
);
console.log(
  divergentes === 0 && falharam === 0
    ? 'resultado .............. IGUAL nos dois caminhos, em todas as páginas'
    : 'resultado .............. NÃO LIGUE `colunar: true` ANTES DE ENTENDER O ACIMA',
);
process.exit(divergentes || falharam ? 1 : 0);
