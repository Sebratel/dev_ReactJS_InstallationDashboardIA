/**
 * INS · Insights de Instalação (abas "Operação ao vivo" e "Previsões", 18/11/2026).
 *
 * Consultas ao Voalle (SRD, somente leitura — o pool vem de `createVoallePool`, que já abre
 * a sessão com `default_transaction_read_only=on`). Cada uma devolve texto nas datas — o
 * Voalle guarda hora LOCAL e nenhum lado aqui deve reinterpretar fuso.
 *
 * REGRAS DE NEGÓCIO (as mesmas do Dashboard de Instalação, `INST - Relatório Instalação`):
 *  - Instalado = material ALOCADO no protocolo (`patrimony_packing_list_items.out_date`).
 *    Medido em 10/11/2026: cai no mesmo dia da primeira conexão no AutoISP em 99,7% dos casos.
 *  - Instalador = quem alocou o material (`person_allocator_id`); na troca de endereço, o
 *    técnico do relato "Foi feita a instalação?"; o auxiliar (RAUX) também ganha o protocolo.
 *  - Faixas da premiação: medida `Faixas` do relatório (protocolos distintos no mês).
 */

/** Ativação = cliente novo ligado. */
export const ATIVACAO: readonly number[] = [12, 1014, 1297, 1254, 1255, 1136, 249, 1015];
/** Movimentação = troca de endereço, migração com troca de equipamento, roteador adicional. */
export const MOVIMENTACAO: readonly number[] = [268, 279, 15, 1298, 1256];
/** Tipos que contam na premiação (lista da consulta PROTOCOLOS PRODUTIVIDADE). */
export const PREMIACAO: readonly number[] = [12, 1014, 1297, 1254, 1255, 1256, 1136, 249, 268, 1160, 1015, 279, 15, 1298];
export const TROCA: readonly number[] = [15, 1298, 1256];
/**
 * Retorno por PROBLEMA em até 30 dias = retrabalho da instalação. Fica de fora o que o
 * cliente pede (requisição, roteador adicional, troca) e a prevenção — medido em
 * set/2026, requisição sozinha era o maior grupo e não diz nada da qualidade do serviço.
 *   1267 MANUT incidente/problema · 1174 suporte técnico · 1253 pendência técnico campo
 *   1160 suporte de retorno prioritário · 1270 MANUT incidente recorrente
 */
export const RETORNO_PROBLEMA: readonly number[] = [1267, 1174, 1253, 1160, 1270];

export const Q_INSTALACOES = `
with alocado as (
  select ppl.assignment_id,
         min(plis.out_date) as data,
         min(plis.created) as lancado,
         (array_agg(plis.person_allocator_id order by plis.created, plis.id))[1] as tec_id,
         (array_agg(ppl.contract_service_tag_id order by plis.created, plis.id))[1] as cst_id
    from erp.patrimony_packing_list_items plis
    join erp.patrimony_packing_lists ppl on ppl.id = plis.patrimony_packing_list_id
   where plis.out_date >= $2::date
   group by ppl.assignment_id
)
select al.assignment_id::text as aid,
       ai.protocol::text as protocolo,
       ai.incident_type_id::int as tipo_id,
       al.data::text as data,
       to_char(al.lancado, 'HH24:MI') as hora,
       al.tec_id::int as tec_id,
       p.name as tecnico,
       coalesce(p.outsourced, false) as terceiro,
       a.created::date::text as criado,
       pr.city as cidade
  from alocado al
  join erp.assignment_incidents ai on ai.assignment_id = al.assignment_id and ai.incident_type_id = any($1::int[])
  join erp.assignments a on a.id = al.assignment_id
  left join erp.people p on p.id = al.tec_id
  left join erp.people pr on pr.id = a.requestor_id`;

export const Q_TROCAS = `
select distinct on (ai.protocol)
       ai.protocol::text as protocolo,
       ai.incident_type_id::int as tipo_id,
       r.final_date::date::text as data,
       r.person_id::int as tec_id,
       p.name as tecnico
  from erp.reports r
  join erp.assignments a on a.id = r.assignment_id
  join erp.assignment_incidents ai on ai.assignment_id = a.id
  left join erp.people p on p.id = r.person_id
 where r.final_date >= $1::date
   and ai.incident_type_id = any($2::int[])
   and (r.description like '%O condomínio é adequado?%' or r.description like '%Foi feita a instalação?%')
 order by ai.protocol, r.final_date desc`;

export const Q_AUXILIARES = `
select distinct on (r.tags)
       r.tags as protocolo,
       r.person_id::int as tec_id,
       p.name as tecnico
  from erp.reports r
  join erp.assignments a on a.id = r.assignment_id
  left join erp.people p on p.id = r.person_id
 where a.corresponding_parent_id is not null
   and a.assignment_type = 'RAUX'
   and a.final_date >= $1::date
 order by r.tags, a.final_date desc`;

/** A agenda do dia nas regiões da instalação, com o último estado do app por atendimento. */
export const Q_AGENDA = `
select s.id::int as slot_id,
       s.resource_id::int as tec_id,
       p.name as tecnico,
       s.shift::int as turno,
       to_char(s.begin_date, 'HH24:MI') as inicio,
       to_char(s.end_date, 'HH24:MI') as fim,
       s.reserved as reservado,
       (s.regions->>0)::int as regiao,
       s.reserved_assignment_id::text as aid,
       ai.protocol::text as protocolo,
       ai.incident_type_id::int as tipo_id,
       is2.title as status,
       f.routing_status::int as estado,
       f.begin_date::text as estado_desde,
       (select min(plis.out_date)::text
          from erp.patrimony_packing_lists ppl
          join erp.patrimony_packing_list_items plis on plis.patrimony_packing_list_id = ppl.id
         where ppl.assignment_id = s.reserved_assignment_id) as alocado_em
  from erp.service_desk_slots s
  left join erp.people p on p.id = s.resource_id
  left join erp.assignment_incidents ai on ai.assignment_id = s.reserved_assignment_id
  left join erp.incident_status is2 on is2.id = ai.incident_status_id
  left join lateral (
        select f.routing_status, f.begin_date
          from erp.fsm_attendance_history f
         where f.reserved_assignment_id = s.reserved_assignment_id
           and f.begin_date >= $1::date
         order by f.begin_date desc, f.id desc
         limit 1) f on s.reserved_assignment_id is not null
 where s.slot_date = $1::date
   and not coalesce(s.deleted, false)
   and (s.regions->>0)::int = any($2::int[])`;

/**
 * Último ponto de GPS de cada pessoa na última hora (app do técnico, ~1 ponto/min).
 * A tabela tem ~15 mi de linhas e não tem índice em `date`: o corte é pela PK
 * (os ~30 mil ids mais novos cobrem bem mais de um dia).
 */
export const Q_RASTREIO = `
with t as (
  select distinct on (g.person_id) g.person_id, g.latitude, g.longitude, g.date, g.assignment_id
    from erp.geolocations g
   where g.id > (select max(id) - 30000 from erp.geolocations)
     and g.date >= now()::timestamp - interval '60 minutes'
   order by g.person_id, g.id desc
)
select t.person_id::int as tec_id,
       p.name as tecnico,
       t.latitude, t.longitude,
       to_char(t.date, 'HH24:MI') as hora,
       round(extract(epoch from now()::timestamp - t.date) / 60)::int as ha_min,
       ai.protocol::text as protocolo,
       ai.incident_type_id::int as tipo_id
  from t
  join erp.people p on p.id = t.person_id
  left join erp.assignment_incidents ai on ai.assignment_id = t.assignment_id`;

/** Base de cada técnico = região da agenda onde ele mais trabalhou nos últimos 60 dias. */
export const Q_BASES = `
select s.resource_id::int as tec_id, (s.regions->>0)::int as regiao, count(*)::int as n
  from erp.service_desk_slots s
 where s.slot_date >= current_date - 60 and s.reserved and not coalesce(s.deleted, false)
 group by 1, 2`;

/** Retrabalho: cada instalação (por contrato) e se houve retorno por problema em 30 dias. */
export const Q_RETRABALHO = `
with inst as (
  select distinct on (ppl.contract_service_tag_id)
         ppl.contract_service_tag_id as cst, plis.out_date as d, plis.person_allocator_id as tec
    from erp.patrimony_packing_list_items plis
    join erp.patrimony_packing_lists ppl on ppl.id = plis.patrimony_packing_list_id
    join erp.assignment_incidents ai on ai.assignment_id = ppl.assignment_id
   where ai.incident_type_id = any($3::int[])
     and plis.out_date >= $1::date and plis.out_date < $2::date
     and ppl.contract_service_tag_id is not null
   order by ppl.contract_service_tag_id, plis.created
)
select inst.tec::int as tec_id,
       inst.d::text as data,
       exists (
         select 1
           from erp.assignment_incidents ai2
           join erp.assignments a2 on a2.id = ai2.assignment_id
          where ai2.contract_service_tag_id = inst.cst
            and ai2.incident_type_id = any($4::int[])
            and a2.created > inst.d and a2.created < inst.d + 30) as retorno
  from inst`;

/**
 * Demanda: todo protocolo de ATIVAÇÃO aberto desde `$1`, com o desfecho — instalado
 * (data), caiu (cancelado/desistência/encerrado sem material) ou ainda aberto — e
 * quantas vezes foi agendado (estado 0 do app = uma reserva de agenda).
 */
export const Q_DEMANDA = `
select a.created::date::text as criado,
       ai.incident_type_id::int as tipo_id,
       is2.title as status,
       c.v_status as contrato,
       (select min(plis.out_date)::text
          from erp.patrimony_packing_lists ppl
          join erp.patrimony_packing_list_items plis on plis.patrimony_packing_list_id = ppl.id
         where ppl.assignment_id = a.id) as instalado,
       a.modified::date::text as modificado,
       (select count(*) from erp.fsm_attendance_history f
         where f.reserved_assignment_id = a.id and f.routing_status = 0)::int as agendas
  from erp.assignment_incidents ai
  join erp.assignments a on a.id = ai.assignment_id
  left join erp.incident_status is2 on is2.id = ai.incident_status_id
  left join erp.contract_service_tags cst on cst.id = ai.contract_service_tag_id
  left join erp.contracts c on c.id = cst.contract_id
 where ai.incident_type_id = any($2::int[])
   and a.created >= $1::date`;

/** Agenda dos próximos dias: slots, reservados e livres por dia, nas regiões da instalação. */
export const Q_AGENDA_FUTURA = `
select s.slot_date::text as dia,
       count(*)::int as slots,
       count(*) filter (where s.reserved)::int as reservados,
       count(distinct s.resource_id)::int as tecnicos
  from erp.service_desk_slots s
 where s.slot_date > $1::date and s.slot_date <= $1::date + 14
   and not coalesce(s.deleted, false)
   and (s.regions->>0)::int = any($2::int[])
 group by 1
 order by 1`;

/** Tempo mediano em deslocamento (4) e em execução (5) por técnico, nos últimos 30 dias. */
export const Q_TEMPOS = `
select f.resource_id::int as tec_id,
       f.routing_status::int as estado,
       count(*)::int as n,
       percentile_cont(0.5) within group (order by extract(epoch from f.end_date - f.begin_date) / 60) as mediana_min
  from erp.fsm_attendance_history f
 where f.routing_status in (4, 5)
   and f.begin_date >= current_date - 30
   and f.end_date is not null
   and f.end_date > f.begin_date
   and f.end_date - f.begin_date < interval '6 hours'
   and f.region_id = any($1::int[])
 group by 1, 2`;
