-- protocolos-geral, com STATUS FINANCEIRO por EXISTS.  *** INCORPORADO EM PRODUÇÃO ***
--
-- INCORPORADO em 04/09/2026 a `specs/_catalog/queries/protocolos-geral.spec.yaml`,
-- junto com o desempate do ROW_NUMBER que este arquivo dizia faltar (ver abaixo).
-- Ver docs/SPEC-DRIVEN.md, seção "protocolos-geral — desempate do ROW_NUMBER + EXISTS",
-- e docs/ACHADOS.md #97. Este arquivo fica só como registro histórico da medição
-- original; o SQL de produção pode já ter avançado do texto abaixo.
--
-- ---------------------------------------------------------------------------
-- Texto original desta nota, de quando a reescrita ainda NÃO podia entrar:
-- ---------------------------------------------------------------------------
--
-- POR QUE ELA EXISTE
--
-- `EXPLAIN (ANALYZE)` do SQL de hoje: a consulta monta um intermediário de 13.719.336
-- linhas para devolver 98.108, e 77,1 s de custo próprio (3 workers) são um `Seq Scan`
-- em `financial_receivable_titles`, 16.563.489 linhas. Esse join de 1:N existe para UMA
-- coluna, e ela é um teste de existência.
--
-- Medido: 137,9 s -> 44,1 s (3,1x).
--
-- POR QUE ELA AINDA NÃO TINHA ENTRADO
--
-- `frt.title` é NULL em 0 de 16.563.491 linhas, e 0 contratos têm título nulo E não
-- nulo — então `EXISTS` é semanticamente EXATO para `STATUS FINANCEIRO`. O problema não
-- era essa coluna: era que tirar o join muda a multiplicidade da partição, e o
-- `ROW_NUMBER() OVER (PARTITION BY a.title ORDER BY s.start_date DESC)` **não tinha
-- critério de desempate**. Outra linha venceria, e 10 colunas (USUÁRIO, CTO, PONTO DE
-- ACESSO, CODIGO, OLT, EQUIPAMENTO, SLOT, PORTA, LATITUDE, LONGITUDE) mudavam de valor em
-- ~14% das solicitações.
--
-- E essas MESMAS 10 colunas já mudavam entre duas execuções do SQL de então, no mesmo
-- snapshot de transação: 14.090 solicitações. Ou seja, a reescrita não introduzia a
-- instabilidade — ela a herdava. Entregar os 3,1x antes de desempatar seria trocar um
-- sorteio por outro.
--
-- COMO FOI DESTRAVADO (04/09/2026)
--
-- Erick decidiu a regra primária: preferir `authentication_contracts.active = true`.
-- Medido na unidade da partição (protocolo, `a.title`): 44.746 dos 98.204 protocolos
-- têm leque, e `active=true` deixa 4.407 ambíguos.
--
-- A regra SECUNDÁRIA foi delegada a mim em 04/09 ("decida por mim"), e a resposta
-- estava no próprio SQL: `authentication_contracts` tem `contract_id`, e o bloco já
-- junta `cst` pelo próprio incidente. Casar os dois
-- (`(ac.contract_id = cst.contract_id) IS TRUE`) resolve 3.935 dos 4.407 — e nos
-- 20.821 protocolos em que as duas regras decidem sozinhas elas discordam em ZERO,
-- então acrescentá-la não muda nenhum valor que `ACTIVE TRUE` já resolvia.
-- Não pode ser primária: em 44,5% dos protocolos com leque nenhum contrato de
-- autenticação casa o contrato do protocolo.
--
-- `s.start_date DESC` (o critério do PBIP) e `ac.created DESC` seguem abaixo,
-- decidindo agora 472 protocolos em vez de 4.407. `ac.id DESC` é o piso de
-- determinismo. Detalhe e tabelas em docs/SPEC-DRIVEN.md.
--
-- Conferido com `npm run probe:determinismo-pg`: 0 solicitações divergentes
-- (era 14.090), e o caso mais extremo do banco (4 contratos ativos ao mesmo tempo)
-- escolhe o mesmo ponto de acesso em execuções repetidas.

WITH PERSONALIZADO AS (
    SELECT 
        a.title AS "SOLICITACAO",
        ai.protocol AS "N°PROTOCOLO",
        s.start_date AS "DATA AGENDA",
        a.modified AS "DATA ENCERRADO",
        a.created AS "DATA CRIADO",
        is2.title AS "STATUS",
        p.city AS "CIDADE",
        p.neighborhood AS "BAIRRO",
        p.street AS "RUA",
        p.number AS "NUMERO PATRIMÔNIO",
        p.name AS "CLIENTE",
        p.phone AS "TELEFONE",
        t.title AS "EQUIPE",
        ac.lat AS "LATITUDE",
        ac.lng AS "LONGITUDE",
        p2.name AS "RESPONSÁVEL",
        it.title AS "TIPO DE PROTOCOLO",
        aap.title AS "PONTO DE ACESSO",
        aap.code AS "CODIGO",
        aap.slots_first_number AS "SLOT",
        aap.ports_first_number AS "PORTA",  
        as2.title AS "CTO",
        c.v_status AS "STATUS CONTRATO",
        c.v_stage AS "ESTAGIO CONTRATO",
        c.contract_number AS "NUMERO CONTRATO",
        csi.title AS "ITEM",
        sc.title AS "CONTEXTO",
        sp.title AS "PROBLEMA",
        as3.title AS "OLT",
        m.title AS "EQUIPAMENTO",
        ac.user AS "USUÁRIO",
        vu.name AS "CRIADO POR",
        ROW_NUMBER() OVER (
            PARTITION BY a.title
            ORDER BY (ac.active IS TRUE) DESC,
                     ((ac.contract_id = cst.contract_id) IS TRUE) DESC,
                     s.start_date DESC NULLS LAST,
                     ac.created DESC NULLS LAST, ac.id DESC NULLS LAST
        ) AS PERSONA1,
        CASE
              WHEN EXISTS (
                  SELECT 1 FROM financial_receivable_titles frt
                  WHERE frt.contract_id = c.id AND frt.title IS NOT NULL
              ) THEN 'Cobrado'
              ELSE 'Pendente'
          END AS "STATUS FINANCEIRO"
    FROM assignment_incidents ai
    LEFT JOIN assignments a ON a.id = ai.assignment_id
    LEFT JOIN schedules s ON s.assignment_id = a.id
    LEFT JOIN incident_types it ON it.id = ai.incident_type_id
    LEFT JOIN incident_status is2 ON is2.id = ai.incident_status_id
    LEFT JOIN people p ON p.id = a.requestor_id
    LEFT JOIN teams t ON t.id = ai.team_id
    LEFT JOIN people_addresses pa ON pa.person_id = p.id
    LEFT JOIN authentication_contracts ac ON ac.people_address_id = pa.id
    LEFT JOIN people p2 ON p2.id = a.responsible_id
    LEFT JOIN authentication_access_points aap ON aap.id = ac.authentication_access_point_id
    LEFT JOIN contract_service_tags cst ON cst.id = ai.contract_service_tag_id
    LEFT JOIN contracts c ON cst.contract_id = c.id
    LEFT JOIN catalog_services_items csi ON csi.id = ai.catalog_service_item_id
    LEFT JOIN authentication_splitter_ports asp ON asp.authentication_contract_id = ac.id
    LEFT JOIN authentication_sites as3 ON as3.id = aap.authentication_site_id
    LEFT JOIN manufacturers m ON m.id = aap.manufacturer_id
    LEFT JOIN solicitation_problems sp ON sp.id = ai.solicitation_problem_id
    LEFT JOIN solicitation_classifications sc ON sc.id = ai.solicitation_classification_id
    LEFT JOIN authentication_splitters as2 ON as2.id = asp.authentication_splitter_id
    LEFT JOIN v_users vu ON vu.id = a.created_by
        WHERE it.id IN ('12', '1014', '1254', '1255', '1256', '1136', '249', '268', '1160', '1015', '279', '15') -- Filtrando os tipos de protocolo
      AND a.created >= '2025-01-01'
),
PLANOS_CONTRATO AS (
    SELECT
        c.contract_number,
        STRING_AGG(DISTINCT sp2.title, '/ ' ORDER BY sp2.title) AS "PLANO"
    FROM contracts c
    LEFT JOIN contract_service_tags cst ON cst.contract_id = c.id
    LEFT JOIN service_products sp2 ON sp2.id = cst.service_product_id
    WHERE c.contract_number IS NOT NULL
    AND cst.deleted = 'False'
    GROUP BY c.contract_number
)
SELECT DISTINCT 
    per."SOLICITACAO", 
    per."N°PROTOCOLO", 
    per."DATA AGENDA", 
    per."DATA CRIADO", 
    per."DATA ENCERRADO", 
    per."STATUS", 
    per."CIDADE", 
    per."BAIRRO",
    per."RUA", 
    per."NUMERO PATRIMÔNIO",
    per."TELEFONE", 
    per."CLIENTE", 
    per."EQUIPE", 
    per."LATITUDE", 
    per."LONGITUDE", 
    per."RESPONSÁVEL",
    per."TIPO DE PROTOCOLO",
    per."PONTO DE ACESSO",
    per."CODIGO",
    per."SLOT",
    per."PORTA",
    per."CTO",
    per."STATUS CONTRATO",
    per."ESTAGIO CONTRATO",
    per."NUMERO CONTRATO",
    per."ITEM",
    per."CONTEXTO",
    per."PROBLEMA",
    per."OLT",
    per."EQUIPAMENTO",
    per."USUÁRIO",
    per."CRIADO POR",
    per."STATUS FINANCEIRO",
    pc."PLANO"
FROM PERSONALIZADO per
LEFT JOIN PLANOS_CONTRATO pc ON pc.contract_number = per."NUMERO CONTRATO"
WHERE per.PERSONA1 = 1