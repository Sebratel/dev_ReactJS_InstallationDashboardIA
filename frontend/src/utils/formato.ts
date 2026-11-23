// Como um valor vira texto na tela.
//
// **Sem JSX de propósito.** Este módulo é a única parte da tela que decide o que a
// pessoa lê, e ele roda em `npm test` junto com as engines — `node --test` executa
// TypeScript direto, mas não JSX. Manter a decisão aqui e o desenho no `.tsx` é o
// que permite testar a decisão sem montar um DOM.
//
// **O tipo vem do servidor, e não se adivinha aqui.** JSON não tem data: sem o tipo
// por coluna, `"2026-03-15T00:00:00.000Z"` e um protocolo que por acaso se pareça com
// uma data seriam indistinguíveis. Adivinhar pelo formato do texto transformaria o
// segundo numa data — número errado plausível, que é o erro que este projeto não pode
// cometer.

/** O tipo que a API manda junto de cada valor. `null` é BLANK. */
export type TipoDeValor = 'number' | 'string' | 'boolean' | 'date' | null;

export interface Formatado {
  texto: string;
  /** Alinhar à direita e usar algarismo tabular. */
  numerico: boolean;
  /** É BLANK — a tela pinta em cinza de "sem dado", nunca em vermelho. */
  vazio: boolean;
}

const formatadorNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat('pt-BR');
// UTC para data pura e data/hora vinda do banco/snapshot: colunas `timestamp without time zone`
// do Voalle/Power BI já são relógio de parede do Brasil e gravadas em UTC no snapshot
// (mesma convenção do `df`, `dfHora` e `HOUR()` do DAX). Formatar em America/Sao_Paulo
// subtraía 3h indevidamente (ex.: Slot Agenda 09:00 aparecendo como 06:00).
const formatoData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const dfhUtc = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'UTC',
});
// Fuso do Brasil (America/Sao_Paulo) só para instantes reais em UTC (ex: carimbo dadoDe):
const fusoLocal = 'America/Sao_Paulo';
const dfh = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: fusoLocal,
});
const dfHora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'UTC' });

/**
 * O nível [Ano] da hierarquia de datas ("DATA INSTALADO Ano", "Data Criado Ano" — a
 * convenção do extrator é sempre terminar em " Ano") chega como `number` puro
 * (2025), e o formatador genérico aplicaria o separador de milhar do pt-BR — "2.025".
 * Ano não é quantidade: nunca leva separador de milhar.
 */
export function ehColunaDeAno(nomeDaColuna: string | null | undefined): boolean {
  return /\bano$/i.test((nomeDaColuna ?? '').trim());
}

/** O resultado de um texto que a tela não trata como número. */
const comoTexto = (texto: string): Formatado => ({ texto, numerico: false, vazio: false });
/** O resultado de algo que a tela alinha à direita e trata como número. */
const comoNumero = (texto: string): Formatado => ({ texto, numerico: true, vazio: false });

/**
 * Um valor da API como texto de tela.
 *
 * Só despacha por tipo: cada formato mora numa função própria. Antes os três ramos
 * estavam aqui dentro, com as regras de época OLE, meia-noite e casas decimais
 * misturadas — complexidade cognitiva 20 pelo SonarJS.
 */
export function formata(
  valor: unknown,
  tipo: TipoDeValor,
  opcoes?: { semAgrupamento?: boolean; casas?: number | null },
): Formatado {
  if (valor === null || valor === undefined) return { texto: '—', numerico: false, vazio: true };

  if (opcoes?.semAgrupamento && tipo === 'number' && Number.isInteger(valor)) {
    return comoNumero(String(valor));
  }
  if (tipo === 'date') return formataData(valor);
  if (tipo === 'number') return formataNumero(valor as number, opcoes?.casas);
  if (tipo === 'boolean') return comoTexto(valor ? 'Sim' : 'Não');
  return comoTexto(String(valor));
}

function formataData(valor: unknown): Formatado {
  const data = new Date(valor as string);
  // Data inválida não vira "Invalid Date" na tela: isso parece defeito da tela, e o
  // defeito está no dado. Dizer o valor cru é o que deixa a causa achável.
  if (Number.isNaN(data.getTime())) return comoTexto(`data inválida: ${String(valor)}`);

  // Campo só-de-hora: a origem é `time`, que o snapshot grava sobre a época OLE
  // (1899-12-30). Mostrar "30/12/1899, 18:23" expõe um detalhe de armazenamento como
  // se fosse a data do dado — aqui vale só a hora. Qualquer ano <= 1900 é época, não
  // dado real desta operação.
  if (data.getUTCFullYear() <= 1900) return comoNumero(dfHora.format(data));

  // Meia-noite exata é data pura; qualquer hora e a hora importa. É o que separa
  // "10/08/2026" de "10/08/2026 09:08" no mesmo card.
  const soData =
    data.getUTCHours() === 0 && data.getUTCMinutes() === 0 && data.getUTCSeconds() === 0;
  return comoNumero((soData ? formatoData : dfhUtc).format(data));
}

function formataNumero(numero: number, casas: number | null | undefined): Formatado {
  // **As casas do `format` da medida vencem o genérico (19/11/2026).** `PRAZO MÉDIO
  // (DIAS)` é `format: "0.0"`: o Power BI escreve `5,3`, e o genérico daqui escrevia
  // `5,25`. Não é só estética — o caractere a mais fazia o rótulo não caber na fatia
  // do gráfico e o número era descartado (ver `casasDoNumero`, no back).
  if (casas !== undefined && casas !== null) return comoNumero(comCasas(casas).format(numero));
  return comoNumero(
    Number.isInteger(numero) ? nfInt.format(numero) : formatadorNumero.format(numero),
  );
}

/** Inteiro com separador de milhar — contagens de linha, totais, etc. */
export function inteiro(numero: number): string {
  return nfInt.format(numero);
}

/**
 * Uma medida de porcentagem como texto de tela.
 *
 * O relatório guarda `%` como **razão** (`0,0525`) e o Power BI a exibe multiplicada por
 * 100 (`5,25%`) — foi o que a conferência de paridade documentou. Casar com o Power BI é
 * o certo. Um valor já em escala de percentual (> 1,5, como `45`) não é multiplicado de
 * novo: só recebe o sinal.
 */
export function percentualDeRazao(valor: unknown): string {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  const escala = Math.abs(valor) <= 1.5 ? valor * 100 : valor;
  return `${formatadorNumero.format(escala)}%`;
}

const nfDeCasas = new Map<number, Intl.NumberFormat>();
function comCasas(casas: number): Intl.NumberFormat {
  let formatoNumero = nfDeCasas.get(casas);
  if (!formatoNumero) {
    formatoNumero = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
    nfDeCasas.set(casas, formatoNumero);
  }
  return formatoNumero;
}

/**
 * Razão SEMPRE escrita como porcentagem (`93,71` → `9.371,0%`), sem o palpite de escala
 * de `percentualDeRazao`. É para valor que a API marcou `percentual`: ali a medida tem
 * `%` no formato do catálogo, e formato com `%` no Power BI significa que o valor
 * guardado é razão. Uma variação de +9.371% é real — o palpite a mostraria como "93,71%".
 *
 * `casas` vem do próprio formato: `0.00%` → 2, `0.0%` → 1 (o padrão, que era o único
 * comportamento até 16/11/2026).
 */
export function razaoComoPercentual(valor: unknown, casas = 1): string {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  return `${comCasas(casas).format(valor * 100)}%`;
}

/** Data e hora de um ISO, para o carimbo de "dado de". */
export function dataHora(iso: string | null): string {
  if (!iso) return '—';
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? '—' : dfh.format(data);
}

/** A partir de quantos dias sem `npm run snapshot` o carimbo vira aviso.
 *  Ver DECISAO-REALTIME.md: o dado não se atualiza sozinho, e escondê-lo
 *  é a alternativa que a decisão explicitamente recusa. */
export const LIMITE_DIAS_DADO_ATRASADO = 2;

/** Dias desde um ISO até agora — null se a data faltar ou for inválida. */
export function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return (Date.now() - data.getTime()) / 86_400_000;
}

/** "há 3min", "há 2h", "há 4d" — idade curta de um ISO, para a capa. */
export function haQuanto(iso: string | null | undefined, agora: number = Date.now()): string {
  if (!iso) return '—';
  const tempo = new Date(iso).getTime();
  if (Number.isNaN(tempo)) return '—';
  const min = Math.max(0, Math.floor((agora - tempo) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const altura = Math.floor(min / 60);
  return altura < 24 ? `há ${altura}h` : `há ${Math.floor(altura / 24)}d`;
}

/**
 * Duração em ms, na unidade que cabe.
 *
 * Uma página desta base leva de 40 ms a 104 minutos. "6240000 ms" é ilegível
 * exatamente no caso em que o número importa.
 */
export function duracao(milissegundos: number): string {
  if (milissegundos < 1000) return `${Math.round(milissegundos)} ms`;
  if (milissegundos < 60_000) return `${(milissegundos / 1000).toFixed(1)} s`;
  const min = Math.floor(milissegundos / 60_000);
  const seg = Math.round((milissegundos % 60_000) / 1000);
  return `${min} min ${String(seg).padStart(2, '0')} s`;
}
