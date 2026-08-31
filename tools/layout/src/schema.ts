// O tipo do `layout.yaml` — espelha docs/PLANO-LAYOUT-V1.md §1, sem redesenhar nada.
//
// `altura` usa as MESMAS classes de `AlturaDeVisual` (apps/web/src/componentes/Cartao.tsx):
// são as únicas que `estilo.css` sabe desenhar. Duplicar a lista aqui (em vez de importar
// o tipo de dentro de `apps/web`) é proposital — este pacote é consumido por `tools/`, que
// não deveria depender do bundle do front para validar um YAML.

export const ALTURAS_VALIDAS = ['grafico', 'tabela', 'meia', 'matriz', 'auto'] as const;
export type AlturaClasse = (typeof ALTURAS_VALIDAS)[number];

export interface ColunaDeFaixa {
  visual: string;
  span: number;
  render: string;
}

export interface Faixa {
  titulo?: string;
  altura: AlturaClasse;
  colunas: ColunaDeFaixa[];
}

export interface KpiEntry {
  visual: string;
  enfase: 'alta' | 'normal';
  tendencia?: string;
  meta?: string;
  calendario?: string;
}

export interface OcultoEntry {
  visual: string;
  porque: string;
}

export interface ImprovementEntry {
  visual: string;
  original: string;
  virou: string;
  porque: string;
  numero_muda: boolean;
}

export interface LayoutSpec {
  pagina: string;
  base: string;
  kpis: KpiEntry[];
  faixas: Faixa[];
  ocultos: OcultoEntry[];
  improvements: ImprovementEntry[];
}
