// A janela de dados que separa o nosso snapshot do modelo publicado.
//
// **O problema que isto resolve.** O gabarito de `specs/paridade/*.yaml` existe
// para provar que o nosso número está certo. Só que o modelo do Power BI carrega
// mais história do que a plataforma materializa: em 25/08/2026, `PROTOCOLOS
// PRODUTIVIDADE` tinha 187.534 linhas lá e 70.868 aqui, porque o SQL corta em
// `a.created >= '2026-01-01'`. Gravar a medida SEM filtro poria no gabarito um
// número que a plataforma nunca vai produzir — e um gabarito impossível não
// detecta regressão, ele ensina a ignorar o alarme.
//
// **Por isso a janela é declarada, e não adivinhada.** Cada predicado aqui foi
// conferido contra a contagem de linhas em disco (campo `verificado`). Quando o
// predicado reproduz a nossa janela, a medida filtrada por ele é um gabarito
// legítimo. Quando não existe predicado que reproduza — porque as duas tabelas
// nem são a mesma coisa —, a tabela entra em `bloqueadas` e nenhum card que
// dependa dela recebe número automático. Recusar é melhor que chutar: o arquivo
// que prova que o número está certo é o último lugar onde cabe um palpite.
//
// **O alcance é transitivo.** `Média Protocolos por Dia` não cita tabela nenhuma
// — ela chama `[Total Protocolos]` e `[Total Dias]`. Sem seguir a cadeia de
// medidas, a janela não seria aplicada e o número sairia errado justamente nas
// medidas compostas, que são a maioria dos cards.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface JanelaDeTabela {
  /** Predicado DAX que reproduz o recorte do nosso snapshot. */
  dax: string;
  /** Prova de que o predicado reproduz a janela, no dia em que foi medido. */
  verificado?: { pbi: number; nos: number; em: string };
}

export interface Janelas {
  /** Nome normalizado da tabela -> janela. */
  tabelas: Map<string, JanelaDeTabela>;
  /** Nome normalizado da tabela -> por que não dá para equalizar. */
  bloqueadas: Map<string, string>;
}

const normaliza = (s: string): string => s.trim().toUpperCase();

export const ARQUIVO_JANELA = path.join('_catalog', 'paridade-janela.yaml');

export function carregaJanelas(specsDir: string): Janelas {
  const arquivo = path.join(specsDir, ARQUIVO_JANELA);
  const vazio: Janelas = { tabelas: new Map(), bloqueadas: new Map() };
  if (!fs.existsSync(arquivo)) return vazio;

  const doc = YAML.parse(fs.readFileSync(arquivo, 'utf8')) as {
    tabelas?: Record<string, JanelaDeTabela>;
    bloqueadas?: Record<string, string>;
  } | null;
  if (!doc) return vazio;

  for (const [nome, j] of Object.entries(doc.tabelas ?? {})) {
    if (!j?.dax) {
      throw new Error(
        `${ARQUIVO_JANELA}: a tabela '${nome}' está sem 'dax'. Uma janela sem predicado ` +
          `não filtra nada, e o gabarito sairia com o número sem recorte — que é ` +
          `exatamente o erro que este arquivo existe para impedir.`,
      );
    }
    vazio.tabelas.set(normaliza(nome), j);
  }
  for (const [nome, motivo] of Object.entries(doc.bloqueadas ?? {})) {
    vazio.bloqueadas.set(normaliza(nome), motivo);
  }
  return vazio;
}

/**
 * Remove literais de texto e comentários antes de procurar nomes.
 *
 * Sem isto, um comentário `// olhar 'PROTOCOLOS GERAL'` ou um texto
 * `"Instalado"` viraria citação de tabela e arrastaria uma janela que a medida
 * não usa.
 */
export function limpaDax(dax: string): string {
  return dax
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/"(?:[^"]|"")*"/g, ' ');
}

/** Tabelas citadas explicitamente, na forma `'NOME'`. */
export function tabelasCitadas(dax: string): string[] {
  const limpo = limpaDax(dax);
  const fora: string[] = [];
  for (const m of limpo.matchAll(/'((?:[^']|'')+)'/g)) {
    fora.push(m[1]!.replace(/''/g, "'"));
  }
  return [...new Set(fora)];
}

/**
 * Medidas citadas na forma `[Nome]` sem tabela antes.
 *
 * `'TABELA'[Coluna]` é coluna e não entra; `[Nome]` solto é referência de
 * medida — ou de coluna sem qualificar, que some no filtro de quem chama por
 * não existir no índice de medidas.
 */
export function medidasCitadas(dax: string): string[] {
  const limpo = limpaDax(dax);
  const fora: string[] = [];
  for (const m of limpo.matchAll(/(^|[^'\w\]])\[([^\]]+)\]/g)) {
    fora.push(m[2]!.trim());
  }
  return [...new Set(fora)];
}

export interface ModeloDeMedidas {
  measure(nome: string): { name: string; table: string; dax: string } | null;
}

/**
 * Todas as tabelas que uma medida alcança, seguindo as medidas que ela chama.
 *
 * O `vistas` corta ciclo: medida que se referencia (direta ou indiretamente)
 * existe em DAX e faria isto rodar para sempre.
 */
export function alcance(nome: string, model: ModeloDeMedidas): Set<string> {
  const tabelas = new Set<string>();
  const vistas = new Set<string>();

  const anda = (n: string): void => {
    const chave = normaliza(n);
    if (vistas.has(chave)) return;
    vistas.add(chave);

    const m = model.measure(n);
    if (!m) return;

    const citadas = tabelasCitadas(m.dax);
    for (const t of citadas) tabelas.add(normaliza(t));

    // Medida que não cita tabela nenhuma e também não chama outra medida opera
    // sobre a tabela em que foi declarada. Incluir a tabela de declaração aqui
    // — e só aqui — evita deixar a medida sem janela sem que ninguém perceba.
    const chamadas = medidasCitadas(m.dax).filter((x) => model.measure(x) !== null);
    if (citadas.length === 0 && chamadas.length === 0 && m.table) {
      tabelas.add(normaliza(m.table));
    }
    for (const c of chamadas) anda(c);
  };

  anda(nome);
  return tabelas;
}


/**
 * Funções cujo resultado muda sozinho com a passagem do tempo.
 *
 * Mesma lista de `packages/snapshot/src/tabelas-calculadas.ts` — `TODAY` e `NOW`
 * são as duas que aparecem na base; `UTCNOW`/`UTCTODAY` entram porque custam nada
 * e a ausência delas seria uma fresta. O `\(` no fim é o que separa a CHAMADA do
 * nome: sem ele, `SUM('T'[SNOWNOW])` casaria.
 */
const RELOGIO = /\b(TODAY|NOW|UTCNOW|UTCTODAY)\s*\(/i;

/**
 * A medida depende do **relógio**?
 *
 * **Por que existe.** Medida cuja janela termina em `TODAY()`/`NOW()` não é
 * comparável a um número fixo: o dia de hoje está pela metade dos dois lados e
 * cada lado o congelou num instante diferente. Ela continua sendo PERGUNTADA — ver
 * os dois números lado a lado é útil —, mas não recebe veredito nem vai para o
 * gabarito de `specs/paridade/*.yaml`. Sem esta distinção, a comparação marcaria
 * `difere` numa medida que está certa, e alguém iria "consertar" o que não está
 * quebrado.
 *
 * **Segue as medidas chamadas**, pelo mesmo motivo que `alcance` segue: uma medida
 * que só faz `DIVIDE([Instaladas Hoje], [Meta])` não cita relógio nenhum no próprio
 * DAX e é tão móvel quanto a que chama. O `vistas` corta ciclo — medida que se
 * referencia indiretamente existe em DAX e faria isto rodar para sempre.
 *
 * Usa `limpaDax` e não só o filtro de literais: assim um comentário
 * `-- antes usava TODAY()` também deixa de contar.
 */
export function dependeDoRelogio(nome: string, model: ModeloDeMedidas): boolean {
  const vistas = new Set<string>();

  const anda = (n: string): boolean => {
    const chave = normaliza(n);
    if (vistas.has(chave)) return false;
    vistas.add(chave);

    const m = model.measure(n);
    if (!m) return false;

    const limpo = limpaDax(m.dax);
    if (RELOGIO.test(limpo)) return true;

    return medidasCitadas(m.dax)
      .filter((x) => model.measure(x) !== null)
      .some((x) => anda(x));
  };

  return anda(nome);
}

export interface PlanoDeJanela {
  /** Predicados DAX a aplicar, já deduplicados. */
  predicados: string[];
  /** Tabela bloqueada que impede perguntar esta medida, se houver. */
  bloqueio: { tabela: string; motivo: string } | null;
  /** Tabelas alcançadas, para relatório. */
  tabelas: string[];
}

export function planoDeJanela(
  nome: string,
  model: ModeloDeMedidas,
  janelas: Janelas,
): PlanoDeJanela {
  const tabelas = [...alcance(nome, model)].sort();
  for (const t of tabelas) {
    const motivo = janelas.bloqueadas.get(t);
    if (motivo !== undefined) return { predicados: [], bloqueio: { tabela: t, motivo }, tabelas };
  }
  const predicados = [
    ...new Set(
      tabelas
        .map((t) => janelas.tabelas.get(t)?.dax)
        .filter((d): d is string => typeof d === 'string'),
    ),
  ];
  return { predicados, bloqueio: null, tabelas };
}

/** `[Medida]` ou `CALCULATE([Medida], pred, ...)`, pronto para entrar numa `ROW`. */
export function comJanela(nome: string, predicados: readonly string[]): string {
  const ref = `[${nome.replace(/]/g, ']]')}]`;
  return predicados.length === 0 ? ref : `CALCULATE(${ref}, ${predicados.join(', ')})`;
}

// ------------------------------------- o mesmo trio, para AGREGAÇÃO DE COLUNA
//
// Um card pode ser uma medida (`[Total]`) ou uma agregação crua de coluna
// (`SUM('T'[C])`), e a paridade precisa perguntar as duas ao Power BI sob a MESMA
// janela de dados — senão a diferença medida é a janela, não a plataforma.
//
// **Estas três existiam e sumiram.** `tools/powerbi/src/index.ts` as chamava em cinco
// lugares e a restauração `0aae15c` trouxe as chamadas sem as definições: o programa
// morria com `ReferenceError` na primeira agregação de qualquer dashboard, e `npm run
// powerbi` não roda desde então. Reescritas aqui, ao lado das irmãs de medida, porque
// o defeito de sempre neste projeto é a segunda cópia divergir — e `comJanela` e
// `agregacaoComJanela` têm de aplicar os mesmos predicados do mesmo jeito.

/**
 * Uma referência de coluna em DAX: `'Tabela'[Coluna]`.
 *
 * Os dois escapes são os do DAX, e não são simetria decorativa: o nome de tabela vai
 * entre aspas simples e dobra `'`, o de coluna vai entre colchetes e dobra `]`. Uma
 * tabela chamada `O'Brien` sem o escape fecharia a literal no meio e a consulta
 * viraria outra consulta — que o Power BI aceitaria ou recusaria, e nos dois casos o
 * número sairia do lugar errado.
 */
export function refDeColuna(tabela: string, coluna: string): string {
  return `'${tabela.replace(/'/g, "''")}'[${coluna.replace(/]/g, ']]')}]`;
}

/**
 * O plano de janela de uma AGREGAÇÃO, que alcança **uma** tabela.
 *
 * É a diferença para `planoDeJanela`: uma medida pode citar outras medidas e chegar a
 * várias tabelas, então lá o alcance é calculado por travessia (`alcance`). Uma
 * agregação é `SUM('T'[C])` — toca `T` e mais nada, e o alcance é a própria tabela.
 * Por isso este plano não recebe o nome de uma medida: recebe a entidade.
 *
 * O `_model` fica na assinatura, sem uso, para as duas funções serem chamadas do mesmo
 * jeito no laço de comparação — e para que o dia em que uma agregação precisar do
 * modelo (uma coluna calculada que cite outra tabela) não mude a forma da chamada em
 * cinco lugares. Não inventa travessia que a agregação não faz.
 */
export function planoDeAgregacao(
  entidade: string,
  _model: ModeloDeMedidas,
  janelas: Janelas,
): PlanoDeJanela {
  const tabelas = [entidade];
  const motivo = janelas.bloqueadas.get(entidade);
  if (motivo !== undefined) {
    return { predicados: [], bloqueio: { tabela: entidade, motivo }, tabelas };
  }
  const dax = janelas.tabelas.get(entidade)?.dax;
  return { predicados: typeof dax === 'string' ? [dax] : [], bloqueio: null, tabelas };
}

/**
 * `SUM('T'[C])` ou `CALCULATE(SUM('T'[C]), pred, ...)`, pronto para entrar numa `ROW`.
 *
 * O par de `comJanela`, e a forma é a mesma de propósito: o que muda entre uma medida
 * e uma agregação é só o que vai dentro do `CALCULATE`.
 */
export function agregacaoComJanela(
  funcao: string,
  tabela: string,
  coluna: string,
  predicados: readonly string[],
): string {
  const expr = `${funcao}(${refDeColuna(tabela, coluna)})`;
  return predicados.length === 0 ? expr : `CALCULATE(${expr}, ${predicados.join(', ')})`;
}
