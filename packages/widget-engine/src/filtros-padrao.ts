import type { FiltroDeTela } from './filtro-url.ts';

// Estado inicial de filtro que o relatório Power BI original já traz: várias páginas
// abrem **pré-filtradas** (o mês fechado, ou o ano corrente), não em "Todos". Sem isto
// a tela mostra a base inteira e os números não batem com o relatório — foi o gap nº1
// da auditoria de paridade (ver docs/PARIDADE-POWERBI.md §6).
//
// Decisão do Erick (20/08): as páginas de mês abrem no **último mês fechado**
// (dinâmico), não num mês fixo — assim acompanham o tempo em vez de apodrecer.
//
// EXCEÇÃO, decisão do Erick (09/09): `agendamento-field` abre no **mês corrente**.
// Não é preferência — é que o último mês fechado torna uma parte da página
// impossível de ler. A matriz `56d3352b476659cd7972` filtra
// `Clima/ Tempo[Tipo] = "Previsão"`, e previsão só existe para hoje e os dias
// seguintes (medido no snapshot de 09/09/2026: 7 cidades × 16 datas, todas de
// 02/09 a 18/09). Mês fechado ∩ previsão = ∅, então TODA célula saía vazia e a
// poda de linhas/colunas vazias derrubava os dois eixos: a tela mostrava
// `0 × 0 · 26 posição(ões) vazia(s) podada(s)`. E não era um mês azarado —
// nenhum mês fechado conterá previsão, então o visual nunca teria dado.
//
// O preço, aceito junto com a decisão: isto move o número de **todos** os visuais
// de `agendamento-field`, não só o da chuva. A alternativa era isentar um visual
// do filtro da página, que é desvio do Power BI espalhado por dois lugares.

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

type Escopo = 'mes' | 'mes-corrente' | 'ano';
interface DataPadrao {
  tabela: string;
  coluna: string;
  escopo: Escopo;
}

// Coluna de data que cada página trava por padrão na origem (auditoria renderizada no
// Power BI Service, 20/08). Páginas fora deste mapa (capa, visão anual, etc.) abrem sem
// filtro, como já era.
const POR_PAGINA: Record<string, DataPadrao> = {
  'visao-geral': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'mes' },
  'agendamento-field': { tabela: 'calendar', coluna: 'Data', escopo: 'mes-corrente' },
  'diario-instalacao': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'mes' },
  'protocolos-detalhados': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'mes' },
  'manutencao-inicial': { tabela: 'REINCIDÊNCIA', coluna: 'data_suporte', escopo: 'ano' },
  'instalacao-reincidente': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'ano' },
};

/**
 * A coluna de data que a página trava por padrão — ou `null` se ela não trava nenhuma.
 */
export function dataDaPagina(pagina: string | null): { tabela: string; coluna: string } | null {
  if (!pagina) return null;
  const cfg = POR_PAGINA[pagina];
  return cfg ? { tabela: cfg.tabela, coluna: cfg.coluna } : null;
}

/** Último mês fechado (o anterior ao corrente) e o ano a que ele pertence. */
function ultimoMesFechado(hoje: Date): { ano: number; mes: string } {
  let ano = hoje.getFullYear();
  let mesIdx = hoje.getMonth() - 1; // 0–11; janeiro (-1) vira dezembro do ano anterior
  if (mesIdx < 0) {
    mesIdx = 11;
    ano -= 1;
  }
  return { ano, mes: MESES_PT[mesIdx]! };
}

/** O mês corrente — o de `hoje`, sem andar para trás. */
function mesCorrente(hoje: Date): { ano: number; mes: string } {
  return { ano: hoje.getFullYear(), mes: MESES_PT[hoje.getMonth()]! };
}

/**
 * Os filtros com que uma página deve abrir, replicando o default do relatório.
 */
export function filtrosPadrao(pagina: string | null, hoje: Date = new Date()): FiltroDeTela[] {
  if (!pagina) return [];
  const cfg = POR_PAGINA[pagina];
  if (!cfg) return [];

  if (cfg.escopo === 'ano') {
    return [{ tabela: cfg.tabela, coluna: cfg.coluna, nivel: 'Ano', valores: [hoje.getFullYear()] }];
  }

  const { ano, mes } = cfg.escopo === 'mes-corrente' ? mesCorrente(hoje) : ultimoMesFechado(hoje);
  return [
    { tabela: cfg.tabela, coluna: cfg.coluna, nivel: 'Ano', valores: [ano] },
    { tabela: cfg.tabela, coluna: cfg.coluna, nivel: 'Mês', valores: [mes] },
  ];
}

/** Quantos períodos para trás o aquecimento adianta, além do padrão. */
export const RECENTES_PADRAO = 3;

/**
 * Os recortes que vale a pena ter prontos ANTES de alguém pedir — o padrão da
 * página e os períodos imediatamente anteriores.
 *
 * **Por que isto existe, com o número.** Medido em 08/09/2026: uma combinação
 * de filtro que ninguém pediu ainda custa ~1,6 s (dos quais só ~0,2 s é
 * cálculo; o resto é montar 137 mil linhas em memória). A MESMA combinação,
 * pedida de novo, custa 2–3 ms. Ou seja, o problema nunca foi o filtro ser
 * caro — foi ser a primeira vez.
 *
 * Trocar de mês é a interação mais comum do relatório, e é exatamente a que
 * caía na primeira vez toda vez. Adiantar os últimos meses transforma o caso
 * comum em acerto de cache.
 *
 * **O que NÃO é adiantado:** qualquer coisa fora desta janela. Aquecer todas
 * as combinações possíveis seria recalcular o relatório inteiro por hora, e a
 * F4 já mostrou que aquecer o que ninguém usa é trabalho perdido.
 */
export function filtrosRecentes(
  pagina: string | null,
  hoje: Date = new Date(),
  quantos: number = RECENTES_PADRAO,
): FiltroDeTela[][] {
  if (!pagina) return [];
  const cfg = POR_PAGINA[pagina];
  if (!cfg) return [];

  // Página de escopo ANUAL adianta menos: um ano a mais custa um recorte inteiro
  // (medido: `instalacao-reincidente` leva ~30 s a frio) e entrega um período que
  // quase ninguém abre. Mês é o oposto — barato e é a troca do dia a dia.
  const quantosDeFato = cfg.escopo === "ano" ? Math.min(2, quantos) : quantos;

  const saida: FiltroDeTela[][] = [];
  for (let i = 0; i < Math.max(1, quantosDeFato); i++) {
    const quando = new Date(hoje.getTime());
    if (cfg.escopo === 'ano') quando.setFullYear(quando.getFullYear() - i);
    else quando.setMonth(quando.getMonth() - i);
    const f = filtrosPadrao(pagina, quando);
    if (f.length > 0) saida.push(f);
  }
  // Ano corrente e ano anterior repetiriam o mesmo recorte se `quantos` passar
  // do que existe; a chave de cache seria a mesma e o aquecimento, trabalho
  // duplicado.
  const vistos = new Set<string>();
  return saida.filter((f) => {
    const k = JSON.stringify(f);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}
