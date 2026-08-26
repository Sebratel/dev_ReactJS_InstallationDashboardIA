-- Valida o GRAO da regra do DataHub reproduzida contra o dbVoalle.
-- Alvo: 38.864 linhas / 17.128 protocolos distintos (o que esta no ar hoje).
WITH bruto AS (
    SELECT
        a.title       AS solicitacao,
        ai.protocol   AS protocolo,
        s.start_date  AS data_agenda,
        a.created     AS data_criado,
        is2.title     AS status
    FROM assignment_incidents ai
    LEFT JOIN assignments     a   ON a.id  = ai.assignment_id
    LEFT JOIN schedules       s   ON s.assignment_id = a.id
    LEFT JOIN incident_types  it  ON it.id = ai.incident_type_id
    LEFT JOIN incident_status is2 ON is2.id = ai.incident_status_id
    WHERE it.id IN ('1255','1254','1005','335','41','12','1014','1136','275','1011','1060')
      AND a.created >= '2026-01-01'
),
ramo AS (
    SELECT solicitacao, protocolo, data_agenda, data_criado, status
    FROM (
        SELECT b.*, ROW_NUMBER() OVER (PARTITION BY b.solicitacao ORDER BY b.data_agenda DESC) AS persona
        FROM bruto b
    ) x WHERE x.persona = 1
),
alocacao AS (
    SELECT a.title AS solicitacao, plis.out_date, plis.created
    FROM patrimony_packing_list_items plis
    LEFT JOIN patrimony_packing_lists ppl ON ppl.id = plis.patrimony_packing_list_id
    LEFT JOIN assignments             a   ON a.id   = ppl.assignment_id
    WHERE plis.out_date > '2026-01-01'
)
SELECT
    COUNT(*)                         AS linhas,
    COUNT(DISTINCT r.protocolo)      AS protocolos,
    COUNT(DISTINCT r.solicitacao)    AS solicitacoes
FROM ramo r
LEFT JOIN alocacao al ON al.solicitacao = r.solicitacao
WHERE r.status IS DISTINCT FROM 'Cancelado';
