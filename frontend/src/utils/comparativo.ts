// A linha "vs ano anterior" de um KPI — `kpis[].comparado` no layout.
//
// O valor de referência é OUTRO KPI da mesma página, calculado pela API (nunca texto
// fixo: ver o aviso de `KpiCard` sobre comparativo inventado). Aqui só se decide como
// dizer a diferença:
//
// - KPI de porcentagem: diferença em **pontos percentuais** (75,3% contra 66,5% é
//   "+8,8 p.p.", não "+13%" — variação relativa de taxa engana);
// - os demais: variação **relativa** ("+6,2%").
//
// `melhor` diz o sentido bom: para prazo, menor é melhor, e cair é verde.

const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Abaixo disto (0,05% ou 0,05 p.p.) a diferença é ruído de arredondamento: "=". */
const EMPATE = 0.0005;

export interface Comparativo {
  seta: '▲' | '▼' | '=';
  /** "+6,2%" / "−8,8 p.p." / "0,0%". */
  texto: string;
  tom: 'bom' | 'ruim' | 'neutro';
}

export function comparativo(
  atual: number,
  anterior: number,
  opts: { percentual: boolean; melhor: 'maior' | 'menor' },
): Comparativo | null {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return null;
  // Variação relativa sobre zero não existe; em porcentagem a diferença em p.p. existe.
  if (!opts.percentual && anterior === 0) return null;

  const delta = opts.percentual ? atual - anterior : (atual - anterior) / Math.abs(anterior);
  const sufixo = opts.percentual ? ' p.p.' : '%';
  if (Math.abs(delta) < EMPATE) return { seta: '=', texto: `0,0${sufixo}`, tom: 'neutro' };

  const sinal = delta > 0 ? '+' : '−';
  const subiu = delta > 0;
  return {
    seta: subiu ? '▲' : '▼',
    texto: `${sinal}${nf1.format(Math.abs(delta) * 100)}${sufixo}`,
    tom: subiu === (opts.melhor === 'maior') ? 'bom' : 'ruim',
  };
}
