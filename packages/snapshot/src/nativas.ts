// Tradução nativa de DAX que é, na verdade, um `GROUP BY`.
//
// **O número que justifica o arquivo.** Congelar `Status Protocolo Dia` custa
// **211 s** dos 238 s de `npm run snapshot:calculadas -- --todas` (medido em
// 04/09/2026) — 89% do tempo, para produzir 13.045 linhas. Antes custava 26 min, e
// antes disso 14 h 28 min (ACHADOS #68). A causa não é o motor ser lento: são as
// quatro colunas calculadas, cada uma um
//
//     CALCULATE ( MAX ( 'FIELD AGENDA'[X] ),
//                 FILTER ( 'FIELD AGENDA', protocolo = P && TRUNC ( Slot Agenda ) = D ) )
//
// avaliado UMA VEZ POR LINHA. São 13.045 × 647.909 = 8,45 bilhões de visitas de
// linha por coluna, quatro vezes. A mesma resposta sai de UMA passada agrupando por
// `(protocolo, TRUNC(Slot Agenda))`: 4,6 s de cálculo, 57× mais rápido.
//
// **Por que isto é seguro, e por que é perigoso.** Reimplementar DAX em JavaScript é
// exatamente como se produz número plausível e errado — é o argumento que fez as 78
// medidas deste projeto NÃO serem 78 funções TypeScript (`docs/DECISAO-CAMADA-M.md`).
// Três coisas seguram esta exceção:
//
//   1. **A fidelidade foi medida contra o arquivo real, célula a célula.**
//      `npm run probe:status-dia` recalcula a tabela por aqui e compara com o
//      `calc.status-protocolo-dia.jsonl.gz` que o DAX produziu: 13.045 linhas, 5
//      colunas, **0 células divergentes** (04/09/2026). A sonda chama ESTE código,
//      não uma cópia — duas cópias divergem sem ninguém notar.
//   2. **Cada regra abaixo cita a função do motor que reproduz.** Divergência fica
//      localizável em vez de misteriosa.
//   3. **`shaConferido` trava a tradução ao DAX.** Se alguém mudar o `table_dax` ou o
//      DAX de qualquer coluna, `shaDaCalculada` muda, o sha deixa de casar e o
//      caminho nativo **se recusa** — cai no avaliador, lento e certo, com uma nota
//      dizendo por quê. É o guarda do ACHADOS #47 um nível acima: lá o hash detecta
//      coluna congelada obsoleta, aqui detecta TRADUÇÃO obsoleta.
//
// Nada aqui grava arquivo nem lê disco: recebe as linhas que o dataset já tem.

import { normalizeName } from '../../semantic-model/src/model.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import type { Escalar } from './formato.ts';
import { shaDaCalculada } from './tabelas-calculadas.ts';

// --------------------------------------------------------------- semântica DAX

/** `serialFromDate` de `measure-engine/value.ts` — série do Excel, epoch 1899-12-30 UTC. */
const EPOCH_MS = Date.UTC(1899, 11, 30);
const DIA_MS = 86_400_000;

/**
 * `TRUNC(data)` do DAX. `TRUNC` converte a data em série (`toNumber`) e corta em
 * direção ao zero — o resultado é **número**, não data, e é assim que o DAX compara.
 * BLANK vira 0 (`toNumber` devolve 0 para BLANK), e 0 nunca casa com um dia de 2026:
 * é o comportamento do motor, não um atalho.
 */
function dia(v: Escalar): number {
  if (v === null || v === undefined) return 0;
  if (v instanceof Date) return Math.trunc((v.getTime() - EPOCH_MS) / DIA_MS);
  if (typeof v === 'number') return Math.trunc(v);
  return 0;
}

/**
 * Chave de igualdade de texto. `compareValues` compara texto por
 * `trim().toLocaleLowerCase('pt-BR')` — o collation padrão do Power BI. Agrupar por
 * outra regra faria "ABC" e "abc" virarem dois grupos onde o DAX vê um.
 */
function chaveTexto(v: Escalar): string {
  return v === null || v === undefined ? '' : String(v).trim().toLocaleLowerCase('pt-BR');
}

/**
 * `MAX` de uma coluna. Compara pela regra acima e devolve o valor **original** do
 * vencedor, não o normalizado. BLANK sai da agregação antes (`agregacao` filtra
 * `isBlank`), e grupo vazio devolve BLANK.
 */
function maxDax(atual: Escalar, novo: Escalar): Escalar {
  if (novo === null || novo === undefined) return atual;
  if (atual === null || atual === undefined) return novo;
  if (typeof atual === 'string' || typeof novo === 'string') {
    return chaveTexto(novo) > chaveTexto(atual) ? novo : atual;
  }
  const a = atual instanceof Date ? atual.getTime() : Number(atual);
  const b = novo instanceof Date ? novo.getTime() : Number(novo);
  return b > a ? novo : atual;
}

/** A chave do grupo: protocolo (por collation) e dia (série truncada). */
function chaveDoGrupo(protocolo: string, d: number): string {
  return `${protocolo} ${d}`;
}

// ------------------------------------------------------- Status Protocolo Dia

interface Grupo {
  protocolo: Escalar;
  dia: number;
  base: Escalar;
  turno: Escalar;
  rank: Escalar;
  tipo: Escalar;
}

/** As colunas que a tradução lê. Faltando uma, ela recusa em vez de somar zero. */
const PRECISA_FIELD_AGENDA = [
  'protocolo',
  'slot agenda',
  'data relato',
  'base',
  'turno',
  'rankdataprotocolo',
  'tipo de protocolo',
  'categoriaprodutividade',
  'skill',
] as const;
const PRECISA_PROTOCOLOS_GERAL = ['n°protocolo', 'data instalação'] as const;

function confereColunas(
  linhas: readonly Record<string, Escalar>[],
  precisa: readonly string[],
  tabela: string,
): void {
  if (linhas.length === 0) return;
  const tem = new Set(Object.keys(linhas[0]!));
  const faltam = precisa.filter((c) => !tem.has(c));
  if (faltam.length > 0) {
    throw new Error(
      `Status Protocolo Dia (nativa): '${tabela}' chegou sem ${faltam.join(', ')}. ` +
        `A projeção de colunas (colunas-usadas.ts) as omitiu, e agrupar sem elas daria ` +
        `"Sem Ação" e coluna nula em toda linha, sem erro. Carregue a forma completa.`,
    );
  }
}

/**
 * `Status Protocolo Dia` por agregação de hash, no lugar do DAX.
 *
 * Devolve as linhas com **chave normalizada** — é a canônica do `Dataset`, e é o que
 * `paraGravacao` espera encontrar.
 *
 * As duas chaves saem da MESMA linha de `FIELD AGENDA`, e é essa a parte que o DAX
 * paga caro: o corpo da tabela agrupa por `Slot Agenda`, e os dois contadores de
 * status filtram por `Data Relato`. São eixos distintos — juntá-los num índice só
 * daria número errado.
 */
export function statusProtocoloDia(
  fieldAgenda: readonly Record<string, Escalar>[],
  protocolosGeral: readonly Record<string, Escalar>[],
): Record<string, Escalar>[] {
  confereColunas(fieldAgenda, PRECISA_FIELD_AGENDA, 'FIELD AGENDA');
  confereColunas(protocolosGeral, PRECISA_PROTOCOLOS_GERAL, 'PROTOCOLOS GERAL');

  const porSlot = new Map<string, Grupo>();
  const improdutivoPorRelato = new Map<string, number>();
  const relatoTecnicoPorRelato = new Map<string, number>();

  for (const l of fieldAgenda) {
    const p = chaveTexto(l['protocolo'] ?? null);

    const dSlot = dia(l['slot agenda'] ?? null);
    const chaveSlot = chaveDoGrupo(p, dSlot);
    const g = porSlot.get(chaveSlot);
    if (g === undefined) {
      porSlot.set(chaveSlot, {
        protocolo: l['protocolo'] ?? null,
        dia: dSlot,
        base: l['base'] ?? null,
        turno: l['turno'] ?? null,
        rank: l['rankdataprotocolo'] ?? null,
        tipo: l['tipo de protocolo'] ?? null,
      });
    } else {
      g.base = maxDax(g.base, l['base'] ?? null);
      g.turno = maxDax(g.turno, l['turno'] ?? null);
      g.rank = maxDax(g.rank, l['rankdataprotocolo'] ?? null);
      g.tipo = maxDax(g.tipo, l['tipo de protocolo'] ?? null);
    }

    const chaveRelato = chaveDoGrupo(p, dia(l['data relato'] ?? null));
    // `CategoriaProdutividade = "Improdutiva"` — igualdade de texto do DAX, sem caixa.
    if (chaveTexto(l['categoriaprodutividade'] ?? null) === 'improdutiva') {
      improdutivoPorRelato.set(chaveRelato, (improdutivoPorRelato.get(chaveRelato) ?? 0) + 1);
    }
    // `NOT ISBLANK([skill])` — `isBlank` é só null/undefined. Texto vazio NÃO é BLANK.
    const skill = l['skill'];
    if (skill !== null && skill !== undefined) {
      relatoTecnicoPorRelato.set(chaveRelato, (relatoTecnicoPorRelato.get(chaveRelato) ?? 0) + 1);
    }
  }

  /** `COUNTROWS('PROTOCOLOS GERAL')` por `(N°PROTOCOLO, TRUNC(DATA INSTALAÇÃO))`. */
  const instaladoPorDia = new Map<string, number>();
  for (const l of protocolosGeral) {
    const chave = chaveDoGrupo(chaveTexto(l['n°protocolo'] ?? null), dia(l['data instalação'] ?? null));
    instaladoPorDia.set(chave, (instaladoPorDia.get(chave) ?? 0) + 1);
  }

  const saida: Record<string, Escalar>[] = [];
  for (const [chave, g] of porSlot) {
    // O `SWITCH`, na ordem em que o DAX o escreve. A ordem É a regra: um dia pode ser
    // improdutivo E ter relato técnico, e "Improdutivo" ganha por vir antes.
    const status =
      (instaladoPorDia.get(chave) ?? 0) > 0
        ? 'Produtivo'
        : (improdutivoPorRelato.get(chave) ?? 0) > 0
          ? 'Improdutivo'
          : (relatoTecnicoPorRelato.get(chave) ?? 0) > 0
            ? 'Inconclusivo'
            : 'Sem Ação';

    saida.push({
      dia: new Date(EPOCH_MS + g.dia * DIA_MS),
      status,
      protocolo: g.protocolo,
      'base dia': g.base,
      'turno dia': g.turno,
      'rank protocolo dia': g.rank,
      'tipo protocolo dia': g.tipo,
    });
  }
  return saida;
}

// ------------------------------------------------------------------ o registro

export interface TraducaoNativa {
  /** Nome da tabela calculada no modelo. */
  tabela: string;
  /**
   * `shaDaCalculada` da definição contra a qual esta tradução foi CONFERIDA célula a
   * célula. Não casou ⇒ a tradução é de outro DAX e não pode rodar.
   */
  shaConferido: string;
  /** As tabelas do modelo que ela lê, na ordem em que `calcula` as recebe. */
  fontes: string[];
  calcula(fontes: readonly Record<string, Escalar>[][]): Record<string, Escalar>[];
}

const TRADUCOES: TraducaoNativa[] = [
  {
    tabela: 'Status Protocolo Dia',
    // Conferido em 04/09/2026 por `npm run probe:status-dia`: 13.045 linhas, 0 células
    // divergentes contra o arquivo que o avaliador de DAX produziu.
    shaConferido: 'c9d50d2e4db53199',
    fontes: ['FIELD AGENDA', 'PROTOCOLOS GERAL'],
    calcula: ([fa, pg]) => statusProtocoloDia(fa ?? [], pg ?? []),
  },
];

/**
 * A tradução nativa desta tabela, se houver uma **e** ela ainda valer para o DAX que
 * está no catálogo.
 *
 * Devolve `{ traducao }` quando dá para usar, e `{ porque }` quando não dá — nunca
 * `null` calado, porque "por que a tradução não entrou" é justamente o que quem
 * espera 4,6 s e recebe 211 s precisa ler.
 */
export function traducaoDe(t: ModelTable): { traducao: TraducaoNativa } | { porque: string } {
  const alvo = normalizeName(t.name);
  const cand = TRADUCOES.find((x) => normalizeName(x.tabela) === alvo);
  if (!cand) return { porque: 'sem tradução nativa' };
  const sha = shaDaCalculada(t);
  if (sha !== cand.shaConferido) {
    return {
      porque:
        `a tradução nativa foi conferida contra o DAX de sha ${cand.shaConferido} e o ` +
        `catálogo está em ${sha} — o DAX mudou desde a conferência. Rodando pelo ` +
        `avaliador (lento e certo). Para religar: rode 'npm run probe:status-dia', ` +
        `confirme 0 divergências e atualize 'shaConferido' em packages/snapshot/src/nativas.ts`,
    };
  }
  return { traducao: cand };
}
