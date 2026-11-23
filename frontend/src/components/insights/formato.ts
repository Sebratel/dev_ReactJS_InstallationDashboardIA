// Formato e cores das abas de insights. As cores são `var(--ins-*)`, definidas em
// `insights.css` a partir dos tokens `--pbi-*`: o Recharts e o Leaflet pintam SVG por
// atributo, e `fill="var(--x)"` acompanha o `.dark` sem nenhum hexadecimal aqui.

import type { Categoria, Desfecho, Situacao } from '../../services/insightsService.ts';

type Talvez = number | null | undefined;

export const int = (v: Talvez): string =>
  v === null || v === undefined ? '—' : Math.round(v).toLocaleString('pt-BR');

export const dec = (v: Talvez, casas = 1): string =>
  v === null || v === undefined
    ? '—'
    : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const pct = (v: Talvez, casas = 0): string =>
  v === null || v === undefined
    ? '—'
    : `${emPorCento(v, { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

/** O valor vezes 100, escrito no padrão pt-BR. */
const emPorCento = (valor: number, opcoes: Intl.NumberFormatOptions): string =>
  (valor * 100).toLocaleString('pt-BR', opcoes);

/** O mesmo que `pct`, mas com o `+` na frente quando sobe. */
export const sinal = (v: Talvez, casas = 0): string => {
  if (v === null || v === undefined) return '—';
  const maisOuNada = v > 0 ? '+' : '';
  return `${maisOuNada}${emPorCento(v, { maximumFractionDigits: casas })}%`;
};

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
/** "ter 18/11". A data chega como `AAAA-MM-DD`; meio-dia evita o fuso virar o dia. */
export const diaCurto = (iso: string | undefined): string => {
  if (!iso) return '';
  const diaDaSemana = DIAS[new Date(`${iso}T12:00:00`).getDay()] ?? '';
  return `${diaDaSemana} ${dataCurta(iso)}`;
};
export const dataCurta = (iso: string | undefined): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const mesNome = (aaaamm: string | undefined): string =>
  aaaamm ? `${MESES[Number(aaaamm.slice(5, 7)) - 1] ?? ''}/${aaaamm.slice(2, 4)}` : '';

/** Rampa única do dourado claro ao bordô: faixa maior = cor mais escura. */
export const FAIXA_COR: Record<Desfecho, string> = {
  sem: 'var(--ins-f-sem)',
  F1: 'var(--ins-f1)',
  F2: 'var(--ins-f2)',
  F3: 'var(--ins-f3)',
  F4: 'var(--ins-f4)',
  F5: 'var(--ins-f5)',
  F6: 'var(--ins-f6)',
  OUTROS: 'var(--pbi-critico)',
};
/** Letra sobre cada faixa: escura nas claras, a de sobre-primária nas escuras. */
export const FAIXA_TEXTO: Record<Desfecho, string> = {
  sem: 'var(--ins-tinta-fixa)',
  F1: 'var(--ins-tinta-fixa)',
  F2: 'var(--ins-tinta-fixa)',
  F3: 'var(--ins-tinta-fixa)',
  F4: 'var(--pbi-sobre-primary)',
  F5: 'var(--pbi-sobre-primary)',
  F6: 'var(--pbi-sobre-primary)',
  OUTROS: 'var(--pbi-sobre-primary)',
};
export const FAIXA_NOME: Record<Desfecho, string> = {
  sem: 'Sem faixa',
  F1: 'Faixa 1',
  F2: 'Faixa 2',
  F3: 'Faixa 3',
  F4: 'Faixa 4',
  F5: 'Faixa 5',
  F6: 'Faixa 6',
  OUTROS: 'Fora da régua (136)',
};
export const ORDEM_FAIXAS = ['sem', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const;

export const SITUACAO: Record<Situacao, { rotulo: string; cor: string }> = {
  execucao: { rotulo: 'Em execução', cor: 'var(--pbi-green)' },
  aCaminho: { rotulo: 'A caminho', cor: 'var(--ins-ouro-escuro)' },
  aguardando: { rotulo: 'Aguardando próximo', cor: 'var(--pbi-muted)' },
  agendaConcluida: { rotulo: 'Agenda concluída', cor: 'var(--ins-concluido)' },
  semAgenda: { rotulo: 'Sem agenda hoje', cor: 'var(--pbi-neutro)' },
};

export const CATEGORIAS: readonly { k: Categoria; rotulo: string; cor: string }[] = [
  { k: 'concluido', rotulo: 'Concluído', cor: 'var(--ins-concluido)' },
  { k: 'execucao', rotulo: 'Em execução', cor: SITUACAO.execucao.cor },
  { k: 'aCaminho', rotulo: 'A caminho', cor: SITUACAO.aCaminho.cor },
  { k: 'aguardando', rotulo: 'Aguardando', cor: SITUACAO.aguardando.cor },
  { k: 'semSucesso', rotulo: 'Sem sucesso', cor: 'var(--pbi-critico)' },
];

/** Os papéis de cor dos gráficos, todos tokens. */
export const COR = {
  vinho: 'var(--pbi-primary)',
  serie: 'var(--ins-serie)',
  ouro: 'var(--ins-ouro-escuro)',
  faixa: 'var(--ins-faixa-ouro)',
  faixaNeutra: 'var(--ins-faixa-neutra)',
  projecao: 'var(--ins-projecao)',
  tinta: 'var(--pbi-ink)',
  cinza: 'var(--pbi-muted)',
  neutro: 'var(--pbi-neutro)',
  grade: 'var(--pbi-grid)',
  linha: 'var(--pbi-borda)',
  bom: 'var(--pbi-green)',
  critico: 'var(--pbi-critico)',
  cursor: 'var(--ins-cursor)',
  chuvaForte: 'var(--ins-chuva-forte)',
  chuvaMedia: 'var(--ins-chuva-media)',
  chuvaFraca: 'var(--pbi-neutro)',
} as const;

export const EIXO = { fontSize: 11, fill: COR.cinza } as const;
export const EIXO_NOME = { fontSize: 11, fill: COR.tinta } as const;
