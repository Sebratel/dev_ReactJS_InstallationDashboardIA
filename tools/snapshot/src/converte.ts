#!/usr/bin/env node
// `npm run snapshot:converte` — leva o snapshot em disco do formato 1 para o 2.
//
// O formato 2 (15/09/2026) guarda uma linha por COLUNA, já codificada por
// dicionário, em vez de uma linha por LINHA. Ver o bloco de `FORMATO_ATUAL` em
// `packages/snapshot/src/formato.ts` para o layout e para a medição que o motivou:
// montar o dicionário a cada abertura era 58,1% da carga.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ESTA FERRAMENTA CONFERE, E NÃO SÓ CONVERTE
//
// O arquivo em disco é o único lugar onde o dado existe — não há de onde
// rebuscá-lo sem 168 s de banco por query, e algumas nem isso. Uma conversão que
// troque um valor não daria erro: daria número plausível e diferente na tela, que
// é a classe de falha que este projeto recusa.
//
// Então o padrão é **conferir sem gravar**: lê o arquivo pelos dois caminhos e
// compara CÉLULA A CÉLULA. Só com `--grava` a troca acontece, e mesmo aí o
// original vai para `.formato-1/` em vez de sumir.
//
//   npm run snapshot:converte                              # confere, não toca em nada
//   npm run snapshot:converte -- --grava                   # confere e troca
//   npm run snapshot:converte -- --arquivo=contratos       # um só
//
// Sai 1 na primeira divergência, e nesse caso nada foi trocado.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. `snapshot/` tem CLIENTE, TELEFONE,
// endereço e, em QUADRO FUNCIONAL, CPF e RG. Divergência é reportada por posição e
// por nome de coluna — nunca pelos dois valores que divergiram.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  converteParaFormato2,
  ehArquivoDeSnapshot,
  le,
  leCabecalho,
  leColunar,
  SUFIXO_COMPRIMIDO,
  SUFIXO_CRU,
  type CabecalhoDeSnapshot,
  type Escalar,
} from '../../../packages/snapshot/src/formato.ts';
import type { TabelaColunar } from '../../../packages/snapshot/src/tabela-colunar.ts';
import { renomeiaComRetentativa } from '../../../packages/snapshot/src/escrita-atomica.ts';
import {
  DIRETORIO_PADRAO,
  escreveManifesto,
  leManifesto,
} from '../../../packages/snapshot/src/manifesto.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = path.join(ROOT, DIRETORIO_PADRAO);

/**
 * Onde o arquivo novo é montado antes de valer, e onde o antigo fica depois.
 *
 * Os dois começam com ponto de propósito: as três varreduras que listam o
 * diretório filtram por `ehArquivoDeSnapshot`, que olha o sufixo — um
 * `contratos.novo.jsonl.gz` solto ao lado do original seria uma SEGUNDA carga sob
 * o mesmo nome de query, vista por quem varre. Um subdiretório não é.
 */
const ENCENADO = path.join(DIR, '.convertendo');
const GUARDADOS = path.join(DIR, '.formato-1');

const args = process.argv.slice(2);
const grava = args.includes('--grava');
let sofilho: string | null = null;
for (const a of args) {
  if (a === '--grava') continue;
  if (a.startsWith('--arquivo=')) {
    sofilho = a.slice('--arquivo='.length);
    continue;
  }
  console.error(`argumento desconhecido: ${a}. Use: --grava, --arquivo=<nome>`);
  process.exit(2);
}

if (!fs.existsSync(DIR)) {
  console.error(`Não há snapshot em ${path.relative(ROOT, DIR)}. Rode: npm run snapshot -- --todas`);
  process.exit(1);
}

/**
 * Duas células são a mesma?
 *
 * Data compara por instante: o objeto é outro nos dois caminhos, e `===` entre dois
 * `Date` do mesmo instante é `false`. `NaN` compara por `Number.isNaN`, pelo mesmo
 * motivo ao contrário — `NaN !== NaN`, e uma coluna numérica com `NaN` acusaria
 * divergência em toda linha.
 */
function mesma(a: Escalar, b: Escalar): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
  }
  return a === b && typeof a === typeof b;
}

/** O cabeçalho sem o campo que a conversão muda de propósito. */
function cabecalhoSemFormato(c: CabecalhoDeSnapshot): string {
  const { formato: _formato, ...resto } = c;
  return JSON.stringify(resto);
}

interface Divergencia {
  onde: string;
  detalhe: string;
}

/**
 * Compara as duas leituras. Devolve a primeira divergência, ou `null`.
 *
 * **O gabarito é sempre o arquivo VELHO lido em colunar**, e os dois leitores do
 * arquivo novo são conferidos contra ele. Não é redundância: são dois caminhos de
 * decodificação com dois consumidores diferentes, e cobrir só um deixaria o outro
 * estreando em produção.
 *
 * - `leColunar()` é o que as páginas usam (`carrega.ts:271`);
 * - `le()` é o que a costura incremental usa para ler o snapshot anterior
 *   (`tools/snapshot/src/index.ts:651`). Um defeito ali não apareceria na tela —
 *   apareceria no próximo `--incremental`, como dado faltando e sem erro.
 *
 * O gabarito é colunar dos dois lados porque a tabela colunar é compacta: manter o
 * velho e o novo como array de objetos ao mesmo tempo não cabe em 8 GB para
 * `field-agenda`.
 */
function compara(
  antes: { cabecalho: CabecalhoDeSnapshot; tabela: TabelaColunar },
  depois: { cabecalho: CabecalhoDeSnapshot; tabela: TabelaColunar },
  porLinha: readonly Record<string, Escalar>[],
): Divergencia | null {
  if (cabecalhoSemFormato(antes.cabecalho) !== cabecalhoSemFormato(depois.cabecalho)) {
    return {
      onde: 'cabeçalho',
      detalhe:
        'a conversão mudou algo além de `formato`. Tipo, contagem de nulos, grafia da ' +
        'coluna, `geradoEm` ou `marca` — qualquer um deles muda o que a tela mostra ou ' +
        'de onde a carga incremental recomeça.',
    };
  }
  if (antes.tabela.linhas !== depois.tabela.linhas) {
    return {
      onde: 'linhas',
      detalhe: `${antes.tabela.linhas} antes, ${depois.tabela.linhas} depois.`,
    };
  }
  const na = antes.tabela.nomes;
  const nd = depois.tabela.nomes;
  if (na.length !== nd.length || na.some((n, i) => n !== nd[i])) {
    return {
      onde: 'colunas',
      detalhe:
        `${na.length} antes e ${nd.length} depois, ou em ordem diferente. A ordem é ` +
        `parte do formato: a leitura confere a coluna do corpo contra a do cabeçalho.`,
    };
  }
  if (porLinha.length !== antes.tabela.linhas) {
    return {
      onde: 'linhas, pelo leitor por linha',
      detalhe: `le() devolveu ${porLinha.length} linhas e o original tem ${antes.tabela.linhas}.`,
    };
  }
  for (const c of na) {
    for (let i = 0; i < antes.tabela.linhas; i++) {
      const gabarito = antes.tabela.valor(c, i);
      if (!mesma(gabarito, depois.tabela.valor(c, i))) {
        return {
          onde: `coluna '${c}', linha ${i}, pelo leitor colunar`,
          detalhe: 'valor diferente depois da conversão. (O valor não se imprime: é dado de cliente.)',
        };
      }
      if (!mesma(gabarito, porLinha[i]![c] ?? null)) {
        return {
          onde: `coluna '${c}', linha ${i}, pelo leitor por linha`,
          detalhe:
            'o colunar concorda e `le()` não. É o caminho da costura incremental: ' +
            'um defeito aqui some do snapshot na próxima carga, sem erro. ' +
            '(O valor não se imprime: é dado de cliente.)',
        };
      }
    }
  }
  return null;
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const arquivos = fs
  .readdirSync(DIR)
  .filter(ehArquivoDeSnapshot)
  .filter((f) => sofilho === null || f === sofilho || f.startsWith(`${sofilho}.`))
  .sort();

if (arquivos.length === 0) {
  console.error(
    sofilho === null
      ? `Nenhum .jsonl/.jsonl.gz em ${path.relative(ROOT, DIR)}.`
      : `Nenhum arquivo de snapshot casa com '${sofilho}'.`,
  );
  process.exit(1);
}

console.log(
  `${arquivos.length} arquivo(s) em ${path.relative(ROOT, DIR)}. ` +
    `${grava ? 'CONFERE E TROCA' : 'só CONFERE — use --grava para trocar'}.\n`,
);
console.log('arquivo                            linhas  col     antes    depois        ms');
console.log('─'.repeat(80));

let convertidos = 0;
let pulados = 0;
let bytesAntes = 0;
let bytesDepois = 0;

fs.mkdirSync(ENCENADO, { recursive: true });

for (const nome of arquivos) {
  const origem = path.join(DIR, nome);
  if (leCabecalho(origem).formato === 2) {
    pulados++;
    console.log(`${nome.padEnd(34)} ${'—'.padStart(8)}  ${'já no formato 2'}`);
    continue;
  }

  const alvo = path.join(ENCENADO, nome);
  const t0 = performance.now();

  // O ANTES é lido do original, pelo caminho do formato 1. É o gabarito.
  const antes = await leColunar(origem);
  await converteParaFormato2(origem, alvo);
  const depois = await leColunar(alvo);
  const porLinha = await le(alvo);

  const div = compara(antes, depois, porLinha.linhas);
  const ms = performance.now() - t0;

  const tamAntes = fs.statSync(origem).size;
  const tamDepois = fs.statSync(alvo).size;

  if (div !== null) {
    console.log(`${nome.padEnd(34)} DIVERGIU`);
    console.log('─'.repeat(80));
    console.error(`\n[DIVERGÊNCIA] ${nome} — ${div.onde}`);
    console.error(`              ${div.detalhe}`);
    console.error(
      `\nNada foi trocado. O arquivo convertido ficou em ` +
        `${path.relative(ROOT, alvo)} para diagnóstico.`,
    );
    process.exit(1);
  }

  bytesAntes += tamAntes;
  bytesDepois += tamDepois;
  convertidos++;

  console.log(
    `${nome.padEnd(34)} ${antes.cabecalho.linhas.toLocaleString('pt-BR').padStart(9)} ` +
      `${String(antes.tabela.nomes.length).padStart(4)} ` +
      `${mb(tamAntes).padStart(9)} ${mb(tamDepois).padStart(9)} ${ms.toFixed(0).padStart(9)}`,
  );

  if (grava) {
    // O original é guardado, e a pergunta seguinte é por quanto tempo.
    //
    // **Não é "até alguém conferir a tela".** Foi o que esta ferramenta dizia, e a
    // condição não tinha como ser satisfeita: a conversão é conferida célula a
    // célula pelos dois leitores, então voltar ao original restaura exatamente os
    // mesmos números. Se a tela estiver errada, ela estava errada antes — o
    // rollback não conserta nada que a conferência possa encontrar.
    //
    // O que ele protege de verdade é a janela entre gravar e conferir: um destino
    // meio escrito, um disco cheio, um `--grava` interrompido. Passada a
    // conferência, a cópia deixa de ser rede e vira **passivo** — 52 MB de CLIENTE,
    // TELEFONE, endereço e CPF numa pasta oculta que nenhuma ferramenta varre e que
    // ninguém lembra que existe.
    //
    // `renomeiaComRetentativa` e nao `fs.renameSync`: no Windows o antivirus e o
    // indexador seguram o arquivo por instantes depois de ele ser fechado, e um
    // EPERM aqui deixaria o diretorio com o original ja movido e nada no lugar.
    fs.mkdirSync(GUARDADOS, { recursive: true });
    await renomeiaComRetentativa(origem, path.join(GUARDADOS, nome));
    await renomeiaComRetentativa(alvo, origem);
  }
}

// ── o manifesto descreve os arquivos, e eles acabaram de mudar de tamanho ────
//
// **Isto foi esquecido na primeira versão e a tela mostrou o número errado**: o
// `/api/saude` soma `bytes` do manifesto, e depois da conversão ele anunciava 53,6
// MB de um snapshot que tinha 39,4 MB — as 23 entradas divergindo, cada uma com um
// número plausível. Trocar um arquivo sem atualizar quem o descreve é a mesma
// classe de defeito que este projeto persegue em todo lugar; só que desta vez fui eu.
//
// `linhas`, `colunas` e `geradoEm` NÃO se tocam: a conversão muda a representação,
// não o dado nem a data dele. Só `bytes`.
// Reconcilia TODAS as entradas, e não só as que ESTA execução converteu: o tamanho
// em disco é função pura do arquivo, e uma versão anterior desta ferramenta já
// deixou o manifesto para trás uma vez — sem isto, o conserto não alcançaria o
// estrago que ele mesmo causou.
if (grava) {
  const m = leManifesto(DIR);
  if (m === null) {
    console.log(`\nNão há manifesto em ${path.relative(ROOT, DIR)} — nada a atualizar.`);
  } else {
    const atualizadas = m.tabelas.map((t) => {
      const arq = path.join(DIR, `${t.query}${SUFIXO_COMPRIMIDO}`);
      const cru = path.join(DIR, `${t.query}${SUFIXO_CRU}`);
      const onde = fs.existsSync(arq) ? arq : cru;
      // Entrada sem arquivo fica como está: sumir com o número seria afirmar zero,
      // e o que se sabe é que não dá para saber.
      return fs.existsSync(onde) ? { ...t, bytes: fs.statSync(onde).size } : t;
    });
    const mudaram = atualizadas.filter((t, i) => t.bytes !== m.tabelas[i]!.bytes).length;
    if (mudaram === 0) {
      console.log(`\nmanifesto.json: já confere com o disco.`);
    } else {
      const antes = m.tabelas.reduce((a, t) => a + t.bytes, 0);
      const depois = atualizadas.reduce((a, t) => a + t.bytes, 0);
      await escreveManifesto(DIR, atualizadas);
      console.log(
        `\nmanifesto.json: ${mudaram} entrada(s) atualizadas, ` +
          `${mb(antes)} → ${mb(depois)}.`,
      );
    }
  }
}

console.log('─'.repeat(80));
if (convertidos > 0) {
  const delta = ((bytesDepois - bytesAntes) / bytesAntes) * 100;
  console.log(
    `${convertidos} conferido(s) célula a célula, sem divergência. ` +
      `${mb(bytesAntes)} → ${mb(bytesDepois)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%).`,
  );
}
if (pulados > 0) console.log(`${pulados} já estava(m) no formato 2.`);

if (grava) {
  if (convertidos > 0) {
    console.log(
      `\nTrocados. Os originais ficaram em ${path.relative(ROOT, GUARDADOS)}. ` +
        `Eles são dado de cliente: apague a pasta assim que esta saída estiver ` +
        `conferida — guardá-la não protege dos números, que são os mesmos nos dois ` +
        `formatos, e uma cópia esquecida de dado pessoal é risco.`,
    );
  }
  fs.rmSync(ENCENADO, { recursive: true, force: true });
} else if (convertidos > 0) {
  console.log(`\nNada foi trocado. Para trocar: npm run snapshot:converte -- --grava`);
  fs.rmSync(ENCENADO, { recursive: true, force: true });
}
