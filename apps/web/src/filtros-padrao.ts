import type { FiltroDaTela } from './api.ts';

// Estado inicial de filtro que o relatório Power BI original já traz: várias páginas
// abrem **pré-filtradas** (o mês fechado, ou o ano corrente), não em "Todos". Sem isto
// a tela mostra a base inteira e os números não batem com o relatório — foi o gap nº1
// da auditoria de paridade (ver docs/PARIDADE-POWERBI.md §6).
//
// Decisão do Erick (20/08): as páginas de mês abrem no **último mês fechado**
// (dinâmico), não num mês fixo — assim acompanham o tempo em vez de apodrecer.

// Os nomes têm de bater **exatamente** com a projeção do nível [Mês] do motor
// (measure-engine `HIERARQUIA.mês` → `MESES_PT`): minúsculo, com acento em "março".
const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

type Escopo = 'mes' | 'ano';
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
  'agendamento-field': { tabela: 'calendar', coluna: 'Data', escopo: 'mes' },
  'diario-instalacao': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'mes' },
  'protocolos-detalhados': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'mes' },
  'manutencao-inicial': { tabela: 'REINCIDÊNCIA', coluna: 'data_suporte', escopo: 'ano' },
  'instalacao-reincidente': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'ano' },
};

/**
 * A coluna de data que a página trava por padrão — ou `null` se ela não trava nenhuma.
 *
 * Exportada porque **quem abre pré-filtrado precisa de um controle para mudar o
 * recorte**. Sem isto a única coisa que o usuário pode fazer com o mês padrão é
 * apagá-lo: não há como pedir junho. É a barra de filtros que consome isto, para
 * montar a árvore Ano > Mês > Dia sobre a mesma coluna.
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

/**
 * Os filtros com que uma página deve abrir, replicando o default do relatório.
 *
 * Um filtro de data por hierarquia é **um por nível**: para "julho/2026" saem dois
 * (Ano=2026 e Mês=julho) sobre a mesma coluna — é assim que o motor recorta
 * `YEAR(data)` e `MONTH(data)` separadamente. O ano vai como número e o mês como o
 * nome em pt, casando com a projeção do motor.
 */
export function filtrosPadrao(pagina: string | null, hoje: Date = new Date()): FiltroDaTela[] {
  if (!pagina) return [];
  const cfg = POR_PAGINA[pagina];
  if (!cfg) return [];

  if (cfg.escopo === 'ano') {
    return [{ tabela: cfg.tabela, coluna: cfg.coluna, nivel: 'Ano', valores: [hoje.getFullYear()] }];
  }

  const { ano, mes } = ultimoMesFechado(hoje);
  return [
    { tabela: cfg.tabela, coluna: cfg.coluna, nivel: 'Ano', valores: [ano] },
    { tabela: cfg.tabela, coluna: cfg.coluna, nivel: 'Mês', valores: [mes] },
  ];
}
