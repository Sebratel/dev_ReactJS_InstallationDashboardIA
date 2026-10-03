// O grão reduzido das colunas calculadas — saiu de `backend/tools/snapshot/src/index.ts` em
// 02/10/2026 porque o poller de tempo real precisa da MESMA declaração para calcular
// as colunas da FIELD AGENDA sobre as linhas que busca (ACHADOS #169). Duas cópias
// divergiriam no primeiro conserto.

/**
 * Colunas calculadas que dão o MESMO valor em toda linha duplicada por um `LEFT
 * JOIN` multiplicador — e a chave física que prova isso (ACHADOS #86,
 * `docs/DECISAO-GRAO-FIELD-AGENDA.md`).
 *
 * Hoje só `field-agenda`: os joins com `reports`/`people`/`skills` multiplicam cada
 * slot por (relato × skill) — 643.797 linhas onde o `vsdspi` de origem tem uma ordem
 * de grandeza a menos. Cinco das sete colunas calculadas (`Data`, `RankDataProtocolo`,
 * `RankAtualProtocolo`, `Turno`, `Status SLA`) só citam colunas que vêm do lado SEM
 * join (`vsdspi`) — `ClassificacaoRelato`/`CategoriaProdutividade` citam `Relato`
 * (`reports`) e continuam de fora, calculadas do jeito de sempre.
 *
 * `chave` é TODA coluna de origem `vsdspi` na query, não só Protocolo+Slot: duas
 * linhas iguais nelas são, por construção do `LEFT JOIN`, a mesma linha de origem
 * antes dos joins — não é uma aposta de que essas duas bastam.
 *
 * Medido ao vivo (ACHADOS #85): sem isto, `RankAtualProtocolo` sozinha custava 864s
 * — 76% do tempo total de `materializaColunas` — porque seu `FILTER` varre a tabela
 * ADOTADA inteira por linha. Adotando só as ~30 mil representantes de slot, o mesmo
 * `FILTER` varre 20× menos.
 */
export const GRAO_REDUZIDO_DE = new Map<string, { chave: string[]; colunas: string[] }>([
  [
    'field-agenda',
    {
      chave: [
        'Protocolo', 'Tipo de Protocolo', 'Status Protocolo', 'Base', 'Instalador',
        'Data Criado', 'Reagenda', 'Data finalizado atendimento app',
        'Data primeiro Play app', 'Data ultimo play app', 'Prazo SLA',
        'Inicio relato', 'Fim relato', 'Slot Agenda',
      ],
      colunas: ['Data', 'RankDataProtocolo', 'RankAtualProtocolo', 'Turno', 'Status SLA'],
    },
  ],
]);
