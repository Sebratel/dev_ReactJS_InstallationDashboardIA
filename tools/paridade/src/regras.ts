// As regras de veredito da paridade, sem I/O — para poderem ter teste.
//
// Separado de `index.ts` porque aquele arquivo é um script: ele lê disco, carrega
// 1,46 milhão de linhas e chama `process.exit`. Nada disso cabe num teste, e a parte
// que precisa de teste é justamente esta — a decisão de o que conta como "bate".

/** Um número ditado da tela do Power BI. */
export interface CardEsperado {
  visual: string;
  /** Rótulo do card. Só para quem lê o arquivo — a comparação é por id. */
  rotulo?: string | null;
  /**
   * O valor que aparece na tela. `null` = ainda não conferido, e o programa diz isso
   * em vez de comparar com nada.
   *
   * Texto é permitido, e não é frouxidão: nem todo card é número. `visao-geral` tem
   * "Hora mais recente" e `diario-instalacao` tem "Data mais recente" — cards cujo
   * valor é hora e data. Exigir número deles transformaria dois cards perfeitamente
   * conferíveis em dois falsos "não calculou", e um harness que grita errado ensina a
   * ignorá-lo. Texto compara exato (sem espaço nas pontas); número compara por
   * tolerância relativa.
   */
  powerbi: number | string | null;
  /**
   * Id de `divergencias.yaml`, quando este card **deve** dar diferente.
   *
   * Preenchido, inverte a expectativa: bater vira falha. É o que impede uma
   * divergência de ser decidida, documentada, e nunca chegar ao número.
   */
  divergente?: string | null;
  /**
   * Motivo para **não** conferir este card. Preenchido, ele sai da conta.
   *
   * Existe por um caso concreto que é um terço do checklist: **22 dos 64 cards** são
   * `Hora mais recente` / `Data mais recente`, o carimbo de quando o dado foi
   * atualizado. Compará-los com um Power BI aberto em outro momento não mede paridade
   * nenhuma — mede o relógio. Pedir 22 números sem sentido a quem está conferindo é o
   * jeito mais rápido de fazer a pessoa desistir da conferência inteira.
   *
   * Exige motivo em texto, e não um booleano, para que "ignorado" nunca vire uma forma
   * silenciosa de esconder um card que não bate.
   */
  ignorar?: string | null;
  observacao?: string | null;
}

export interface Gabarito {
  pagina: string;
  conferido_em?: string;
  por?: string;
  /** Diferença relativa aceita. Padrão 0,5% — arredondamento de tela, não de conta. */
  tolerancia?: number;
  cards: CardEsperado[];
}

export export const TOLERANCIA_PADRAO = 0.005;

export type Veredito =
  | 'bate'
  | 'difere'
  | 'divergencia-confirmada'
  | 'divergencia-nao-aplicada'
  | 'sem-gabarito'
  | 'nao-calculou'
  | 'ignorado';

export interface Resultado {
  pagina: string;
  visual: string;
  rotulo: string | null;
  esperado: number | string | null;
  obtido: number | string | null;
  erro?: string;
  veredito: Veredito;
  /** Diferença relativa, quando os dois lados são número. */
  delta?: number;
}

/**
 * Compara um card. Toda a lógica de veredito mora aqui, sem I/O, para ter teste.
 *
 * A regra que não é óbvia é a da divergência declarada: ali, **bater é falha**. Se
 * `peso-instalado-fim-de-semana` mudou o peso do sábado, um card que depende disso
 * *tem* que dar outro número — e se der o mesmo, ou a divergência não chegou ao
 * cálculo, ou o card não dependia dela e a anotação está errada. Nos dois casos alguém
 * precisa olhar.
 */
export function confere(
  esperado: CardEsperado,
  obtido: number | string | null,
  erro: string | undefined,
  tolerancia: number,
): { veredito: Veredito; delta?: number } {
  // Antes de tudo: um card marcado para não conferir não vira erro nem pendência.
  if (esperado.ignorar) return { veredito: 'ignorado' };
  if (erro !== undefined || obtido === null) return { veredito: 'nao-calculou' };
  if (esperado.powerbi === null || esperado.powerbi === undefined) {
    return { veredito: 'sem-gabarito' };
  }

  let igual: boolean;
  let delta: number | undefined;

  if (typeof esperado.powerbi === 'number' && typeof obtido === 'number') {
    const base = Math.abs(esperado.powerbi);
    // Divisão por zero: quando o esperado é 0, "relativo" não quer dizer nada e a
    // comparação vira exata. É o certo — um zero que virou 0,3 não é arredondamento.
    delta = base === 0 ? (obtido === 0 ? 0 : 1) : Math.abs(obtido - esperado.powerbi) / base;
    igual = delta <= tolerancia;
  } else {
    // Um dos dois é texto. Comparar exato é o único critério honesto: "14:32" e
    // "14:33" não estão a 0,1% um do outro em sentido nenhum. Tipos diferentes
    // (esperava número, veio texto) caem aqui e dão diferente — que é a resposta
    // certa, e não um erro de execução.
    igual = String(esperado.powerbi).trim() === String(obtido).trim();
  }

  if (esperado.divergente) {
    return { veredito: igual ? 'divergencia-nao-aplicada' : 'divergencia-confirmada', delta };
  }
  return { veredito: igual ? 'bate' : 'difere', delta };
}
