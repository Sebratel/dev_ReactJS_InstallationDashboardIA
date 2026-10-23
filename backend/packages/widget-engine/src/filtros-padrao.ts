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

/**
 * `'nenhum'` é uma coluna de data que a página oferece para NAVEGAR (a árvore
 * Ano > Mês > Dia de `SegmentacaoDataHierarquia`), sem travar nenhum valor na
 * abertura — ver o caso `visao-geral` em `POR_PAGINA`.
 */
type Escopo = 'mes' | 'mes-corrente' | 'ano' | 'nenhum';
interface DataPadrao {
  tabela: string;
  coluna: string;
  escopo: Escopo;
}

// Coluna de data que cada página trava por padrão na origem (auditoria renderizada no
// Power BI Service, 20/08). Páginas fora deste mapa (capa, visão anual, etc.) abrem sem
// filtro, como já era.
//
// **`visao-geral` perdeu o VALOR padrão em 09/09, mas manteve a COLUNA.** A auditoria
// de 20/08 travava a página em "último mês fechado" medindo contra uma captura que já
// estava filtrada — não dava para saber se era o padrão do relatório ou escolha de
// quem tirou o print. Erick conferiu ao vivo em 09/09: os sete seletores da página
// abrem em "Todos", e o total bate com o nosso sem filtro nenhum (94.160 lá, 94.166
// aqui — a mesma defasagem de snapshot de sempre). Trancar a página num mês produzia
// justamente o "os números não batem" que este filtro deveria evitar: 3.485 (agosto)
// contra 94.160 (tudo). A coluna fica (`escopo: 'nenhum'`) só para a árvore Ano > Mês >
// Dia continuar substituindo o slicer de drill que não filtra sozinho — sem isso o
// controle nativo daquele campo voltaria a aparecer desabilitado.
const POR_PAGINA: Record<string, DataPadrao> = {
  'visao-geral': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'nenhum' },
  'agendamento-field': { tabela: 'calendar', coluna: 'Data', escopo: 'mes-corrente' },
  // Sem recorte ao abrir (como sempre abriu), mas COM a árvore de data: sem esta linha
  // a hierarquia DATA ATIVAÇÃO (Ano/Mês/Dia) virava um menu de datas soltas, e escolher
  // uma (28/12/2026, 20/10/2026) mandava texto contra data e derrubava os três cards.
  'premiacao-instalacao': { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', escopo: 'nenhum' },
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

/**
 * Visuais que mostram PREVISÃO, e por isso não vivem dentro de um mês.
 *
 * **O caso que criou isto.** A matriz de probabilidade de chuva de
 * `agendamento-field` cruza cidade × data de agenda e só tem linha de
 * `Clima/ Tempo[Tipo] = "Previsão"` — ou seja, de hoje até o fim do horizonte da
 * Open-Meteo (~16 dias). Qualquer recorte de MÊS corta esse horizonte no dia 30 ou
 * 31: em 28/09 a previsão de 01/10 a 13/10 já existe, e um filtro de "setembro" a
 * joga fora. Trocar o mês fechado pelo corrente adiou o problema por um mês; não é
 * conserto, porque o defeito não é QUAL mês — é o mês ser a caixa errada para uma
 * janela que anda todo dia.
 *
 * **Por que só o filtro de DATA sai, e só o que veio da tela.** O visual continua
 * obedecendo qualquer outro recorte (cidade, equipe) e continua obedecendo os
 * filtros da spec do relatório — o que ele ignora é a escolha de mês do seletor,
 * porque previsão e mês são grandezas incompatíveis. E ele **diz** que ignora: a
 * tela recebe uma nota e escreve no cabeçalho. Divergir do seletor em silêncio
 * seria trocar um visual vazio por um visual que mente.
 *
 * Chave é a página; valor, os ids de visual daquela página.
 */
const HORIZONTE_DE_PREVISAO: Record<string, readonly string[]> = {
  // A matriz "Último Probabilidade_Chuva_Formatada por Cidade · Data".
  'agendamento-field': ['56d3352b476659cd7972'],
};

/**
 * Este visual ignora o filtro de data da tela por mostrar horizonte de previsão?
 *
 * Ver `HORIZONTE_DE_PREVISAO`. Falso para todo o resto — é lista fechada, não
 * heurística: adivinhar "visual que filtra previsão" pelo conteúdo da spec faria
 * um visual novo passar a ignorar o seletor sem ninguém decidir isso.
 */
export function ignoraDataDaTela(pagina: string | null, visual: string): boolean {
  if (!pagina) return false;
  return (HORIZONTE_DE_PREVISAO[pagina] ?? []).includes(visual);
}

/** O texto que a tela mostra quando um visual ignora o mês do seletor. */
export const NOTA_HORIZONTE = 'horizonte de previsão · ignora o mês do seletor';

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
  if (!cfg || cfg.escopo === 'nenhum') return [];

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
