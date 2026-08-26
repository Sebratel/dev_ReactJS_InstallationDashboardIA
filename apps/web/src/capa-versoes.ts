// Histórico de versões do painel — a parte da capa que a gente mantém.
//
// **É aqui que se registra cada mudança.** Sempre que adicionarmos algo à plataforma,
// entra uma linha nova no topo desta lista (a mais recente primeiro). A capa lê daqui e
// desenha a linha do tempo. As entradas 1.0–1.8 são o histórico herdado do painel antigo
// do Power BI; a série 2.x é a plataforma própria que o substituiu.

export interface Versao {
  versao: string;
  data: string; // dd/mm/aaaa
  alteracao: string;
  /** `nova-plataforma` destaca os marcos da migração; o resto é evolução incremental. */
  marco?: boolean;
}

export const VERSOES: readonly Versao[] = [
  {
    versao: '2.4',
    data: '20/08/2026',
    alteracao:
      'Aplicar um filtro deixou de recarregar a tela inteira: agora os números se atualizam ' +
      'no lugar, com o conteúdo anterior visível e um aviso discreto de "Atualizando…" — sem ' +
      'piscar nem voltar ao topo. Também corrigida uma reconexão em loop do canal de tempo ' +
      'real (desativado), que gerava erros repetidos em segundo plano.',
  },
  {
    versao: '2.3',
    data: '20/08/2026',
    alteracao:
      'As páginas passam a abrir já filtradas no período padrão, como no relatório original: ' +
      'Visão Geral, Agendamento Field, Diário e Protocolos Detalhados abrem no último mês ' +
      'fechado; Manutenção Inicial e Instalação/Reincidente no ano corrente. Antes abriam com ' +
      'a base inteira, o que fazia os números não baterem com o relatório do Power BI. O ' +
      'período acompanha o tempo automaticamente e continua ajustável pelos filtros.',
  },
  {
    versao: '2.2',
    data: '19/08/2026',
    alteracao:
      'Cada gráfico, tabela e matriz passa a exibir o nome que tem no relatório (ex.: ' +
      '"PROTOCOLOS POR TIPO", "PRAZO SLA", "VISÃO PRODUTIVA") no lugar dos rótulos genéricos ' +
      '"Tabela"/"Matriz". As tabelas-resumo (rótulo + quantidade) foram alinhadas lado a lado, ' +
      'como no relatório original, em vez de esticadas na largura inteira. Visuais experimentais ' +
      'de clima marcados "(TESTE)" foram retirados das telas por não serem indicadores de ' +
      'instalação.',
  },
  {
    versao: '2.1',
    data: '19/08/2026',
    alteracao:
      'Telas reorganizadas para leitura executiva: ordem filtros → indicadores → gráficos → ' +
      'detalhamento, na sequência do relatório original. Indicadores passam a mostrar apenas o ' +
      'valor real da medida (removidos comparativos fixos), porcentagens exibidas como taxa, ' +
      'matrizes largas transpostas, gráficos com título e eixo legíveis, e nova capa.',
  },
  {
    versao: '2.0',
    data: '11/08/2026',
    alteracao:
      'Nova plataforma: o painel deixa de ser um relatório do Power BI e passa a ser uma ' +
      'aplicação própria (React + API de leitura), com filtros que realmente filtram, navegação ' +
      'entre as páginas e estado compartilhável por URL.',
    marco: true,
  },
  {
    versao: '1.8',
    data: '06/07/2026',
    alteracao:
      'Adicionada coluna personalizada que agrega todos os planos que o contrato possui em uma única célula.',
  },
  {
    versao: '1.7',
    data: '08/06/2026',
    alteracao:
      "Alterado tipo de protocolo de 'TEC - Instalação de roteador (wifi) e migração de plano' para " +
      "'TEC - Instalação de roteador adicional'.",
  },
  {
    versao: '1.6',
    data: '04/05/2026',
    alteracao:
      'Ajustada a aba de manutenção inicial para coletar dados através da nova matriz da equipe de manutenção.',
  },
  {
    versao: '1.5',
    data: '13/04/2026',
    alteracao:
      'Adicionado instalador na tabela e aplicado filtro a nível de query para trazer as reincidências ' +
      'que apenas foram a campo, sem exibir mais o que foi realizado no Suporte.',
  },
  {
    versao: '1.4',
    data: '07/04/2026',
    alteracao: 'Adicionada nova aba de reincidência sobre toda a base de instalação.',
  },
  {
    versao: '1.3',
    data: '06/04/2026',
    alteracao: 'Ajustada a meta de instalação do mês (3.000 → 3.200).',
  },
  {
    versao: '1.2',
    data: '24/02/2026',
    alteracao:
      'Incluídos novos cards de cálculo de manutenções iniciais sobre o mês corrido (últimos 30 dias). ' +
      'Realizadas otimizações no painel de forma geral.',
  },
  {
    versao: '1.1',
    data: '20/02/2026',
    alteracao: 'Incluído novo tipo de solicitação: #HR - TEC - Instalação de Fibra / Equipe Ativação.',
  },
  {
    versao: '1.0',
    data: '10/02/2026',
    alteracao: 'Ajustados os dados de apuração da premiação.',
  },
];
