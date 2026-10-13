// A ordem das abas: a do relatório original (`INST - Relatório Instalação`, a ordem das
// páginas no PBIP — `QUERIES-DASHBOARD-INSTALACAO/PAGINAS.md`), com a CAPA primeiro.
//
// A API devolve as telas na ordem do nome de arquivo (`readdirSync().sort()`), e a faixa
// saía alfabética: AGENDAMENTO FIELD antes da CAPA, RELATÓRIO DO ANO antes do MÊS. Quem
// vem do Power BI procura a tela pela posição. Tela que não está aqui (uma nova) vai
// para o fim, na ordem em que chegou — nunca some.

const ORDEM: readonly string[] = [
  'capa',
  'visao-geral',
  'agendamento-field',
  'relatorio-do-mes',
  'relatorio-do-ano',
  'premiacao-instalacao',
  'diario-instalacao',
  'protocolos-detalhados',
  'telefonia-ouvidoria',
  'manutencao-inicial',
  'instalacao-reincidente',
];

export function ordenaTelas<T extends { id: string }>(telas: readonly T[]): T[] {
  const posicao = (id: string) => {
    const i = ORDEM.indexOf(id);
    return i < 0 ? ORDEM.length : i;
  };
  // `sort` é estável: as que não estão na lista mantêm a ordem de chegada entre si.
  return [...telas].sort((a, b) => posicao(a.id) - posicao(b.id));
}

/** O nome da aba: "INSTALAÇÃO/ REINCIDENTE" do PBIP vira "INSTALAÇÃO / REINCIDENTE". */
export function nomeDaAba(nome: string): string {
  return nome.replace(/\s*\/\s*/g, ' / ');
}
