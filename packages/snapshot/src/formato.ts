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

import fs from 'node:fs';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';

/** Escalar que a camada M entrega (`toDatasetRows`) e o `Dataset` aceita. */
export type Escalar = number | string | boolean | Date | null;

/** O tipo apurado de uma coluna. `vazia` = só nulos; `misto` = mais de um. */
export type TipoDeColuna = 'string' | 'number' | 'boolean' | 'date' | 'vazia' | 'misto';

export interface ColunaDeSnapshot {
  nome: string;
  tipo: TipoDeColuna;
  /** Quantos nulos — a contagem que diz se a coluna está de fato preenchida. */
  nulos: number;
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

function decodifica(v: unknown, tipo: TipoDeColuna, onde: string): Escalar {
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
 */
export async function escreve(
  arquivo: string,
  cab: Omit<CabecalhoDeSnapshot, 'formato' | 'linhas' | 'colunas'>,
  colunas: readonly string[],
  linhas: readonly Record<string, Escalar>[],
): Promise<CabecalhoDeSnapshot> {
  const apuradas = apuraColunas(colunas, linhas);
  const cabecalho: CabecalhoDeSnapshot = {
    formato: 1,
    ...cab,
    linhas: linhas.length,
    colunas: apuradas,
  };

  await pipeline(
    (function* () {
      yield JSON.stringify(cabecalho) + '\n';
      for (const linha of linhas) {
        yield JSON.stringify(apuradas.map((c) => codifica(linha[c.nome] ?? null, c.tipo))) + '\n';
      }
    })(),
    fs.createWriteStream(arquivo, { encoding: 'utf8' }),
  );

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
 * Lê a tabela inteira. Devolve as linhas como o `Dataset` as espera — chaves já
 * são os nomes normalizados que `toDatasetRows` gravou.
 */
export async function le(
  arquivo: string,
): Promise<{ cabecalho: CabecalhoDeSnapshot; linhas: Record<string, Escalar>[] }> {
  const rl = readline.createInterface({
    input: fs.createReadStream(arquivo, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let cabecalho: CabecalhoDeSnapshot | null = null;
  const linhas: Record<string, Escalar>[] = [];
  let n = 0;

  for await (const texto of rl) {
    if (texto === '') continue;
    if (cabecalho === null) {
      cabecalho = confereFormato(JSON.parse(texto) as CabecalhoDeSnapshot, arquivo);
      continue;
    }
    n++;
    const valores = JSON.parse(texto) as unknown[];
    const linha: Record<string, Escalar> = {};
    for (let i = 0; i < cabecalho.colunas.length; i++) {
      const c = cabecalho.colunas[i]!;
      linha[c.nome] = decodifica(valores[i], c.tipo, `${arquivo}:${n}`);
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
