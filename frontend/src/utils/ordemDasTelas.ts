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

/**
 * O nome da aba: "INSTALAÇÃO/ REINCIDENTE" do PBIP vira "INSTALAÇÃO / REINCIDENTE".
 *
 * Sem regex de propósito: a forma anterior, um `replace` global de "espaços, barra,
 * espaços", custava O(n²) num nome só de espaços, por backtracking (regra
 * `sonarjs/super-linear-regex`). `split` mais os `trimStart`/`trimEnd` nativos fazem o
 * mesmo em uma passada. As pontas da string inteira ficam como vieram — quem só aparava
 * o espaço ao redor da barra continua fazendo isso.
 */
export function nomeDaAba(nome: string): string {
  const partes = nome.split('/');
  if (partes.length === 1) return nome;
  const ultima = partes.length - 1;
  return partes
    .map((parte, indice) => {
      const semEspacoAntes = indice === 0 ? parte : parte.trimStart();
      return indice === ultima ? semEspacoAntes : semEspacoAntes.trimEnd();
    })
    .join(' / ');
}
