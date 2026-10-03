// Quanto a tabela colunar economiza, contra os arquivos REAIS de `snapshot/`.
//
// Existe porque o número que justifica a Fase 2 não pode ser de protótipo: ele tem
// de ser reproduzível por quem duvidar, com um comando. Compara, por tabela:
//
//   - o custo de hoje: `Record<string, Escalar>` por linha, como `le()` devolve;
//   - o custo de `TabelaColunar`: dicionário + `Int32Array`.
//
// REGRA DE SAÍDA, como o resto de `backend/tools/`: imprime id, contagem, nome de coluna e
// tempo. **Nunca valor de linha** — `snapshot/` tem endereço, telefone e CPF.
//
//   node backend/tools/bench/src/colunar.ts                    # todas as tabelas
//   node backend/tools/bench/src/colunar.ts protocolos-produtividade field-agenda

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { ConstrutorDeTabela } from '../../../packages/snapshot/src/tabela-colunar.ts';
import { VistaDeLinhas } from '../../../packages/snapshot/src/linha-vista.ts';
import { decodifica, ehArquivoDeSnapshot, semSufixo, type CabecalhoDeSnapshot, type Escalar } from '../../../packages/snapshot/src/formato.ts';

const RAIZ = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const DIR = path.join(RAIZ, 'snapshot');

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1).padStart(8);
}

/** Lê o arquivo inteiro para memória uma vez; as duas medições partem do mesmo texto. */
function leLinhas(arquivo: string): { cab: CabecalhoDeSnapshot; linhas: string[] } {
  const cru = arquivo.endsWith('.gz')
    ? zlib.gunzipSync(fs.readFileSync(arquivo))
    : fs.readFileSync(arquivo);
  const linhas = cru.toString('utf8').split('\n');
  return { cab: JSON.parse(linhas[0]!) as CabecalhoDeSnapshot, linhas };
}

const SUMIDOURO: unknown[] = [];

function heap(): number {
  global.gc?.();
  return process.memoryUsage().heapUsed;
}

const TOTAL = { objetos: 0, colunar: 0, ids: 0, dicionarios: 0, cascas: 0, linhas: 0, celulas: 0, divergencias: 0 };

function mede(id: string, arquivo: string): void {
  const { cab, linhas } = leLinhas(arquivo);
  const nomes = cab.colunas.map((c) => c.nome);
  const tipos = cab.colunas.map((c) => c.tipo);
  const n = cab.linhas;

  // ── como é hoje: um objeto por linha ──────────────────────────────────────
  const base1 = heap();
  const t1 = Date.now();
  let objetos: Record<string, unknown>[] | null = [];
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    const arr = JSON.parse(l) as unknown[];
    const o: Record<string, unknown> = {};
    for (let j = 0; j < nomes.length; j++) o[nomes[j]!] = decodifica(arr[j], tipos[j]!, id);
    objetos.push(o);
  }
  const msObjetos = Date.now() - t1;
  // O `push` é o que impede o V8 de coletar `objetos` antes da medição: sem ele, a
  // análise de vivacidade vê a variável morta após o último uso e o heap dá ZERO.
  SUMIDOURO.push(objetos);
  const heapObjetos = heap() - base1;
  const objetosGuardados = objetos;
  objetos = null;

  // ── como fica: dicionário + Int32Array, UMA passada ──────────────────────
  const base2 = heap();
  const t2 = Date.now();
  const c = new ConstrutorDeTabela(id, nomes, n);
  for (let i = 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    const arr = JSON.parse(l) as unknown[];
    const vs = new Array(nomes.length);
    for (let j = 0; j < nomes.length; j++) vs[j] = decodifica(arr[j], tipos[j]!, id);
    c.poeLinha(vs);
  }
  const tabela = c.fecha();
  const msColunar = Date.now() - t2;
  SUMIDOURO.push(tabela);
  const heapColunar = heap() - base2;
  void heapColunar;
  const b = tabela.bytes();

  // ── o custo da PONTE: uma casca de objeto por linha ────────────────────────
  //
  // `VistaDeLinhas` é o que permite trocar o armazenamento sem mexer na assinatura
  // de `columnValue`. Ela não guarda valor — só um índice — mas ainda é um objeto
  // por linha, e esse custo tem de aparecer no total; senão a economia anunciada
  // fica maior que a entregue. Foi esse tipo de omissão que me fez afirmar 131 MB.
  const base3 = heap();
  const vista = new VistaDeLinhas(tabela);
  const linhasVista = vista.todas();
  SUMIDOURO.push(linhasVista);
  const heapCascas = heap() - base3;

  // ── as duas representações concordam, célula a célula? ────────────────────
  //
  // O teste diferencial de `backend/packages/snapshot/test/` prova isto sobre casos
  // sintéticos escolhidos a dedo. Aqui a mesma pergunta é feita contra o dado REAL,
  // que é onde moram o tipo misto, a data de borda e o texto que parece número.
  // Custa uma varredura e é o que autoriza trocar a representação embaixo do
  // avaliador — sem isso, a economia de memória seria uma aposta.
  let divergencias = 0;
  let primeira = '';
  if (objetosGuardados) {
    for (let i = 0; i < objetosGuardados.length && divergencias < 5; i++) {
      const o = objetosGuardados[i]!;
      for (const nome of nomes) {
        const a = o[nome] as Escalar;
        // Pela VISTA, e não por `tabela.valor`: é a vista que o avaliador vai ler,
        // então é ela que precisa concordar com o objeto de hoje. Medir só o
        // armazenamento e ligar a ponte seria provar a metade errada.
        const c2 = linhasVista[i]![nome] as Escalar;
        const iguais =
          a instanceof Date || c2 instanceof Date
            ? a instanceof Date && c2 instanceof Date && a.getTime() === c2.getTime()
            : Object.is(a ?? null, c2 ?? null);
        if (!iguais) {
          divergencias++;
          // NUNCA imprime o valor — `snapshot/` tem endereço, telefone e CPF.
          // Nomear linha, coluna e TIPO basta para investigar.
          if (!primeira) primeira = `linha ${i}, coluna '${nome}' (${typeof a} vs ${typeof c2})`;
          break;
        }
      }
    }
  }
  TOTAL.divergencias += divergencias;

  // A razão é contra o custo REAL da troca: armazenamento + cascas da vista.
  const comPonte = b.total + Math.max(heapCascas, 0);
  const razao = heapObjetos > 0 ? (heapObjetos / Math.max(comPonte, 1)).toFixed(1) : '—';
  console.log(
    `${id.padEnd(26)} ${String(n).padStart(9)} x ${String(nomes.length).padStart(3)}  ` +
      `objetos ${mb(heapObjetos)} MB / ${String(msObjetos).padStart(6)} ms   ` +
      `colunar ${mb(b.total)} MB (ids ${mb(b.ids)} + dic ${mb(b.dicionarios)} + cascas ${mb(heapCascas)}) / ${String(msColunar).padStart(6)} ms   ` +
      `${razao}x` + (divergencias ? `  DIVERGE: ${primeira}` : '  ok'),
  );

  TOTAL.objetos += Math.max(heapObjetos, 0);
  TOTAL.colunar += b.total;
  TOTAL.ids += b.ids;
  TOTAL.dicionarios += b.dicionarios;
  TOTAL.cascas += Math.max(heapCascas, 0);
  TOTAL.linhas += n;
  TOTAL.celulas += n * nomes.length;

  // Esvazia: sem isto o sumidouro mantém a tabela anterior viva e a medição da
  // próxima sai inflada pelo que já foi medido.
  SUMIDOURO.length = 0;
}

const pedidas = process.argv.slice(2);
const arquivos = fs
  .readdirSync(DIR)
  .filter(ehArquivoDeSnapshot)
  .filter((f) => !semSufixo(f).startsWith('calc.'))
  .filter((f) => pedidas.length === 0 || pedidas.includes(semSufixo(f)))
  .sort();

if (!arquivos.length) {
  console.error(`nada a medir em ${DIR}${pedidas.length ? ` para: ${pedidas.join(', ')}` : ''}`);
  process.exit(1);
}

console.log(`${arquivos.length} tabela(s) de ${DIR}`);
console.log('(rode com --expose-gc para os números de heap ficarem estáveis)\n');
for (const f of arquivos) {
  try {
    mede(semSufixo(f), path.join(DIR, f));
  } catch (e) {
    console.log(`${semSufixo(f).padEnd(26)} ERRO: ${(e as Error).message.slice(0, 70)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// O total é o número que decide a Fase 2: não "esta tabela melhora", e sim "o
// modelo inteiro passa a caber". Some aqui, e não na cabeça de quem lê a tabela
// acima — foi somando à mão que eu errei antes, afirmando 131 MB (que é só
// `células x 4 bytes`, ignorando os dicionários).
console.log('');
console.log('─'.repeat(100));
console.log(
  `TOTAL  ${TOTAL.linhas.toLocaleString('pt-BR')} linhas, ` +
    `${TOTAL.celulas.toLocaleString('pt-BR')} células`,
);
console.log(
  `  como objetos (hoje) ... ${mb(TOTAL.objetos)} MB\n` +
    `  como colunas .......... ${mb(TOTAL.colunar)} MB  ` +
    `(ids ${mb(TOTAL.ids)} + dicionários ${mb(TOTAL.dicionarios)})\n` +
    `  cascas da vista ....... ${mb(TOTAL.cascas)} MB  ` +
    `(um objeto de índice por linha — o preço da ponte)\n` +
    `  total com a ponte ..... ${mb(TOTAL.colunar + TOTAL.cascas)} MB\n` +
    `  razão ................. ${(TOTAL.objetos / Math.max(TOTAL.colunar + TOTAL.cascas, 1)).toFixed(1)}x`,
);
console.log(
  TOTAL.divergencias === 0
    ? '  células divergentes ... 0 — a VISTA e o objeto de hoje concordam no dado real'
    : `  células divergentes ... ${TOTAL.divergencias}  <-- INVESTIGUE ANTES DE TROCAR NADA`,
);
