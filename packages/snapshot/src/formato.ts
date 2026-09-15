// O formato do snapshot em disco: uma tabela materializada por arquivo.
//
// **Por que existe um formato, e não `JSON.stringify` da tabela.** JSON não tem
// data. `JSON.stringify(new Date())` devolve uma string, e `JSON.parse` devolve
// essa string de volta — a coluna que era data vira texto e todo `YEAR()` do
// relatório passa a errar alto. Um formato que não sabe dizer "isto é data" não
// serve para guardar a camada M.
//
// **A forma.** Linha 1 é sempre o cabeçalho: nome da tabela, query de origem,
// contagem, **o tipo de cada coluna** e o número do formato. O corpo depende do
// formato, e há dois — **os dois se leem, só o 2 se escreve**:
//
// - **formato 1**, uma linha JSON por LINHA da tabela, cada uma um array na ordem
//   das colunas. Foi o original e ainda carrega sem conversão;
// - **formato 2** (15/09/2026), uma linha JSON por COLUNA, **já codificada por
//   dicionário**. É o que se grava. O layout, a largura variável do id e a medição
//   que motivou a troca estão no bloco de `FORMATO_ATUAL`, mais abaixo.
//
// O que não mudou entre os dois, e é metade da razão de existir um formato:
//
// - o nome da coluna não se repete por linha. Em `field-agenda`, com 1,4 milhão
//   de linhas, repetir 30 nomes por linha seria o grosso do arquivo;
// - o tipo mora no cabeçalho, então a leitura decodifica sem adivinhar. Ler
//   `"2026-01-05"` e decidir na hora se é data ou texto é exatamente a
//   adivinhação que este arquivo existe para evitar.
//
// ⚠ **Cuidado com a palavra "colunar".** O formato 1 já organizava a LINHA por
// posição de coluna, e comentários antigos o chamam de colunar por isso. Ele não é:
// a unidade dele é a linha. Quem é colunar de verdade é o formato 2 — e
// `TabelaColunar`, que é a estrutura em memória, independente do formato em disco.
//
// **Converter é `npm run snapshot:converte`** — ele confere célula a célula pelos
// dois leitores antes de trocar, e atualiza `manifesto.json`, que descreve os
// arquivos. A primeira versão não atualizava, e a tela de saúde passou a anunciar
// 53,6 MB de um snapshot com 37,6 MB (ACHADOS #107, adendo).
//
// **Coluna de tipo misto.** Nenhuma regra diz que a camada M devolve coluna
// homogênea, então o tipo é apurado varrendo a coluna inteira. Se houver mais de
// um tipo, a coluna é `misto` e cada valor vai etiquetado — mais gordo, mas sem
// perda. Erguer erro aqui seria recusar dado que o Power BI aceita.
//
// **O arquivo é dado de cliente.** `field-agenda` tem endereço, `QUADRO FUNCIONAL`
// tem CPF e RG. O diretório do snapshot está no `.gitignore` e nada neste arquivo
// imprime valor de linha.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
// Importado, não reescrito: `normalizeName` é uma linha, e duas cópias de uma
// linha é exatamente o tipo de coisa que diverge sem ninguém notar. O que o
// `Dataset` considera "normalizado" tem de ser o que esta leitura produz.
import { normalizeName } from '../../semantic-model/src/model.ts';
import { renomeiaComRetentativa } from './escrita-atomica.ts';
import {
  ConstrutorDeTabela,
  TabelaColunar,
  type ColunaColunar,
} from './tabela-colunar.ts';

// ── compressão: os dois sufixos do mesmo formato ─────────────────────────────
//
// **Por que comprimir.** O arquivo é JSONL colunar de valor repetido — nome de
// cidade, título de status, nome de equipe — e o gzip o come vivo. Medido em
// 04/09/2026 sobre `field-agenda.jsonl`, 448,2 MB:
//
// | nível | tamanho | menor | gravar | ler |
// |---|---|---|---|---|
// | 1 | 26,8 MB | 94,0% | 0,9 s | 0,7 s |
// | **6 (padrão)** | **14,6 MB** | **96,7%** | **1,7 s** | **0,7 s** |
// | sem gzip | 448,2 MB | — | — | 0,4 s |
//
// Nível 6 pelo dobro do tempo de gravação e metade do tamanho do nível 1; a
// leitura custa os mesmos 0,3 s a mais nos dois. Não há nível a escolher aqui: o
// padrão do zlib é o que o número acima mede.
//
// **Por que o sufixo, e não um campo no cabeçalho.** O cabeçalho está DENTRO do
// arquivo: para lê-lo já é preciso saber se descomprimir. E há três varreduras que
// listam o diretório sem abrir arquivo nenhum (`confere`, `bench` e o carimbo do
// cache de resposta) — elas precisam reconhecer o arquivo pelo nome.

/** Sufixo do arquivo comprimido e do cru, na ordem de preferência da leitura. */
export const SUFIXO_COMPRIMIDO = '.jsonl.gz';
export const SUFIXO_CRU = '.jsonl';

/** Se o nome é de um arquivo de snapshot — os dois sufixos, e só eles. */
export function ehArquivoDeSnapshot(nome: string): boolean {
  return nome.endsWith(SUFIXO_COMPRIMIDO) || nome.endsWith(SUFIXO_CRU);
}

/** O nome sem sufixo — o id da query, ou `calc.<slug>` de tabela calculada. */
export function semSufixo(nome: string): string {
  return nome.endsWith(SUFIXO_COMPRIMIDO)
    ? nome.slice(0, -SUFIXO_COMPRIMIDO.length)
    : nome.endsWith(SUFIXO_CRU)
      ? nome.slice(0, -SUFIXO_CRU.length)
      : nome;
}

/** O caminho do gêmeo de outro sufixo, ou `null` se o nome não é de snapshot. */
function gemeoDe(arquivo: string): string | null {
  if (arquivo.endsWith(SUFIXO_COMPRIMIDO)) {
    return arquivo.slice(0, -SUFIXO_COMPRIMIDO.length) + SUFIXO_CRU;
  }
  if (arquivo.endsWith(SUFIXO_CRU)) return arquivo + '.gz';
  return null;
}

/**
 * Qual dos dois gêmeos ler, dado o caminho do CRU. O comprimido tem precedência.
 *
 * **Erra alto quando os dois existem.** `escreve` apaga o gêmeo depois de gravar, e
 * por isso esse estado não nasce de operação normal — nasce de cópia à mão ou de um
 * `escreve` interrompido entre o rename e a limpeza. E ele é caro justamente porque
 * não dá erro sozinho: a leitura pegaria o `.gz` e as varreduras por nome poderiam
 * pegar o outro, que é de outra carga. Dois números, nenhum sintoma.
 *
 * Sem nenhum dos dois, devolve o caminho do CRU — é o que permite a quem chama
 * testar `fs.existsSync` no resultado, como sempre fez.
 */
export function escolheGemeo(caminhoCru: string): string {
  const comprimido = caminhoCru + '.gz';
  const temGz = fs.existsSync(comprimido);
  const temCru = fs.existsSync(caminhoCru);
  if (temGz && temCru) {
    throw new Error(
      `${path.basename(comprimido)} e ${path.basename(caminhoCru)} existem os dois em ` +
        `${path.dirname(caminhoCru)}. A leitura usaria o comprimido e as varreduras por nome ` +
        `poderiam usar o outro — dois números, nenhum erro. Apague o que não for da carga atual.`,
    );
  }
  return temGz ? comprimido : caminhoCru;
}

/** Os dois bytes que abrem todo membro gzip (RFC 1952 §2.3.1). */
function comprimidoEmDisco(arquivo: string): boolean {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const buf = Buffer.alloc(2);
    const lidos = fs.readSync(fd, buf, 0, 2, 0);
    return lidos === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * O arquivo como fluxo de texto, descomprimido quando for o caso.
 *
 * **Decide pelos BYTES, não pelo sufixo.** `escreve` mantém os dois de acordo, mas um
 * arquivo renomeado à mão passaria a ser lido com o decodificador errado, e o sintoma
 * apareceria em `JSON.parse` — três camadas abaixo de onde está a causa.
 *
 * O `on('error')` no meio não é zelo: `pipe` **não** propaga erro da origem para o
 * destino. Sem ele, um disco que falha no meio da leitura deixaria o `gunzip` sem
 * dado e sem erro, e o `for await` de `le()` terminaria como se o arquivo tivesse
 * acabado — arquivo truncado servido como completo. Quem pega isso hoje é a
 * conferência de contagem no fim de `le()`; este repasse a torna redundante em vez
 * de única.
 *
 * **Exportada de propósito.** `tools/bench/src/carga.ts` replica o laço de `le()` de
 * propósito, degrau por degrau, e o programa reclama quando a réplica divergir — mas
 * ele só compara TEMPO, e uma divergência na abertura do arquivo não aparece como
 * degrau fora de ordem: aparece como `JSON.parse` engasgando com byte de gzip. Foi
 * exatamente o que aconteceu quando a compressão entrou, em 04/09/2026. A réplica
 * chama esta função para essa divergência não ter como voltar.
 */
export function fluxoDeLeitura(arquivo: string): Readable {
  if (!comprimidoEmDisco(arquivo)) return fs.createReadStream(arquivo, { encoding: 'utf8' });
  const fonte = fs.createReadStream(arquivo);
  const gunzip = zlib.createGunzip();
  fonte.on('error', (e) => gunzip.destroy(e));
  return fonte.pipe(gunzip);
}

/**
 * Cada linha do arquivo, entregue a `aoReceber`. É o substituto de `readline`.
 *
 * **Por que não `readline`.** Medido em 14/09/2026 sobre `field-agenda.jsonl.gz`,
 * 647.910 linhas, 4 rodadas com a ordem alternada a cada uma (para viés de
 * aquecimento se cancelar) — e a versão à mão ganhou em TODAS as rodadas:
 *
 * ```
 * readline .. 1558  1803  1915  1856    melhor 1558 ms
 * à mão ..... 1119  1357  1420  1402    melhor 1119 ms     28,2% menos
 * ```
 *
 * O custo do `readline` aqui não é partir a linha: é `for await` **por linha**. São
 * 647 mil suspensões de iterador assíncrono num arquivo, e 1,4 milhão no maior. Por
 * isso este entregador é de CALLBACK e não um gerador assíncrono: um `yield` por
 * linha traria exatamente o custo que ele existe para tirar. O laço de linhas roda
 * **síncrono** dentro do pedaço; só a chegada do pedaço é assíncrona.
 *
 * **Uma diferença de comportamento, e ela conserta um defeito.** `readline` também
 * quebra linha em `\r` solto, `\u2028` e `\u2029`; este entrega só em `\n`
 * (tirando o `\r` do CRLF). Para `\n` e `\r` dá no mesmo — `JSON.stringify` os
 * escapa dentro de texto, então não chegam crus ao arquivo. Mas **`\u2028` e
 * `\u2029` ele NÃO escapa**: um valor de cliente que os contenha ia cru para o
 * disco, o `readline` partia a linha no meio e a leitura morria com "arquivo
 * truncado" — apontando para o lugar errado. Aqui esse dado passa inteiro.
 *
 * O `setEncoding` é obrigatório e não é enfeite: sem ele o pedaço é `Buffer` e um
 * caractere UTF-8 partido na borda viraria dois caracteres inválidos. Com ele, quem
 * cuida da borda é o `StringDecoder` do próprio fluxo.
 */
export async function paraCadaLinha(
  arquivo: string,
  aoReceber: (texto: string) => void,
): Promise<void> {
  // **Os pedaços da linha corrente ficam numa lista, e a busca só olha o pedaço
  // que acabou de chegar.** A versão anterior fazia `resto + pedaco` e procurava
  // o `\n` no ACUMULADO: com linha curta isso não custa nada, mas o `+` do V8
  // produz uma cons-string e o `indexOf` a achata, então cada pedaço novo
  // recopiava a linha inteira — O(n²) no comprimento da linha.
  //
  // Ninguém notou enquanto o arquivo era uma linha por LINHA da tabela. O formato
  // 2 (15/09/2026) é uma linha por COLUNA, e a de `field-agenda` tem megabytes:
  // medido, `paraCadaLinha` passou a ser **90,4% da carga inteira** — 15.898 ms
  // de 17.578 ms. Achatar por pedaço é O(n) e devolve exatamente o mesmo texto.
  let partes: string[] = [];
  for await (const pedaco of fluxoDeLeitura(arquivo).setEncoding('utf8')) {
    const s = pedaco as string;
    let ini = 0;
    let i = s.indexOf('\n');
    while (i >= 0) {
      partes.push(s.slice(ini, i));
      // CRLF: o `\r` fica FORA da linha. O `\r` que cai no fim de um pedaço e o
      // `\n` que abre o seguinte se reencontram porque o `\r` viaja em `partes` —
      // é por isso que ele sai DEPOIS de juntar, e não no fatiamento.
      aoReceber(semCarriage(partes));
      partes = [];
      ini = i + 1;
      i = s.indexOf('\n', ini);
    }
    if (ini < s.length) partes.push(s.slice(ini));
  }
  // Última linha sem `\n` no fim. `escreve` sempre termina com `\n`, então o
  // normal é não sobrar nada aqui — mas arquivo editado à mão não tem essa
  // obrigação.
  if (partes.length > 0) {
    const linha = semCarriage(partes);
    if (linha.length > 0) aoReceber(linha);
  }
}

/** Junta os pedaços de uma linha e tira o `\r` do fim, se houver. */
function semCarriage(partes: readonly string[]): string {
  const linha = partes.length === 1 ? partes[0]! : partes.join('');
  return linha.charCodeAt(linha.length - 1) === 13 ? linha.slice(0, -1) : linha;
}

/**
 * A primeira linha de um arquivo comprimido, sem inflar o resto.
 *
 * `Z_SYNC_FLUSH` no fim é o que faz isto ser possível: sem ele, inflar um PEDAÇO de
 * um gzip é "unexpected end of file" — o rodapé de CRC não chegou. Com ele, o zlib
 * devolve o que já conseguiu inflar. A janela dobra até achar o `\n` porque o
 * cabeçalho de `field-agenda` tem ~30 colunas e nada garante um teto; ela para no
 * tamanho do arquivo, então o pior caso é ler o arquivo inteiro uma vez — que é o
 * que a versão ingênua fazia SEMPRE.
 */
function primeiraLinhaComprimida(arquivo: string): string {
  const total = fs.statSync(arquivo).size;
  const fd = fs.openSync(arquivo, 'r');
  try {
    for (let janela = 128 * 1024; ; janela *= 8) {
      const quanto = Math.min(janela, total);
      const buf = Buffer.alloc(quanto);
      const lidos = fs.readSync(fd, buf, 0, quanto, 0);
      let texto: string;
      try {
        texto = zlib
          .gunzipSync(buf.subarray(0, lidos), { finishFlush: zlib.constants.Z_SYNC_FLUSH })
          .toString('utf8');
      } catch (e) {
        // Janela curta demais para o zlib emitir qualquer coisa: cresce. No arquivo
        // inteiro, o erro é do arquivo e sobe.
        if (quanto >= total) throw e;
        continue;
      }
      // Só devolve depois de achar o `\n`: um corte no meio de um caractere UTF-8
      // fica DEPOIS dele, e o pedaço que interessa sai inteiro.
      const fim = texto.indexOf('\n');
      if (fim >= 0) return texto.slice(0, fim);
      if (quanto >= total) {
        throw new Error(`${arquivo}: cabeçalho não termina na primeira linha.`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Quantos bytes o arquivo tem DESCOMPRIMIDO — a grandeza que prediz heap.
 *
 * **Por que isto existe.** Depois da compressão, o tamanho em disco parou de dizer
 * quanta memória a leitura vai pedir: `field-agenda` são 14,6 MB de arquivo e as
 * mesmas 1,46 milhão de linhas de sempre. Quem usa o tamanho como proxy de custo —
 * hoje o teto de `npm run bench:carga`, que existe para não fazer a máquina de 16 GB
 * do usuário parar sem ele pedir — passaria a deixar entrar justamente o arquivo de
 * que se protegia, e o sintoma seria a máquina travando, não um erro.
 *
 * Sai do campo ISIZE do rodapé do gzip (RFC 1952 §2.3.1), que são 4 bytes no fim do
 * arquivo. **É o tamanho módulo 2^32**: acima de 4 GB descomprimidos ele mente, e
 * mente para BAIXO. Nenhuma tabela daqui chega perto (a maior descomprime 448 MB), e
 * o dia em que chegar o teto erra para o lado de medir mais degraus — não para o de
 * carregar um arquivo que não cabe.
 */
export function bytesDescomprimidos(arquivo: string): number {
  const emDisco = fs.statSync(arquivo).size;
  if (!comprimidoEmDisco(arquivo)) return emDisco;
  const fd = fs.openSync(arquivo, 'r');
  try {
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, Math.max(0, emDisco - 4));
    return buf.readUInt32LE(0);
  } finally {
    fs.closeSync(fd);
  }
}

/** Escalar que a camada M entrega (`toDatasetRows`) e o `Dataset` aceita. */
export type Escalar = number | string | boolean | Date | null;

/** O tipo apurado de uma coluna. `vazia` = só nulos; `misto` = mais de um. */
export type TipoDeColuna = 'string' | 'number' | 'boolean' | 'date' | 'vazia' | 'misto';

export interface ColunaDeSnapshot {
  nome: string;
  tipo: TipoDeColuna;
  /** Quantos nulos — a contagem que diz se a coluna está de fato preenchida. */
  nulos: number;
  /**
   * `sha256` do DAX que produziu esta coluna. Presente **só** em coluna calculada
   * materializada (ACHADOS #47).
   *
   * É o que torna a obsolescência **detectável**. Uma coluna calculada gravada em
   * disco é um valor congelado; se alguém mudar o DAX dela no Power BI e rodar
   * `npm run extract`, o arquivo continua com o número velho e **nada denuncia** —
   * o avaliador acha a coluna na linha e a usa sem perguntar. Guardar o hash faz o
   * carregamento comparar e **errar alto**, em vez de servir número desatualizado
   * com cara de atual.
   */
  daxSha?: string;
}

/**
 * `sha256` de uma expressão DAX, normalizada em espaço em branco.
 *
 * Normaliza porque reindentar o DAX no Power BI não muda o que ele calcula, e
 * invalidar 950 MB de snapshot por causa de um espaço seria um alarme que ensina
 * a ignorar alarmes.
 */
export function shaDeDax(dax: string): string {
  return createHash('sha256').update(dax.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

export interface CabecalhoDeSnapshot {
  /**
   * Versão do formato. Muda quando a decodificação muda, e a leitura confere.
   *
   * - **1** — uma linha JSON por LINHA da tabela. O formato original.
   * - **2** — uma linha JSON por COLUNA, já codificada por dicionário. Ver
   *   `escreve` e `leColunas`.
   *
   * Os dois se leem; só o 2 se escreve. Um arquivo antigo continua carregando sem
   * conversão nenhuma — é o que torna a troca reversível: basta voltar o
   * `FORMATO_ATUAL` e materializar de novo.
   */
  formato: 1 | 2;
  /** Id da query da camada M que produziu o arquivo — e o nome dele. */
  query: string;
  /**
   * Tabelas do modelo que carregam deste arquivo. É lista porque `query_ref` é
   * do lado da tabela: nada no catálogo impede duas tabelas de apontarem para a
   * mesma query. Hoje nenhuma faz isso — a lista tem um item em todas as 16.
   */
  tabelas: string[];
  linhas: number;
  colunas: ColunaDeSnapshot[];
  /** ISO UTC. É a "data do dado" que a tela precisa mostrar. */
  geradoEm: string;
  /**
   * `sha256` da definição inteira de uma **tabela calculada** — o DAX das linhas mais
   * o de cada coluna calculada. Ausente em arquivo de query.
   *
   * Presente, ele torna o arquivo verificável: se o DAX mudou desde a materialização,
   * as linhas em disco são as do DAX antigo e o carregamento **erra alto** em vez de
   * servi-las. É o guarda do ACHADOS #47 um nível acima — lá era por coluna, aqui é a
   * tabela toda, porque mudar o corpo dela muda **quais linhas existem**.
   */
  tabelaSha?: string;
  /**
   * Marca d'água: o maior valor entre as colunas de `marca` da política incremental
   * (`specs/_catalog/incremental.yaml`), como ISO UTC. Ausente em query sem política.
   * É o que `decideIncremental` (ver `incremental.ts`) lê do arquivo anterior para
   * decidir de onde uma próxima carga incremental recomeça.
   */
  marca?: string;
  /** Como este arquivo foi produzido. Ausente em query sem política — não há o que dizer. */
  modo?: 'completo' | 'incremental';
  /**
   * ISO UTC da última carga COMPLETA. Numa carga incremental, herda o valor do
   * arquivo anterior — só uma completa nova o avança. É o relógio que
   * `decideIncremental` mede contra `idade_maxima_dias`: uma corrente de
   * incrementais mantém `geradoEm` sempre novo e ficaria cega para isso sem este
   * campo separado.
   */
  completoEm?: string;
}

/** Etiquetas de valor em coluna `misto`. Uma letra para não engordar o arquivo. */
const ETIQUETA = { string: 's', number: 'n', boolean: 'b', date: 'd' } as const;

function tipoDoValor(v: Escalar): Exclude<TipoDeColuna, 'vazia' | 'misto'> | null {
  if (v === null) return null;
  if (v instanceof Date) return 'date';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  throw new TypeError(
    `snapshot: valor de tipo '${t}' não é escalar. A camada M só entrega ` +
      `número, texto, booleano, data ou nulo — ver toDatasetRows.`,
  );
}

/**
 * Apura o tipo de cada coluna varrendo todas as linhas.
 *
 * Varre inteiro de propósito. Olhar só o primeiro não-nulo é barato e erra na
 * coluna que começa com data e termina com texto: a leitura decodificaria o texto
 * como data e devolveria `Invalid Date`, calada.
 */
export function apuraColunas(
  colunas: readonly string[],
  linhas: readonly Record<string, Escalar>[],
): ColunaDeSnapshot[] {
  return colunas.map((nome) => {
    let tipo: TipoDeColuna | null = null;
    let nulos = 0;
    for (let i = 0; i < linhas.length; i++) {
      const t = tipoDoValor(linhas[i]![nome] ?? null);
      if (t === null) nulos++;
      else if (tipo === null) tipo = t;
      else if (tipo !== t) tipo = 'misto';
    }
    return { nome, tipo: tipo ?? 'vazia', nulos };
  });
}

function codifica(v: Escalar, tipo: TipoDeColuna): unknown {
  if (v === null) return null;
  if (tipo === 'misto') {
    const t = tipoDoValor(v)!;
    return [ETIQUETA[t], t === 'date' ? (v as Date).toISOString() : v];
  }
  return v instanceof Date ? v.toISOString() : v;
}

export function decodifica(v: unknown, tipo: TipoDeColuna, onde: string): Escalar {
  if (v === null || v === undefined) return null;
  if (tipo === 'misto') {
    if (!Array.isArray(v) || v.length !== 2) {
      throw new Error(`${onde}: coluna mista esperava [etiqueta, valor] e veio ${typeof v}.`);
    }
    const [tag, bruto] = v as [string, unknown];
    return tag === 'd' ? new Date(bruto as string) : (bruto as Escalar);
  }
  if (tipo === 'date') {
    const d = new Date(v as string);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`${onde}: coluna declarada 'date' tem valor que não é data.`);
    }
    return d;
  }
  return v as Escalar;
}

/**
 * Grava a tabela. Streaming porque `field-agenda` tem 1,4 milhão de linhas:
 * montar o arquivo inteiro numa string antes de escrever dobra o pico de memória
 * justo na query que já é a mais pesada da base.
 *
 * **Atômica por dentro** (DEPLOY.md §4.2, ACHADOS #79): escreve em `${arquivo}.parcial`
 * e só depois renomeia por cima do destino. Sem isto, `leCabecalho`/`le` que abrem
 * `arquivo` durante a escrita viam o arquivo truncado no instante do `open` (flag
 * `'w'` zera antes de escrever a primeira linha) — não uma janela de linha rasgada,
 * o arquivo inteiro ausente pelo tempo todo da escrita. Toda chamada passa a ganhar
 * isto de graça, inclusive as de `calculadas.ts` (`congelaIsolada` e o modo filho
 * `--parcial=`), sem precisar de um segundo helper que alguém teria de lembrar de
 * chamar — foi exatamente esquecer um passo separado que já quebrou este fluxo duas
 * vezes (ACHADOS #53, #78).
 */
/**
 * O formato que se ESCREVE. Ler continua aceitando o 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE O ARQUIVO DEIXOU DE SER UMA LINHA POR LINHA
 *
 * **Medido, não suposto** (`npm run bench:carga -- --colunar`, 14/09/2026, os 22
 * arquivos abaixo de 100 MB — 36,6 MB, 788.225 linhas, 4.517 ms):
 *
 * ```
 * dicion   58,1%   montar o dicionário — um Map.get por CÉLULA
 * io       15,2%   ler os bytes e decodificar utf-8
 * decodif  14,3%   decodificar cada célula
 * parse     7,0%   JSON.parse
 * linhas    3,6%   partir em linhas
 * resto     1,8%   tipo declarado, vista, adoção
 * ```
 *
 * A API carrega em armazenamento colunar desde 13/09, e reconstruía o dicionário
 * **a cada abertura** a partir de um arquivo orientado a linha. Gravá-lo já
 * codificado troca as quatro primeiras etapas por uma cópia de bytes.
 *
 * ⚠ **O `JSON.parse` nunca foi o problema**, e o plano antigo rejeitou trocar o
 * formato exatamente por isso — ele é 7%. O caro é montar a estrutura. Ver
 * `docs/DECISAO-DESEMPENHO.md`, seção "O passo 5, medido".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O LAYOUT
 *
 * Linha 1: o cabeçalho, igual ao do formato 1, com `formato: 2`.
 * Linhas 2..K+1: uma por COLUNA, **na ordem de `cabecalho.colunas`**:
 *
 * ```json
 * {"c":"NOME","w":1,"d":[null,"a","b"],"b":"AAEC..."}
 * ```
 *
 * - `c` o nome, repetido para a leitura poder CONFERIR a ordem em vez de confiar
 *   nela — cabeçalho e corpo em arquivos que viajam juntos já saíram de sincronia
 *   neste projeto;
 * - `d` os valores distintos, codificados como uma célula do formato 1 era
 *   (`codifica`), então data e coluna mista atravessam pelo mesmo caminho. A
 *   posição 0 é **sempre** `null`, que é a invariante `ID_NULO` de `TabelaColunar`;
 * - `w` a largura do id em bytes, 1, 2 ou 4 — a menor que couber em `d.length`;
 * - `b` os ids, base64, little-endian.
 *
 * **A largura é onde a conta fecha.** Id de 4 bytes para uma coluna de 17 valores
 * distintos é desperdício de 4x, e o dado real é assim: `item` de
 * `protocolos-produtividade` tem 1 valor distinto em 76.398 linhas, `gestor` tem 4,
 * `cidade` 17. Base64 infla 4/3, então sem a largura variável o arquivo cresceria.
 */
export const FORMATO_ATUAL = 2;

/** A menor largura de id que representa `distintos` valores. */
function larguraDeId(distintos: number): 1 | 2 | 4 {
  if (distintos <= 0x100) return 1;
  if (distintos <= 0x10000) return 2;
  return 4;
}

/**
 * Os ids em base64, little-endian.
 *
 * **LE explícito, e não a ordem da máquina.** Um `Buffer` sobre o `.buffer` de um
 * `Int32Array` sai na ordem do processador, e o arquivo viaja: gravado num x86 e
 * lido num ARM big-endian, cada id viraria outro id — valor errado, sem erro. As
 * três larguras escrevem e leem LE, e a de 1 byte não tem ordem.
 */
function idsParaBase64(ids: Int32Array, largura: 1 | 2 | 4): string {
  const buf = Buffer.allocUnsafe(ids.length * largura);
  if (largura === 1) {
    for (let i = 0; i < ids.length; i++) buf[i] = ids[i]!;
  } else if (largura === 2) {
    for (let i = 0; i < ids.length; i++) buf.writeUInt16LE(ids[i]!, i * 2);
  } else {
    for (let i = 0; i < ids.length; i++) buf.writeInt32LE(ids[i]!, i * 4);
  }
  return buf.toString('base64');
}

/** O caminho inverso, para `linhas` ids. Confere o tamanho antes de confiar nele. */
function base64ParaIds(b64: string, largura: number, linhas: number, onde: string): Int32Array {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== linhas * largura) {
    throw new Error(
      `${onde}: os ids têm ${buf.length} bytes para ${linhas} linhas de ${largura} ` +
        `byte(s) — esperado ${linhas * largura}. Arquivo truncado ou corrompido.`,
    );
  }
  const ids = new Int32Array(linhas);
  if (largura === 1) {
    for (let i = 0; i < linhas; i++) ids[i] = buf[i]!;
  } else if (largura === 2) {
    for (let i = 0; i < linhas; i++) ids[i] = buf.readUInt16LE(i * 2);
  } else if (largura === 4) {
    for (let i = 0; i < linhas; i++) ids[i] = buf.readInt32LE(i * 4);
  } else {
    throw new Error(`${onde}: largura de id ${largura} desconhecida (esperado 1, 2 ou 4).`);
  }
  return ids;
}

/** Uma coluna como ela sai do arquivo do formato 2. */
interface ColunaEmDisco {
  c: string;
  w: number;
  d: unknown[];
  b: string;
}

/**
 * O corpo do formato 2: uma linha por coluna, **na ordem do cabeçalho**.
 *
 * Está separado porque tem dois escritores — `escreve`, que materializa do banco,
 * e `converteParaFormato2`, que migra um arquivo que já existe. Duas cópias deste
 * laço seria a falha de sempre neste projeto: divergir não daria erro, daria valor
 * trocado em um dos caminhos.
 *
 * `chave` existe porque os dois chegam aqui com a tabela nomeada de jeitos
 * diferentes: `escreve` constrói a dele com o nome ORIGINAL da coluna e
 * `leColunar` devolve a dele com o nome NORMALIZADO. O que vai para o disco é
 * sempre `c.nome`, o original — é o cabeçalho que manda, não a tabela.
 */
function* corpoDoFormato2(
  colunas: readonly ColunaDeSnapshot[],
  tabela: TabelaColunar,
  chave: (c: ColunaDeSnapshot) => string,
): Generator<string> {
  for (const c of colunas) {
    const col = tabela.coluna(chave(c));
    const largura = larguraDeId(col.valores.length);
    const emDisco: ColunaEmDisco = {
      c: c.nome,
      w: largura,
      d: col.valores.map((v) => codifica(v, c.tipo)),
      b: idsParaBase64(col.ids, largura),
    };
    yield JSON.stringify(emDisco) + '\n';
  }
}

export async function escreve(
  arquivo: string,
  cab: Omit<CabecalhoDeSnapshot, 'formato' | 'linhas' | 'colunas'>,
  colunas: readonly string[],
  linhas: readonly Record<string, Escalar>[],
  /** `sha256` do DAX, por coluna calculada materializada. Ver `ColunaDeSnapshot`. */
  daxSha?: ReadonlyMap<string, string>,
): Promise<CabecalhoDeSnapshot> {
  const apuradas = apuraColunas(colunas, linhas).map((c) => {
    const sha = daxSha?.get(c.nome);
    return sha === undefined ? c : { ...c, daxSha: sha };
  });
  const cabecalho: CabecalhoDeSnapshot = {
    formato: FORMATO_ATUAL,
    ...cab,
    linhas: linhas.length,
    colunas: apuradas,
  };

  const temp = `${arquivo}.parcial`;
  fs.mkdirSync(path.dirname(temp), { recursive: true });
  const comprime = arquivo.endsWith(SUFIXO_COMPRIMIDO);

  function* texto() {
    yield JSON.stringify(cabecalho) + '\n';

    // O dicionário é montado UMA VEZ, aqui, e vai para o disco pronto. É o trabalho
    // que toda abertura do arquivo fazia de novo — 58,1% da carga. `ConstrutorDeTabela`
    // é o mesmo que o carregamento usa, de propósito: se a codificação divergisse da
    // decodificação, o erro seria valor trocado e não exceção.
    const construtor = new ConstrutorDeTabela(
      path.basename(arquivo),
      apuradas.map((c) => c.nome),
      linhas.length,
    );
    for (const linha of linhas) {
      construtor.poeLinha(apuradas.map((c) => linha[c.nome] ?? null));
    }
    const tabela = construtor.fecha();

    // Uma linha por coluna, na ORDEM do cabeçalho — a leitura confere as duas.
    // `apuradas` nomeia a tabela aqui, porque foi com ela que o construtor subiu.
    yield* corpoDoFormato2(apuradas, tabela, (c) => c.nome);
  }

  // O gerador é o mesmo nos dois caminhos — o gzip é um elo a mais no pipeline, e
  // não um segundo caminho de escrita. Duas cópias do laço que serializa a linha é
  // exatamente o que diverge sem ninguém notar: é o argumento do `normalizeName`
  // importado no topo deste arquivo, valendo aqui dentro.
  await (comprime
    ? pipeline(texto(), zlib.createGzip(), fs.createWriteStream(temp))
    : pipeline(texto(), fs.createWriteStream(temp, { encoding: 'utf8' })));

  await renomeiaComRetentativa(temp, arquivo);

  // O gêmeo de outro sufixo tem de sair, e tem de sair AQUI. Deixá-lo é deixar duas
  // cargas em disco sob o mesmo nome de query: a leitura pega o comprimido e as
  // varreduras por nome podem pegar o cru. `escolheGemeo` erra alto nesse estado, mas
  // errar alto no dia seguinte é pior do que não criar o estado — e um passo separado
  // de limpeza é justamente o que já foi esquecido duas vezes neste fluxo (ACHADOS
  // #53, #78), que é o motivo de o temp/rename também morar aqui dentro.
  const gemeo = gemeoDe(arquivo);
  if (gemeo !== null && fs.existsSync(gemeo)) fs.rmSync(gemeo);

  return cabecalho;
}

/** Só o cabeçalho, sem ler as linhas — para listar o que existe no snapshot. */
export function leCabecalho(arquivo: string): CabecalhoDeSnapshot {
  if (comprimidoEmDisco(arquivo)) {
    return confereFormato(JSON.parse(primeiraLinhaComprimida(arquivo)) as CabecalhoDeSnapshot, arquivo);
  }
  const fd = fs.openSync(arquivo, 'r');
  try {
    // O cabeçalho de `field-agenda` tem ~30 colunas; 64 KB sobra e evita ler o
    // arquivo inteiro só para saber quantas linhas ele tem.
    const buf = Buffer.alloc(65536);
    const lidos = fs.readSync(fd, buf, 0, buf.length, 0);
    const texto = buf.subarray(0, lidos).toString('utf8');
    const fim = texto.indexOf('\n');
    if (fim < 0) {
      throw new Error(`${arquivo}: cabeçalho não termina nos primeiros ${lidos} bytes.`);
    }
    return confereFormato(JSON.parse(texto.slice(0, fim)) as CabecalhoDeSnapshot, arquivo);
  } finally {
    fs.closeSync(fd);
  }
}

function confereFormato(cab: CabecalhoDeSnapshot, onde: string): CabecalhoDeSnapshot {
  if (cab.formato !== 1 && cab.formato !== 2) {
    throw new Error(
      `${onde}: formato de snapshot ${cab.formato}, esperado 1 ou 2. ` +
        `Rode 'npm run snapshot' de novo — ler com o decodificador errado dá valor errado, não erro.`,
    );
  }
  return cab;
}

/**
 * As chaves normalizadas do cabeçalho, conferindo que não colidem.
 *
 * Duas colunas que normalizam para a mesma chave — `Data` e `data`, ou `Turno` e
 * ` turno ` — fariam a segunda sobrescrever a primeira em toda linha, e o relatório
 * serviria a coluna errada **sem erro nenhum**. É a classe de falha que este projeto
 * não aceita, então erra alto aqui, onde ainda dá para nomear as duas.
 */
function chavesNormalizadas(cab: CabecalhoDeSnapshot, onde: string): string[] {
  const chaves = cab.colunas.map((c) => normalizeName(c.nome));
  const vistas = new Map<string, string>();
  for (let i = 0; i < chaves.length; i++) {
    const anterior = vistas.get(chaves[i]!);
    if (anterior !== undefined) {
      throw new Error(
        `${onde}: as colunas '${anterior}' e '${cab.colunas[i]!.nome}' normalizam para ` +
          `a mesma chave '${chaves[i]}'. Uma sobrescreveria a outra em toda linha.`,
      );
    }
    vistas.set(chaves[i]!, cab.colunas[i]!.nome);
  }
  return chaves;
}

/**
 * Lê a tabela inteira. Devolve as linhas como o `Dataset` as espera: **chave
 * normalizada**, sempre.
 *
 * **Por que normalizar aqui, e não confiar no arquivo.** Até a materialização de
 * coluna calculada (ACHADOS #47), toda chave vinha de `toDatasetRows` e já chegava
 * normalizada — esta função só repassava. `materializaColunas` grava a coluna sob o
 * **nome de exibição** (`Status SLA`), então o cabeçalho passou a misturar os dois
 * estilos. Normalizar na leitura é o único ponto em que dá para consertar isso sem
 * invalidar arquivo já gravado, e é o que permite ao carregamento **adotar** as
 * linhas em vez de copiá-las — `adotaTabela` exige chave normalizada.
 */
/**
 * As colunas de um arquivo de **formato 2**, já decodificadas.
 *
 * É o leitor único dos dois caminhos: `le()` monta objetos a partir daqui e
 * `leColunar()` monta a `TabelaColunar`. Um só corpo porque a alternativa — duas
 * decodificações do mesmo arquivo — é a que diverge sem ninguém notar.
 *
 * **Omitir uma coluna aqui é de graça.** No formato 1 a projeção pulava o valor
 * célula a célula, mas o `JSON.parse` da linha inteira já tinha acontecido; aqui a
 * coluna omitida nem é decodificada.
 */
async function leColunas(
  arquivo: string,
  omitir?: ReadonlySet<string>,
): Promise<{ cabecalho: CabecalhoDeSnapshot; colunas: ColunaColunar[] }> {
  let cabecalho: CabecalhoDeSnapshot | null = null;
  let chaves: string[] = [];
  const colunas: ColunaColunar[] = [];
  let k = 0;

  await paraCadaLinha(arquivo, (texto) => {
    if (texto === '') return;
    if (cabecalho === null) {
      cabecalho = confereFormato(JSON.parse(texto) as CabecalhoDeSnapshot, arquivo);
      chaves = chavesNormalizadas(cabecalho, arquivo);
      return;
    }
    const cab = cabecalho as CabecalhoDeSnapshot;
    const declarada = cab.colunas[k];
    if (declarada === undefined) {
      const excedente = (JSON.parse(texto) as ColunaEmDisco).c;
      throw new Error(
        `${arquivo}: veio a coluna '${excedente}' além das ${cab.colunas.length} do ` +
          `cabeçalho. Arquivo inconsistente — apague e materialize de novo.`,
      );
    }
    const chave = chaves[k]!;
    k++;
    // **A coluna omitida não chega a ser parseada.** O comentário acima promete que
    // "a coluna omitida nem é decodificada", e era verdade pela metade: o `d` e o
    // `b` não viravam valor nem id, mas o `JSON.parse` da linha INTEIRA já tinha
    // acontecido — e no formato 2 a linha de uma coluna é o dicionário inteiro dela,
    // megabytes em `field-agenda`. Em produção `carrega` omite 45 das 107 colunas
    // (`colunasUsadas`), então era quase metade do `JSON.parse` do snapshot gasto
    // para montar um objeto e descartá-lo no `return` da linha seguinte.
    //
    // O que se perde ao não parsear é a conferência de nome, e ela NÃO pode cair:
    // ler uma coluna pela outra daria a coluna certa com o nome errado, sem erro
    // depois disso. Por isso a conferência vira um teste de PREFIXO, e ele é exato —
    // `corpoDoFormato2` serializa `{c,w,d,b}` por literal de objeto, nessa ordem, e
    // é o único escritor deste corpo. Se a ordem das chaves mudar lá, este prefixo
    // para de bater e a leitura erra alto aqui, que é o lugar certo para errar.
    if (omitir?.has(chave)) {
      if (!texto.startsWith(`{"c":${JSON.stringify(declarada.nome)},"w":`)) {
        throw new Error(
          `${arquivo}: a coluna ${k - 1} do corpo não abre com o nome '${declarada.nome}' ` +
            `que o cabeçalho declara. Ler uma pela outra daria a coluna certa com o ` +
            `nome errado — e nenhum erro depois disso.`,
        );
      }
      return;
    }
    const bruta = JSON.parse(texto) as ColunaEmDisco;
    if (bruta.c !== declarada.nome) {
      throw new Error(
        `${arquivo}: a coluna ${k - 1} do corpo é '${bruta.c}' e a do cabeçalho é ` +
          `'${declarada.nome}'. Ler uma pela outra daria a coluna certa com o nome ` +
          `errado — e nenhum erro depois disso.`,
      );
    }
    const onde = `${arquivo}[${bruta.c}]`;
    colunas.push({
      nome: chave,
      valores: bruta.d.map((v) => decodifica(v, declarada.tipo, onde)),
      ids: base64ParaIds(bruta.b, bruta.w, cab.linhas, onde),
    });
  });

  if (cabecalho === null) throw new Error(`${arquivo}: arquivo vazio, sem cabeçalho.`);
  const cab = cabecalho as CabecalhoDeSnapshot;
  if (k !== cab.colunas.length) {
    throw new Error(
      `${arquivo}: cabeçalho diz ${cab.colunas.length} colunas e o corpo tem ${k}. ` +
        `Arquivo truncado — apague e materialize de novo.`,
    );
  }
  return { cabecalho: cab, colunas };
}

export async function le(
  arquivo: string,
  /**
   * Colunas a **não** carregar, em nome normalizado. O valor ainda é lido do disco
   * — ele está no meio da linha —, mas não vira propriedade de objeto, que é onde
   * mora o custo: são 1,46 milhão de linhas. Quem decide a lista é
   * `colunas-usadas.ts`; o cabeçalho devolvido continua descrevendo o arquivo
   * inteiro, para quem precisa saber o que ficou de fora.
   */
  omitir?: ReadonlySet<string>,
  /** Idem `leColunar`: só o `formato`, para quem já leu o cabeçalho. */
  formatoConhecido?: number,
): Promise<{ cabecalho: CabecalhoDeSnapshot; linhas: Record<string, Escalar>[] }> {
  // O formato 2 guarda coluna, não linha: monta as linhas a partir dele. O `le()`
  // continua devolvendo o mesmo objeto por linha, então nenhum chamador muda — é o
  // que permite trocar o formato sem mexer em `carrega.ts` nem nas ferramentas.
  if ((formatoConhecido ?? leCabecalho(arquivo).formato) === 2) {
    const { cabecalho: cab, colunas } = await leColunas(arquivo, omitir);
    const fora: Record<string, Escalar>[] = new Array(cab.linhas);
    for (let i = 0; i < cab.linhas; i++) {
      const linha: Record<string, Escalar> = {};
      for (let j = 0; j < colunas.length; j++) {
        const col = colunas[j]!;
        linha[col.nome] = col.valores[col.ids[i]!]!;
      }
      fora[i] = linha;
    }
    return { cabecalho: cab, linhas: fora };
  }

  let cabecalho: CabecalhoDeSnapshot | null = null;
  const linhas: Record<string, Escalar>[] = [];
  /** Chave normalizada de cada coluna, na ordem do cabeçalho. Calculada uma vez. */
  let chaves: string[] = [];
  /** Índices que entram na linha — as omitidas já saíram daqui. */
  let entram: number[] = [];
  let n = 0;

  await paraCadaLinha(arquivo, (texto) => {
    if (texto === '') return;
    if (cabecalho === null) {
      cabecalho = confereFormato(JSON.parse(texto) as CabecalhoDeSnapshot, arquivo);
      chaves = chavesNormalizadas(cabecalho, arquivo);
      entram = chaves.map((_, i) => i).filter((i) => !omitir?.has(chaves[i]!));
      return;
    }
    // `cabecalho` é `let` capturada por este fecho, então o estreitamento acima não
    // sobrevive ao TypeScript aqui dentro. A afirmação é segura: a primeira linha é
    // sempre o cabeçalho, e sem ele o `return` acima já teria saído.
    const cab = cabecalho as CabecalhoDeSnapshot;
    n++;
    const valores = JSON.parse(texto) as unknown[];
    const linha: Record<string, Escalar> = {};
    for (const i of entram) {
      linha[chaves[i]!] = decodifica(valores[i], cab.colunas[i]!.tipo, `${arquivo}:${n}`);
    }
    linhas.push(linha);
  });

  if (cabecalho === null) throw new Error(`${arquivo}: arquivo vazio, sem cabeçalho.`);
  // A contagem é a única conferência barata de arquivo truncado — e truncado é o
  // que acontece quando o processo morre no meio da escrita, que é justo o risco
  // de materializar uma tabela de 1,4 milhão de linhas.
  if (n !== cabecalho.linhas) {
    throw new Error(
      `${arquivo}: cabeçalho diz ${cabecalho.linhas} linhas e o arquivo tem ${n}. ` +
        `Arquivo truncado — apague e materialize de novo.`,
    );
  }
  return { cabecalho, linhas };
}

/**
 * O MESMO arquivo, lido para `TabelaColunar` em vez de um objeto por linha.
 *
 * **Existe ao lado de `le()`, não no lugar dela.** Enquanto as duas coexistem, dá
 * para carregar o mesmo arquivo pelos dois caminhos e conferir célula a célula — é
 * o que o teste diferencial faz, e é a única forma honesta de trocar a
 * representação embaixo de um avaliador sem apostar. O mesmo papel que o
 * interruptor `projetar: false` cumpre em `carrega.ts`.
 *
 * Tudo o que decide VALOR é compartilhado de propósito: `confereFormato`,
 * `chavesNormalizadas`, `decodifica` e a conferência de truncamento são as mesmas
 * chamadas. Se esta função tivesse a própria cópia de qualquer uma delas, as duas
 * poderiam divergir sem ninguém notar — que é exatamente o que o diferencial
 * deveria pegar, e não pegaria.
 *
 * O ganho medido por `npm run bench:colunar` sobre os arquivos reais: 3.378 MB de
 * heap para as 23 tabelas como objeto, contra 324 MB como coluna (10,4x). A LEITURA
 * é mais LENTA — 4.593 ms contra 2.802 ms em `field-agenda` —, porque montar o
 * dicionário custa um `Map.get` por célula. Troca-se tempo de carga por memória e
 * por varredura; a varredura é que paga, e ela vem depois.
 */
export async function leColunar(
  arquivo: string,
  /** Idem `le()`: colunas a não carregar, em nome normalizado. */
  omitir?: ReadonlySet<string>,
  /**
   * O `formato` do cabeçalho, quando quem chama **já o leu**.
   *
   * É só o número, e de propósito: o cabeçalho que vale continua sendo o que sai do
   * fluxo, parseado por `leColunas`/`le` na primeira linha — passar o objeto inteiro
   * convidaria alguém a usá-lo no lugar daquele, e um cabeçalho velho descrevendo um
   * arquivo novo daria coluna certa com contagem errada. O que se evita aqui é
   * apenas a escolha de caminho, que custa um `gunzipSync` de 128 KB no arquivo
   * comprimido: `carrega` chega aqui com o cabeçalho na mão desde
   * `preservaEspecieDeJuncao`, e sem isto o lia pela terceira vez.
   */
  formatoConhecido?: number,
): Promise<{ cabecalho: CabecalhoDeSnapshot; tabela: TabelaColunar }> {
  // **O caminho para o qual o formato 2 existe**: o dicionário já está no arquivo,
  // então não há o que montar — as colunas entram na tabela como vieram.
  if ((formatoConhecido ?? leCabecalho(arquivo).formato) === 2) {
    const { cabecalho: cab, colunas } = await leColunas(arquivo, omitir);
    const t = new TabelaColunar(cab.tabelas?.[0] ?? cab.query ?? arquivo, cab.linhas);
    for (const col of colunas) t.poe(col);
    return { cabecalho: cab, tabela: t };
  }

  let cabecalho: CabecalhoDeSnapshot | null = null;
  let construtor: ConstrutorDeTabela | null = null;
  let entram: number[] = [];
  let n = 0;

  await paraCadaLinha(arquivo, (texto) => {
    if (texto === '') return;
    if (cabecalho === null) {
      cabecalho = confereFormato(JSON.parse(texto) as CabecalhoDeSnapshot, arquivo);
      const chaves = chavesNormalizadas(cabecalho, arquivo);
      entram = chaves.map((_, i) => i).filter((i) => !omitir?.has(chaves[i]!));
      construtor = new ConstrutorDeTabela(
        cabecalho.tabelas?.[0] ?? cabecalho.query ?? arquivo,
        entram.map((i) => chaves[i]!),
        cabecalho.linhas,
      );
      return;
    }
    // Idem `le()`: o fecho perde o estreitamento de `cabecalho`.
    const cab = cabecalho as CabecalhoDeSnapshot;
    n++;
    const valores = JSON.parse(texto) as unknown[];
    const vs: Escalar[] = new Array(entram.length);
    for (let k = 0; k < entram.length; k++) {
      const i = entram[k]!;
      vs[k] = decodifica(valores[i], cab.colunas[i]!.tipo, `${arquivo}:${n}`);
    }
    construtor!.poeLinha(vs);
  });

  if (cabecalho === null) throw new Error(`${arquivo}: arquivo vazio, sem cabeçalho.`);
  if (n !== cabecalho.linhas) {
    throw new Error(
      `${arquivo}: cabeçalho diz ${cabecalho.linhas} linhas e o arquivo tem ${n}. ` +
        `Arquivo truncado — apague e materialize de novo.`,
    );
  }
  return { cabecalho, tabela: construtor!.fecha() };
}

/**
 * Converte um arquivo de **formato 1** para **formato 2**, sem tocar no original.
 *
 * **O cabeçalho atravessa inteiro; só `formato` muda.** É o ponto todo, e não um
 * detalhe de implementação: a alternativa óbvia — `le()` e depois `escreve()` —
 * NÃO é uma conversão. Ela reapura `tipo` e `nulos` a partir do dado (o tipo
 * declarado é justamente o que este formato existe para não adivinhar de novo), e
 * perde a grafia original de cada coluna, porque `le()` devolve chave normalizada
 * e `DATA INSTALAÇÃO` voltaria ao disco como `data instalação`. Converter tem de
 * mudar a REPRESENTAÇÃO e mais nada — inclusive `geradoEm`, que é a data do dado
 * na tela, e `marca`, de onde a carga incremental recomeça.
 *
 * Escreve em `destino` e devolve o cabeçalho novo. Quem chama é que decide trocar
 * um pelo outro, e só depois de conferir célula a célula — ver
 * `tools/snapshot/src/converte.ts`.
 */
export async function converteParaFormato2(
  origem: string,
  destino: string,
): Promise<CabecalhoDeSnapshot> {
  const { cabecalho, tabela } = await leColunar(origem);
  if (cabecalho.formato !== 1) {
    throw new Error(
      `${origem}: está no formato ${cabecalho.formato}, e esta conversão é de 1 para 2.`,
    );
  }
  const novo: CabecalhoDeSnapshot = { ...cabecalho, formato: 2 };

  const temp = `${destino}.parcial`;
  fs.mkdirSync(path.dirname(temp), { recursive: true });
  const comprime = destino.endsWith(SUFIXO_COMPRIMIDO);

  function* texto() {
    yield JSON.stringify(novo) + '\n';
    // Normalizado: é assim que `leColunar` nomeia as colunas que devolve.
    yield* corpoDoFormato2(novo.colunas, tabela, (c) => normalizeName(c.nome));
  }

  await (comprime
    ? pipeline(texto(), zlib.createGzip(), fs.createWriteStream(temp))
    : pipeline(texto(), fs.createWriteStream(temp, { encoding: 'utf8' })));

  // Temp e rename como em `escreve`, pelo mesmo motivo: um destino meio escrito é
  // um arquivo que carrega. O gêmeo de outro sufixo NÃO se apaga aqui — o destino
  // é um encenado, e apagar o gêmeo dele apagaria o arquivo que ainda está servindo.
  await renomeiaComRetentativa(temp, destino);
  return novo;
}
