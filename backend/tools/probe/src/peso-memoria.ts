// Quanto o DADO de cada página pesa na memória — e o que é lido do banco sem nunca
// chegar nela.
//
//   npm run probe:peso-memoria [-- --dir=snapshot] [-- --pagina=visao-geral]
//
// Sem banco: lê só os arquivos do `snapshot/`. **Imprime nome de tabela, nome de coluna
// e bytes. Nunca valor de linha** — e nunca o campo `b` (o vetor de índices em base64,
// que são megabytes de texto).
//
// **Por que existe.** "O dash passa de 300 MB" é uma frase sobre o PROCESSO, e o processo
// é heap do V8 mais runtime mais dado. Esta sonda isola a terceira parcela: o que a API
// carrega quando alguém abre UMA página. Medido em 13/11/2026, a página mais cara tinha
// 54,3 MB e a mais leve 35,6 MB — ou seja, o dataset nunca foi o que fazia os ~653 MB
// ociosos (ACHADOS #262).
//
// **A régua.** Cada coluna é pesada como ela fica em memória no formato colunar, que é
// como a carga a mantém (`leColunar`): dicionário de valores distintos — 16 bytes de
// cabeçalho de string mais 2 por caractere, ou 8 para número/data — mais o vetor de
// índices, `linhas × w`. É aproximação de ordem de grandeza, não contabilidade de heap:
// serve para comparar colunas e páginas entre si, que é o uso.
//
// **Os três destinos de uma coluna física**, e só o segundo custa RAM:
//   - já podada na carga — nenhum DAX, visual, filtro ou relacionamento a cita, e
//     `omissiveis` a deixa fora. Ela ainda custa SELECT, rede, disco e refresh.
//   - carregada — a poda a mantém para a página que está sendo medida.
//   - (o terceiro, "carregada e sem leitor", é assunto de `calculada-sem-leitor.test.ts`,
//     que o cobra a cada `npm test`; aqui ele apareceria como carregada.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colunasUsadas } from '../../../packages/snapshot/src/colunas-usadas.ts';
import { ehArquivoDeSnapshot, leCabecalho, paraCadaLinha, semSufixo } from '../../../packages/snapshot/src/formato.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { graoReduzidoDe, leGraoReduzido } from '../../../packages/semantic-model/src/projecao.ts';
import { SemanticModel, normalizeName } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
const arg = (nome: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const DIR = path.resolve(ROOT, arg('dir') ?? 'snapshot');
const SO_A_PAGINA = arg('pagina');

const model = SemanticModel.fromSpecsDir(SPECS);
const dashboards = loadDashboards(SPECS);
const graos = leGraoReduzido(SPECS);

const mb = (n: number): string => (n / 1048576).toFixed(2).padStart(7);

/** Uma coluna do arquivo: o nome como o cabeçalho o escreve, e o que ela pesa. */
interface Peso {
  nome: string;
  bytes: number;
}
interface Arquivo {
  tabela: string;
  /** A query que gerou o arquivo — duas podem alimentar a MESMA tabela, com grãos
   *  diferentes (`field-agenda` e `field-agenda-slot`), e aí o nome da tabela sozinho
   *  não diz de qual arquivo a coluna veio. */
  query: string;
  linhas: number;
  /** nome normalizado → peso. */
  pesos: Map<string, Peso>;
}

/**
 * O que uma coluna ocupa: dicionário + vetor de índices.
 *
 * `d` são os valores DISTINTOS já codificados (número, texto ou texto de data), e `w` é
 * quantos bytes cada linha gasta para apontar para um deles.
 */
function pesoDaColuna(d: readonly unknown[], w: number, linhas: number): number {
  let dicionario = 0;
  for (const v of d) {
    if (v === null || v === undefined) continue;
    dicionario += typeof v === 'string' ? v.length * 2 + 16 : 8;
  }
  return dicionario + linhas * w;
}

/**
 * O corpo do formato 2 é uma linha por coluna, `{"c":…,"w":…,"d":[…],"b":"…"}`.
 *
 * O `b` é o vetor de índices em base64 e chega a megabytes numa linha só; ele não entra
 * na conta e não precisa ser desserializado. Cortar antes do `,"b":"` depende da ordem
 * das chaves que `corpoDoFormato2` escreve — se ela mudar, o corte falha e cai no parse
 * inteiro, que dá o mesmo número, só mais devagar.
 */
function colunaDaLinha(linha: string): { c: string; w: number; d: unknown[] } | null {
  const corte = linha.indexOf(',"b":"');
  if (corte > 0) {
    try {
      return JSON.parse(`${linha.slice(0, corte)}}`) as { c: string; w: number; d: unknown[] };
    } catch {
      // Ordem de chaves diferente da esperada: segue para o parse inteiro.
    }
  }
  const o = JSON.parse(linha) as { c?: string; w?: number; d?: unknown[] };
  if (typeof o.c !== 'string' || typeof o.w !== 'number' || !Array.isArray(o.d)) return null;
  return { c: o.c, w: o.w, d: o.d };
}

async function leArquivos(): Promise<Map<string, Arquivo>> {
  const arquivos = new Map<string, Arquivo>();
  for (const nome of fs.readdirSync(DIR).filter(ehArquivoDeSnapshot)) {
    const caminho = path.join(DIR, nome);
    const cab = leCabecalho(caminho);
    if (!cab.tabelas?.length) continue;
    const pesos = new Map<string, Peso>();
    let primeira = true;
    await paraCadaLinha(caminho, (texto) => {
      if (primeira) {
        primeira = false; // o cabeçalho, já lido por `leCabecalho`.
        return;
      }
      if (!texto) return;
      const col = colunaDaLinha(texto);
      if (!col) return;
      pesos.set(normalizeName(col.c), { nome: col.c, bytes: pesoDaColuna(col.d, col.w, cab.linhas) });
    });
    const query = semSufixo(nome);
    arquivos.set(query, { tabela: cab.tabelas[0]!, query, linhas: cab.linhas, pesos });
  }
  return arquivos;
}

/**
 * A query que a carga do snapshot realmente usa para esta tabela.
 *
 * Quem tem grão reduzido com `completa_no_snapshot: false` NUNCA é pedido na forma
 * completa pela carga do snapshot (`#soAsQueOSnapshotTem`, em `servidor.ts`) — é o caso
 * da FIELD AGENDA, que entra com 41 mil linhas de slot e não com as 632 mil do formulário.
 */
function queryDaCarga(nome: string, query: string | null): string | null {
  if (!query) return null;
  const grao = graoReduzidoDe(nome, graos);
  return grao && !grao.completaNoSnapshot ? grao.queryPadrao : query;
}

async function main(): Promise<void> {
  if (!fs.existsSync(DIR)) {
    console.error(`Não achei o snapshot em ${DIR}. Use --dir=<caminho>.`);
    process.exitCode = 1;
    return;
  }
  const arquivos = await leArquivos();
  const paginas = SO_A_PAGINA ? dashboards.filter((d) => d.id === SO_A_PAGINA) : dashboards;
  if (paginas.length === 0) {
    console.error(`Página '${SO_A_PAGINA}' não existe. Páginas: ${dashboards.map((d) => d.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const medidas: { id: string; bytes: number; porTabela: [string, number][] }[] = [];
  for (const d of paginas) {
    const usadas = colunasUsadas([d], model);
    let bytes = 0;
    const porTabela: [string, number][] = [];
    for (const t of planeja([d], model).tabelas) {
      const q = queryDaCarga(t.nome, t.query);
      const arq = q ? arquivos.get(q) : undefined;
      if (!arq) continue;
      const precisa = usadas.get(normalizeName(t.nome)) ?? new Set<string>();
      let daTabela = 0;
      for (const [col, peso] of arq.pesos) if (precisa.has(col)) daTabela += peso.bytes;
      bytes += daTabela;
      porTabela.push([t.nome, daTabela]);
    }
    porTabela.sort((a, b) => b[1] - a[1]);
    medidas.push({ id: d.id, bytes, porTabela });
  }

  medidas.sort((a, b) => b.bytes - a.bytes);
  console.log('=== MEMÓRIA DO DATASET, POR PÁGINA ===');
  for (const p of medidas) {
    if (p.bytes === 0) continue;
    console.log(`\n${p.id.padEnd(26)} ${mb(p.bytes)} MB`);
    for (const [nome, b] of p.porTabela.slice(0, 5)) {
      if (b < 100_000) continue;
      console.log(`   ${nome.padEnd(30)} ${mb(b)} MB`);
    }
  }

  // O que NENHUMA página carrega: custa SELECT, rede, disco e refresh — não custa RAM.
  // É daqui que sai a lista de candidatas a deixar o `sql:` (S6, docs/PLANO-SEGURANCA.md).
  const todas = colunasUsadas(dashboards, model);
  const foraDeTudo: { linha: string; bytes: number }[] = [];
  let somaFora = 0;
  let somaDentro = 0;
  for (const arq of arquivos.values()) {
    const precisa = todas.get(normalizeName(arq.tabela)) ?? new Set<string>();
    const col = model.table(arq.tabela);
    for (const [k, peso] of arq.pesos) {
      if (precisa.has(k)) {
        somaDentro += peso.bytes;
        continue;
      }
      // Calculada materializada no arquivo nunca é podada (`omissiveis`): ela não é
      // candidata a sair de consulta nenhuma, porque consulta nenhuma a produz.
      if (col?.columns.find((c) => normalizeName(c.name) === k)?.calculated) {
        somaDentro += peso.bytes;
        continue;
      }
      somaFora += peso.bytes;
      foraDeTudo.push({
        bytes: peso.bytes,
        linha: `${arq.query.padEnd(26)} ${peso.nome.padEnd(30)} ${mb(peso.bytes)} MB`,
      });
    }
  }

  console.log('\n=== LIDA DO BANCO E NUNCA CARREGADA (nenhuma das páginas a mantém) ===');
  console.log('  a primeira coluna é a QUERY que gerou o arquivo, não a tabela: duas queries');
  console.log('  podem alimentar a mesma tabela (`field-agenda` e `field-agenda-slot`).');
  console.log(`  total: ${mb(somaFora)} MB   (contra ${mb(somaDentro)} MB que alguma página carrega)`);
  foraDeTudo.sort((a, b) => b.bytes - a.bytes);
  for (const f of foraDeTudo.slice(0, 40)) console.log(`  ${f.linha}`);
  if (foraDeTudo.length > 40) console.log(`  … e mais ${foraDeTudo.length - 40} colunas menores`);
}

await main();
