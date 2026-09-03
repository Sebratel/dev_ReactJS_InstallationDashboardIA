// O formato do snapshot em disco: uma tabela materializada por arquivo.
//
// **Por que existe um formato, e não `JSON.stringify` da tabela.** JSON não tem
// data. `JSON.stringify(new Date())` devolve uma string, e `JSON.parse` devolve
// essa string de volta — a coluna que era data vira texto e todo `YEAR()` do
// relatório passa a errar alto. Um formato que não sabe dizer "isto é data" não
// serve para guardar a camada M.
//
// **A forma.** Linha 1 é o cabeçalho: nome da tabela, query de origem, contagem e
// **o tipo de cada coluna**. As linhas seguintes são arrays na ordem das colunas.
// Duas razões para ser colunar e não um objeto por linha:
//
// - o nome da coluna não se repete por linha. Em `field-agenda`, com 1,4 milhão
//   de linhas, repetir 30 nomes por linha é o grosso do arquivo;
// - o tipo mora no cabeçalho, então a leitura decodifica sem adivinhar. Ler
//   `"2026-01-05"` e decidir na hora se é data ou texto é exatamente a
//   adivinhação que este arquivo existe para evitar.
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
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
// Importado, não reescrito: `normalizeName` é uma linha, e duas cópias de uma
// linha é exatamente o tipo de coisa que diverge sem ninguém notar. O que o
// `Dataset` considera "normalizado" tem de ser o que esta leitura produz.
import { normalizeName } from '../../semantic-model/src/model.ts';
import { renomeiaComRetentativa } from './escrita-atomica.ts';

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
  /** Versão do formato. Muda quando a decodificação muda, e a leitura confere. */
  formato: 1;
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
    formato: 1,
    ...cab,
    linhas: linhas.length,
    colunas: apuradas,
  };

  const temp = `${arquivo}.parcial`;
  await pipeline(
    (function* () {
      yield JSON.stringify(cabecalho) + '\n';
      for (const linha of linhas) {
        yield JSON.stringify(apuradas.map((c) => codifica(linha[c.nome] ?? null, c.tipo))) + '\n';
      }
    })(),
    fs.createWriteStream(temp, { encoding: 'utf8' }),
  );
  await renomeiaComRetentativa(temp, arquivo);

  return cabecalho;
}

/** Só o cabeçalho, sem ler as linhas — para listar o que existe no snapshot. */
export function leCabecalho(arquivo: string): CabecalhoDeSnapshot {
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
  if (cab.formato !== 1) {
    throw new Error(
      `${onde}: formato de snapshot ${cab.formato}, esperado 1. ` +
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
): Promise<{ cabecalho: CabecalhoDeSnapshot; linhas: Record<string, Escalar>[] }> {
  const rl = readline.createInterface({
    input: fs.createReadStream(arquivo, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let cabecalho: CabecalhoDeSnapshot | null = null;
  const linhas: Record<string, Escalar>[] = [];
  /** Chave normalizada de cada coluna, na ordem do cabeçalho. Calculada uma vez. */
  let chaves: string[] = [];
  /** Índices que entram na linha — as omitidas já saíram daqui. */
  let entram: number[] = [];
  let n = 0;

  for await (const texto of rl) {
    if (texto === '') continue;
    if (cabecalho === null) {
      cabecalho = confereFormato(JSON.parse(texto) as CabecalhoDeSnapshot, arquivo);
      chaves = chavesNormalizadas(cabecalho, arquivo);
      entram = chaves.map((_, i) => i).filter((i) => !omitir?.has(chaves[i]!));
      continue;
    }
    n++;
    const valores = JSON.parse(texto) as unknown[];
    const linha: Record<string, Escalar> = {};
    for (const i of entram) {
      linha[chaves[i]!] = decodifica(valores[i], cabecalho.colunas[i]!.tipo, `${arquivo}:${n}`);
    }
    linhas.push(linha);
  }

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
