// A segmentação da tela, indo e voltando pela URL.
//
// **Por que este arquivo existe.** As segmentações (`slicer`) do relatório não
// filtravam nada: a API mandava `semCalculo: 'segmentação de dados'` e a tela
// desenhava uma caixa morta. Para elas filtrarem de verdade, a escolha do usuário
// precisa atravessar um `GET` — e do outro lado virar um `FiltroSpec`, que é
// exatamente o que `traduzFiltros` já sabe aplicar. Nenhuma engine muda: o filtro da
// tela entra na mesma lista dos filtros de página, e `calculaCard` os junta num
// `with()` só.
//
// **Por que JSON e não `T[c]=a|b`.** O formato curto perde o tipo, e aqui o tipo
// decide o número: `'PROTOCOLOS GERAL'[ANO]` guarda **2026** como número, e um
// filtro que mande a string `"2026"` não casa com linha nenhuma — devolvendo zero,
// calado e plausível, que é a única classe de erro que este projeto não pode
// cometer. Também perderia o valor que contém `|` ou `]`, e nesta base há relato
// livre e nome de equipe com pontuação. JSON preserva os dois.
//
// **Este arquivo erra alto em tudo.** Um filtro que não dá para entender **não** é
// ignorado: filtro descartado em silêncio mostra o número do universo inteiro com a
// tela dizendo que está filtrado.

import type { FiltroSpec, ValorLiteral } from './spec.ts';

/** O que a tela escolheu: uma coluna e os valores marcados nela. */
export interface FiltroDeTela {
  tabela: string;
  coluna: string;
  /** Ao menos um. Ver `decodificaFiltro` para o porquê de vazio ser erro. */
  valores: ValorLiteral[];
  /**
   * Nível da hierarquia de datas, quando a segmentação é de `[Data].[Ano]` e não de
   * uma coluna. Ausente é o caso comum.
   *
   * Com ele, os `valores` são os do **nível** — `2026`, `agosto` — e não datas. É o
   * que faz `YEAR(data) IN [2026]` em vez de `data IN [2026]`.
   */
  nivel?: string | null;
}

/** `type` do `FiltroSpec` sintético — aparece na origem que a tela mostra. */
export const TIPO_DE_TELA = 'Tela';

/** O texto que vai em `?filtro=`. Um por coluna; o parâmetro se repete. */
export function codificaFiltro(f: FiltroDeTela): string {
  // `nivel` só entra quando existe: sem isso toda URL de segmentação de coluna
  // carregaria um `"nivel":null` que não diz nada e polui o link compartilhado.
  return JSON.stringify(
    f.nivel
      ? { tabela: f.tabela, coluna: f.coluna, nivel: f.nivel, valores: f.valores }
      : { tabela: f.tabela, coluna: f.coluna, valores: f.valores },
  );
}

/**
 * De volta ao `FiltroSpec` que `traduzFiltros` aplica.
 *
 * Cada erro aqui tem uma frase que diz o que fazer, porque quem os lê é quem está
 * montando uma URL na mão ou depurando a tela.
 */
export function decodificaFiltro(bruto: string): FiltroSpec {
  let cru: unknown;
  try {
    cru = JSON.parse(bruto);
  } catch {
    throw new Error(
      `filtro '${recorta(bruto)}' não é JSON. O formato é ` +
        `?filtro={"tabela":"T","coluna":"c","valores":[...]} (percent-encoded).`,
    );
  }

  if (cru === null || typeof cru !== 'object' || Array.isArray(cru)) {
    throw new Error(`filtro '${recorta(bruto)}' não é um objeto JSON.`);
  }
  const o = cru as Record<string, unknown>;

  const tabela = texto(o['tabela'], 'tabela', bruto);
  const coluna = texto(o['coluna'], 'coluna', bruto);

  if (!Array.isArray(o['valores'])) {
    throw new Error(`filtro de '${tabela}'[${coluna}]: 'valores' tem de ser uma lista.`);
  }

  // Lista vazia é erro, não "sem filtro". `IN ()` não casa com linha nenhuma: a tela
  // mostraria zero em todo card com a segmentação parecendo aplicada. Quem não tem
  // valor escolhido **omite** o parâmetro — a ausência de filtro é a ausência do
  // parâmetro, não um filtro que rejeita tudo.
  if (o['valores'].length === 0) {
    throw new Error(
      `filtro de '${tabela}'[${coluna}]: 'valores' está vazio. Uma lista vazia ` +
        `descartaria todas as linhas e mostraria zero como se fosse um resultado. ` +
        `Para não filtrar, não mande o parâmetro.`,
    );
  }

  const valores: ValorLiteral[] = o['valores'].map((v, i) => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v as ValorLiteral;
    throw new Error(
      `filtro de '${tabela}'[${coluna}]: valor ${i} é ${t}, e só texto, número, ` +
        `booleano ou null podem filtrar uma coluna.`,
    );
  });

  // `nivel` é opcional, mas quando vem tem de ser texto: um `nivel: 0` seria falsy e
  // o filtro voltaria calado a comparar a data crua — aí o guarda de espécie erra
  // alto, mas com uma mensagem sobre tipo que não menciona o nível perdido, e a
  // causa fica escondida. O nível que **existe** e não é suportado erra alto em
  // `traduzFiltros`, com a lista dos suportados.
  const nivel = o['nivel'];
  if (nivel !== undefined && nivel !== null && (typeof nivel !== 'string' || nivel.length === 0)) {
    throw new Error(
      `filtro de '${tabela}'[${coluna}]: 'nivel' tem de ser um texto não vazio ` +
        `(o nome do nível da hierarquia de datas, como Ano ou Mês).`,
    );
  }

  return {
    name: `segmentação da tela: '${tabela}'[${coluna}]${nivel ? `.[${nivel as string}]` : ''}`,
    type: TIPO_DE_TELA,
    entity: tabela,
    property: coluna,
    ...(nivel ? { nivel: nivel as string } : {}),
    conditions: [{ op: 'in', values: valores }],
  };
}

/** Todos os `?filtro=` de um pedido, na ordem em que vieram. */
export function decodificaFiltros(brutos: readonly string[]): FiltroSpec[] {
  return brutos.map(decodificaFiltro);
}

function texto(v: unknown, campo: string, bruto: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(
      `filtro '${recorta(bruto)}': '${campo}' tem de ser um texto não vazio.`,
    );
  }
  return v;
}

/** O bruto na mensagem de erro, sem despejar um parâmetro gigante no log. */
function recorta(s: string): string {
  return s.length <= 60 ? s : `${s.slice(0, 57)}…`;
}
