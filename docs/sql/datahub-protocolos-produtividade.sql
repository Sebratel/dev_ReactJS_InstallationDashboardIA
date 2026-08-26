-- =============================================================================
-- Conjunto do Data Hub: PROTOCOLOS PRODUTIVIDADE
-- =============================================================================
-- Alvo: dbVoalle (PostgreSQL 13), schema `erp`. SOMENTE LEITURA.
--
-- Este SQL entrega, numa consulta só, o que hoje custa 78,8 s de banco mais 59
-- passos de camada M na aplicacao (ACHADOS #26 e #76). Ele reproduz:
--
--   1. o SELECT base de `protocolos-produtividade` (34 colunas, 21 tabelas);
--   2. o APPEND de `PROTOCOLOS AUXILIARES` -- `Table.Combine`, nao mesclagem:
--      acrescenta LINHAS. E dele que vem 35.652 -> 69.062;
--   3. as tres mesclagens com queries do mesmo banco (ALOCACAO PATRIMONIO,
--      TROCA ENDERECO, TECNICOS AUXILIARES);
--   4. as derivacoes de texto/hora que hoje sao passos de M.
--
-- NAO entrega `GESTOR`: ela vem de QUADRO FUNCIONAL, que e Google Sheets. A
-- camada M continua fazendo so esse join (2.448 linhas, e leve).
--
-- Resultado: 47 colunas. Grao: uma linha por (solicitacao x item de patrimonio),
-- nos dois ramos do append.
--
-- =============================================================================
-- ESTE SQL E O QUE RODA EM PRODUCAO DESDE 25/08/2026
-- =============================================================================
-- O Data Hub SAIU. `protocolos-produtividade` voltou a ser `datasource: dbVoalle`
-- e o campo `sql:` da spec e uma copia deste arquivo. Quem executa e o campo
-- `sql:` -- NAO o texto dentro do `Odbc.Query(...)` do `m_expression`, que so
-- nomeia o passo (ver packages/transform-engine/src/fonte.ts).
--
-- **OS NUMEROS MUDARAM, E E ESPERADO.** O DataHub aplicava uma regra mais estreita
-- e o snapshot dele estava parado em julho:
--
--                        este SQL          DataHub (ate 25/08)
--   linhas               70.757            38.864
--   protocolos           --                17.128
--   tipos de protocolo   12 + 10 (append)  10
--   dado mais recente    24/08             julho
--
--   So aqui:      TEC - Troca de Endereco (15), TEC - Instalacao de Radio (249),
--                 e os ids 279 / 1256 / 268 / 1160.
--   So no DataHub: TEC - Ativacao Diversos - CORPORATIVO, TEC - Instalacao
--                 Telefonia, TEC - Instalacao Telefonia com Portabilidade,
--                 TEC - Ativacao Transporte - CORPORATIVO, TEC - Fibra -
--                 Reativacao, TEC - Telefonia - Reativacao.
--
-- Este SQL reproduz o RELATORIO ORIGINAL do Power BI (a camada M dava 69.062; este
-- da 70.757, 2,4% de diferenca). `REALIZADOS` deixou de ser 17.128 e passou a
-- 35.035. **FALTA VALIDAR ESSES NUMEROS COM QUEM DEFINE A REGRA.**
--
-- `npm run probe:sql-conjunto` roda este arquivo contra o banco e confere colunas.
--
-- -----------------------------------------------------------------------------
-- CARGA INCREMENTAL -- NAO MEXA NESTAS DUAS LINHAS SEM LER
-- -----------------------------------------------------------------------------
-- `specs/_catalog/incremental.yaml` costura este SQL para buscar so o que mudou:
-- 190,3 s inteiro contra 24,9 s com janela de 7 dias (medido 25/08/2026,
-- `npm run probe:custo-incremental -- --costura`). A costura ancora em duas linhas
-- EXATAS deste arquivo, e por isso elas NAO sao repetidas aqui: a costura exige que
-- cada ancora apareca UMA vez, e um comentario que copiasse o texto dela ja seria a
-- segunda ocorrencia. (Aconteceu em 25/08/2026 -- a trava pegou.) As duas ancoras
-- estao escritas em `specs/_catalog/incremental.yaml`, no campo `de:`; sao a linha
-- que abre a CTE `bruto` e a linha do filtro `a.created` dentro dela.
--
-- Editar qualquer uma delas NAO quebra em silencio: a costura conta as ocorrencias
-- e derruba a carga incremental dizendo qual ancora sumiu. Mas derruba -- entao, se
-- mexer, ajuste o YAML junto.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. BRUTO -- o SELECT compartilhado pelos dois ramos do append.
--
-- Os dois ramos usam EXATAMENTE o mesmo SELECT e os mesmos 21 joins; diferem so
-- no filtro (ACHADOS #74: "duas queries sao a mesma menos dois IDs"). Entao os
-- joins sao feitos UMA vez aqui, com o filtro mais largo dos dois, e cada ramo
-- se recorta depois.
--
-- O `ROW_NUMBER` NAO pode vir aqui: no M original ele e calculado DEPOIS do
-- WHERE de cada query, sobre o conjunto ja filtrado. Calcular uma vez sobre o
-- conjunto largo daria PERSONA1 diferente e mudaria quais linhas sobrevivem.
-- Por isso ele fica em cada ramo, particionando por "SOLICITACAO" -- e a unica
-- coluna de apoio que precisa viajar ate la e `_tipo`.
-- -----------------------------------------------------------------------------
WITH bruto AS (
    SELECT
        a.title                          AS "SOLICITACAO",
        ai.protocol                      AS "N°PROTOCOLO",
        s.start_date                     AS "DATA AGENDA",
        a.modified                       AS "DATA ENCERRADO",
        a.created                        AS "DATA CRIADO",
        is2.title                        AS "STATUS",
        p.city                           AS "CIDADE",
        p.neighborhood                   AS "BAIRRO",
        p.street                         AS "RUA",
        p.number                         AS "NUMERO PATRIMÔNIO",
        p.name                           AS "CLIENTE",
        p.phone                          AS "TELEFONE",
        t.title                          AS "EQUIPE",
        ac.lat                           AS "LATITUDE",
        ac.lng                           AS "LONGITUDE",
        p2.name                          AS "RESPONSÁVEL",
        it.title                         AS "TIPO DE PROTOCOLO",
        aap.title                        AS "PONTO DE ACESSO",
        aap.code                         AS "CODIGO",
        aap.slots_first_number           AS "SLOT",
        aap.ports_first_number           AS "PORTA",
        as2.title                        AS "CTO",
        c.v_status                       AS "STATUS CONTRATO",
        c.v_stage                        AS "ESTAGIO CONTRATO",
        c.contract_number                AS "NUMERO CONTRATO",
        csi.title                        AS "ITEM",
        sc.title                         AS "CONTEXTO",
        sp.title                         AS "PROBLEMA",
        as3.title                        AS "OLT",
        m.title                          AS "EQUIPAMENTO",
        ac.user                          AS "USUÁRIO",
        vu.name                          AS "CRIADO POR",
        CASE WHEN frt.title IS NULL THEN 'Pendente' ELSE 'Cobrado' END
                                         AS "STATUS FINANCEIRO",
        -- Unica coluna de apoio: o tipo, para cada ramo se recortar. `a.created` e
        -- `a.title` NAO precisam viajar em separado -- ja saem acima como
        -- "DATA CRIADO" e "SOLICITACAO", e duplica-las inflaria o DISTINCT.
        it.id                            AS _tipo
    FROM assignment_incidents ai
    LEFT JOIN assignments                    a    ON a.id   = ai.assignment_id
    LEFT JOIN schedules                      s    ON s.assignment_id = a.id
    LEFT JOIN incident_types                 it   ON it.id  = ai.incident_type_id
    LEFT JOIN incident_status                is2  ON is2.id = ai.incident_status_id
    LEFT JOIN people                         p    ON p.id   = a.requestor_id
    LEFT JOIN teams                          t    ON t.id   = ai.team_id
    LEFT JOIN people_addresses               pa   ON pa.person_id = p.id
    LEFT JOIN authentication_contracts       ac   ON ac.people_address_id = pa.id
    LEFT JOIN people                         p2   ON p2.id  = a.responsible_id
    LEFT JOIN authentication_access_points   aap  ON aap.id = ac.authentication_access_point_id
    LEFT JOIN contract_service_tags          cst  ON cst.id = ai.contract_service_tag_id
    LEFT JOIN contracts                      c    ON cst.contract_id = c.id
    LEFT JOIN catalog_services_items         csi  ON csi.id = ai.catalog_service_item_id
    LEFT JOIN authentication_splitter_ports  asp  ON asp.authentication_contract_id = ac.id
    LEFT JOIN authentication_sites           as3  ON as3.id = aap.authentication_site_id
    LEFT JOIN manufacturers                  m    ON m.id   = aap.manufacturer_id
    LEFT JOIN solicitation_problems          sp   ON sp.id  = ai.solicitation_problem_id
    LEFT JOIN solicitation_classifications   sc   ON sc.id  = ai.solicitation_classification_id
    LEFT JOIN authentication_splitters       as2  ON as2.id = asp.authentication_splitter_id
    LEFT JOIN v_users                        vu   ON vu.id  = a.created_by
    LEFT JOIN financial_receivable_titles    frt  ON c.id   = frt.contract_id
    WHERE it.id IN ('12','1014','1254','1255','1256','1136','249','268','1160','1015','279','15')
      AND a.created >= '2026-01-01'   -- o mais largo dos dois ramos; cada um se recorta abaixo
),

-- -----------------------------------------------------------------------------
-- 2. OS DOIS RAMOS DO APPEND
--
-- ramo_produtividade: 12 tipos, a partir de 2026-01-01.
-- ramo_auxiliares:    10 tipos (sem '1256' e '279'), a partir de 2026-01-01.
--
-- **As duas datas eram diferentes ate 25/08/2026** -- o ramo auxiliares comecava em
-- 2025-01-01 e era, na faixa de data, superconjunto do outro. A regra de negocio
-- passou a ser "so 2026", entao as duas se alinham aqui e o recorte acontece no
-- banco, antes de qualquer linha viajar.
--
-- O que NAO mudou: protocolo que atende aos dois conjuntos de tipos continua
-- aparecendo DUAS vezes no resultado, porque `Table.Combine` acrescenta linhas e nao
-- mescla. Isso e do relatorio de hoje e nao se "corrige" aqui -- mudaria toda medida
-- que conta linha.
-- -----------------------------------------------------------------------------
-- O `DISTINCT` cai sobre as 33 colunas de saida, NUNCA sobre as de apoio: o
-- original faz `SELECT DISTINCT <33 colunas> ... WHERE PERSONA1 = 1`. Incluir
-- `_tipo`/`_persona` no DISTINCT o enfraqueceria e deixaria passar duplicata.
ramo_produtividade AS (
    SELECT DISTINCT
        "SOLICITACAO","N°PROTOCOLO","DATA AGENDA","DATA CRIADO","DATA ENCERRADO","STATUS",
        "CIDADE","BAIRRO","RUA","NUMERO PATRIMÔNIO","TELEFONE","CLIENTE","EQUIPE",
        "LATITUDE","LONGITUDE","RESPONSÁVEL","TIPO DE PROTOCOLO","PONTO DE ACESSO",
        "CODIGO","SLOT","PORTA","CTO","STATUS CONTRATO","ESTAGIO CONTRATO",
        "NUMERO CONTRATO","ITEM","CONTEXTO","PROBLEMA","OLT","EQUIPAMENTO","USUÁRIO",
        "CRIADO POR","STATUS FINANCEIRO"
    FROM (
        SELECT b.*, ROW_NUMBER() OVER (PARTITION BY b."SOLICITACAO" ORDER BY b."DATA AGENDA" DESC) AS _persona
        FROM bruto b
        WHERE b._tipo IN ('12','1014','1254','1255','1256','1136','249','268','1160','1015','279','15')
          AND b."DATA CRIADO" >= '2026-01-01'
    ) x WHERE x._persona = 1
),
ramo_auxiliares AS (
    SELECT DISTINCT
        "SOLICITACAO","N°PROTOCOLO","DATA AGENDA","DATA CRIADO","DATA ENCERRADO","STATUS",
        "CIDADE","BAIRRO","RUA","NUMERO PATRIMÔNIO","TELEFONE","CLIENTE","EQUIPE",
        "LATITUDE","LONGITUDE","RESPONSÁVEL","TIPO DE PROTOCOLO","PONTO DE ACESSO",
        "CODIGO","SLOT","PORTA","CTO","STATUS CONTRATO","ESTAGIO CONTRATO",
        "NUMERO CONTRATO","ITEM","CONTEXTO","PROBLEMA","OLT","EQUIPAMENTO","USUÁRIO",
        "CRIADO POR","STATUS FINANCEIRO"
    FROM (
        SELECT b.*, ROW_NUMBER() OVER (PARTITION BY b."SOLICITACAO" ORDER BY b."DATA AGENDA" DESC) AS _persona
        FROM bruto b
        WHERE b._tipo IN ('12','1014','1254','1255','1136','249','268','1160','1015','15')
          AND b."DATA CRIADO" >= '2026-01-01'
    ) x WHERE x._persona = 1
),
unificado AS (
    -- A chave de juncao com TECNICOS AUXILIARES ja sai calculada aqui, uma vez por
    -- linha. Dentro do `ON` ela seria reavaliada por par candidato e impediria
    -- hash join -- foi o que fez a consulta estourar 600 s na primeira medicao.
    SELECT u.*,
           NULLIF(regexp_replace(u."N°PROTOCOLO"::text, '\D', '', 'g'), '')::bigint AS _chave
    FROM (
        SELECT * FROM ramo_produtividade
        UNION ALL
        SELECT * FROM ramo_auxiliares
    ) u
),

-- -----------------------------------------------------------------------------
-- 3. AS TRES QUERIES MESCLADAS -- todas dbVoalle, todas ja com PERSONA = 1
-- -----------------------------------------------------------------------------

-- ALOCACAO PATRIMONIO: NAO tem PERSONA. Uma solicitacao pode ter varios itens de
-- patrimonio, e o `Table.ExpandTableColumn` do M MULTIPLICA a linha por item.
-- O LEFT JOIN abaixo reproduz isso -- e a multiplicacao e desejada.
alocacao AS (
    SELECT
        a.title             AS "SOLICITACAO",
        plis.out_date       AS "DATA SAIDA",
        plis.created        AS "DATA HORA SAIDA",
        p3.name             AS "ALOCADO POR:",
        CASE WHEN p3.outsourced IS TRUE THEN 'TERCEIRO' ELSE 'EFETIVO' END AS "POSIÇÃO"
    FROM patrimony_packing_list_items plis
    LEFT JOIN patrimony_packing_lists ppl ON ppl.id = plis.patrimony_packing_list_id
    LEFT JOIN assignments             a   ON a.id   = ppl.assignment_id
    LEFT JOIN assignment_incidents    ai  ON ai.assignment_id = a.id
    LEFT JOIN incident_types          it  ON it.id  = ai.incident_type_id
    LEFT JOIN people                  p3  ON p3.id  = plis.person_allocator_id
    WHERE it.id IN ('12','1254','1255','1014','1136','249','15','279','1015')
      -- 2026 como os protocolos: esta CTE so existe para casar com `unificado`, que
      -- agora comeca em 2026-01-01. Linha mais velha que isso nao encontra par -- ela
      -- so custaria varredura e memoria no hash join.
      AND plis.out_date > '2026-01-01'
),

-- TROCA ENDERECO: uma linha por protocolo (PERSONA1 = 1 no original).
troca AS (
    SELECT * FROM (
        SELECT
            p.name        AS "TÉCNICO",
            ai.protocol   AS "PROTOCOLO",
            r.final_date  AS "DATA DA TROCA",
            ROW_NUMBER() OVER (PARTITION BY ai.protocol ORDER BY r.final_date DESC) AS _persona
        FROM assignments a
        LEFT JOIN assignment_incidents ai ON ai.assignment_id = a.id
        LEFT JOIN reports              r  ON r.assignment_id  = a.id
        LEFT JOIN people               p  ON p.id = r.person_id
        LEFT JOIN incident_types       it ON it.id = ai.incident_type_id
        WHERE DATE(r.final_date) >= '2026-01-01'   -- idem alocacao: so casa com 2026
          AND it.id IN ('15','1256')
          AND (r.description LIKE '%O condomínio é adequado?%'
            OR r.description LIKE '%Foi feita a instalação?%')
    ) x WHERE x._persona = 1
),

-- TECNICOS AUXILIARES: uma linha por protocolo (PERSONA = 1 no original).
auxiliar AS (
    SELECT * FROM (
        SELECT
            r.tags        AS "PROTOCOLO:",
            p.name        AS "AUXILIAR",
            ROW_NUMBER() OVER (PARTITION BY r.tags ORDER BY a.final_date DESC) AS _persona
        FROM reports r
        LEFT JOIN assignments          a  ON a.id  = r.assignment_id
        LEFT JOIN assignment_incidents ai ON ai.assignment_id = a.id
        LEFT JOIN people               p  ON p.id  = r.person_id
        WHERE a.corresponding_parent_id IS NOT NULL
          AND a.assignment_type = 'RAUX'
          AND a.final_date >= '2026-01-01'   -- idem alocacao: so casa com 2026
    ) x WHERE x._persona = 1
),

-- -----------------------------------------------------------------------------
-- 4. MESCLAGEM + FILTRO DE CANCELADO
--
-- O filtro `STATUS <> 'Cancelado'` fica DEPOIS do join de patrimonio, como no M.
-- (Da no mesmo, porque LEFT JOIN nao altera STATUS -- mas manter a ordem torna a
-- conferencia passo a passo possivel.)
--
-- A chave de TECNICOS AUXILIARES compara como INTEIRO, nao como texto: medido em
-- 24/08/2026, casa 27.006 de 34.909 (77,4%) como inteiro e ZERO por especie.
-- Sem o cast o join devolve nulo em tudo. E divergencia deliberada registrada.
-- -----------------------------------------------------------------------------
mesclado AS (
    SELECT
        u.*,
        al."DATA SAIDA"        AS _data_saida,
        al."DATA HORA SAIDA"   AS _data_hora_saida,
        al."ALOCADO POR:"      AS _alocado_por,
        al."POSIÇÃO"           AS _posicao,
        tr."TÉCNICO"           AS _tecnico_troca,
        tr."DATA DA TROCA"     AS _data_troca,
        ax."AUXILIAR"          AS _auxiliar
    FROM unificado u
    LEFT JOIN alocacao al
           ON al."SOLICITACAO" = u."SOLICITACAO"
    LEFT JOIN troca tr
           ON tr."PROTOCOLO" = u."N°PROTOCOLO"
    -- `::text` antes do regexp porque os dois lados NAO tem a mesma especie no
    -- banco: `ai.protocol` e numerico e `r.tags` e texto. Foi exatamente essa
    -- diferenca que fez o join casar ZERO por especie e 77,4% como inteiro.
    LEFT JOIN auxiliar ax
           ON NULLIF(regexp_replace(ax."PROTOCOLO:"::text, '\D', '', 'g'), '')::bigint
            = NULLIF(regexp_replace(u."N°PROTOCOLO"::text, '\D', '', 'g'), '')::bigint
    WHERE u."STATUS" IS DISTINCT FROM 'Cancelado'
)

-- -----------------------------------------------------------------------------
-- 5. RESULTADO -- 47 colunas, ja com as derivacoes que hoje sao passos de M
-- -----------------------------------------------------------------------------
SELECT
    "SOLICITACAO",
    "N°PROTOCOLO",
    "CLIENTE",
    "STATUS",
    "TIPO DE PROTOCOLO",
    "EQUIPE",
    "NUMERO CONTRATO",
    "STATUS CONTRATO",
    "ESTAGIO CONTRATO",
    "STATUS FINANCEIRO",
    "TELEFONE",
    "NUMERO PATRIMÔNIO",
    "USUÁRIO",
    "CRIADO POR",
    "RUA",
    "LATITUDE",
    "LONGITUDE",
    "SLOT",
    "PORTA",

    -- datas: o M converte estas tres para `type date` (sem hora)
    "DATA CRIADO"::date                                   AS "DATA CRIADO",
    "DATA ENCERRADO"::date                                AS "DATA ENCERRADO",
    "DATA AGENDA"::date                                   AS "DATA AGENDA",
    -- ... e guarda a hora em coluna separada (DateTime.Time no M)
    "DATA CRIADO"::time                                   AS "HORA CRIADO",
    "DATA AGENDA"::time                                   AS "HORA AGENDA",

    -- Text.Proper: "PORTO ALEGRE" -> "Porto Alegre"
    initcap("CIDADE")                                     AS "CIDADE",
    initcap("BAIRRO")                                     AS "BAIRRO",

    -- SIGLA CIDADE: Replacer.ReplaceText é substituição de SUBSTRING, aplicada em
    -- cadeia sobre a CIDADE já em Text.Proper. A ordem é a do M.
    replace(replace(replace(replace(replace(replace(replace(replace(replace(
        initcap("CIDADE"),
        'Canoas','CAN'), 'São Leopoldo','SLE'), 'Novo Hamburgo','NHO'),
        'Sapucaia Do Sul','SPS'), 'Nova Santa Rita','NSR'), 'Brochier','BROCHIER'),
        'Esteio','EIO'), 'Triunfo','TRF'), 'Porto Alegre','POA')
                                                          AS "SIGLA CIDADE",

    -- INDICE 2 = BAIRRO & "/" & SIGLA CIDADE, com as duas correções literais do M
    replace(replace(
        initcap("BAIRRO") || '/' ||
        replace(replace(replace(replace(replace(replace(replace(replace(replace(
            initcap("CIDADE"),
            'Canoas','CAN'), 'São Leopoldo','SLE'), 'Novo Hamburgo','NHO'),
            'Sapucaia Do Sul','SPS'), 'Nova Santa Rita','NSR'), 'Brochier','BROCHIER'),
            'Esteio','EIO'), 'Triunfo','TRF'), 'Porto Alegre','POA'),
        'Centro - Assentamento /NSR','Centro - Assentamento/NSR'),
        'Duque De Caxias /SLE','Duque De Caxias/SLE')      AS "INDICE 2",

    -- Text.Upper + nulo -> "SEM INFORMAÇÃO"
    COALESCE(upper("RESPONSÁVEL"), 'SEM INFORMAÇÃO')      AS "RESPONSÁVEL",

    -- nulo -> "Sem Informação" (seis colunas, mesma regra no M)
    COALESCE("PONTO DE ACESSO", 'Sem Informação')         AS "PONTO DE ACESSO",
    COALESCE("ITEM",            'Sem Informação')         AS "ITEM",
    COALESCE("CONTEXTO",        'Sem Informação')         AS "CONTEXTO",
    COALESCE("PROBLEMA",        'Sem Informação')         AS "PROBLEMA",
    COALESCE("OLT",             'Sem Informação')         AS "OLT",
    COALESCE("EQUIPAMENTO",     'Sem Informação')         AS "EQUIPAMENTO",

    -- CODIGO parte-se por "-": parte 1 = POP, parte 2 = VLAN (inteiro, prefixado)
    COALESCE(NULLIF(split_part("CODIGO", '-', 1), ''), 'Sem Informação')
                                                          AS "POP",
    COALESCE('VLAN ' || NULLIF(split_part("CODIGO", '-', 2), ''), 'Sem Informação')
                                                          AS "VLAN",

    -- CTO: Text.AfterDelimiter(_,'-',1) e depois Text.BeforeDelimiter(_,'-')
    -- = o terceiro campo da divisao por "-".
    NULLIF(split_part("CTO", '-', 3), '')                 AS "CTO",

    -- vindas de ALOCACAO PATRIMONIO
    _data_saida::date                                     AS "DATA ALOCAÇÃO",
    _data_hora_saida::time                                AS "HR. ALOCAÇÃO",
    _posicao                                              AS "POSIÇÃO",
    _alocado_por                                          AS "TÉCNICO INSTALAÇÃO",

    -- vindas de TROCA ENDERECO
    _tecnico_troca                                        AS "TÉCNICO TROCA",
    -- `::date` NAO e enfeite, e a ausencia dele custou caro. A query TROCA ENDERECO
    -- termina em `Table.TransformColumnTypes(Fonte,{{"DATA DA TROCA", type date}})`, e
    -- `type date` no Power Query CORTA A HORA. Quando este SQL substituiu aquela
    -- camada M (25/08/2026), esta foi a unica das tres datas que ficou sem o cast --
    -- "DATA ALOCACAO" (linha abaixo) e "DATA FINAL" ja o tinham.
    --
    -- O estrago aparecia longe daqui: `DATA INSTALACAO` (coluna DAX) cai em
    -- [DATA DA TROCA] para os tipos de Troca de Endereco, e a matriz de
    -- `diario-instalacao` pivota por ela. Cada INSTANTE distinto virava uma coluna:
    -- 5.011 colunas em vez de ~236 dias, 476 mil celulas, 3,3 MB numa resposta so --
    -- e o navegador do usuario travando para montar a tabela.
    _data_troca::date                                     AS "DATA DA TROCA",

    -- vinda de TECNICOS AUXILIARES
    _auxiliar                                             AS "TECNICOS AUXILIARES.AUXILIAR",

    -- as duas condicionais do M, na ordem em que ele as escreve
    CASE WHEN "TIPO DE PROTOCOLO" = 'TEC - Troca de Endereço'
         THEN _tecnico_troca ELSE _alocado_por END        AS "INSTALADOR",
    CASE WHEN "TIPO DE PROTOCOLO" = 'TEC - Troca de Endereço'
         THEN _data_troca::date ELSE _data_saida::date END AS "DATA FINAL"

    -- GESTOR: NAO sai daqui. Google Sheets (QUADRO FUNCIONAL), join por
    -- upper(INSTALADOR) = upper_name. Fica na camada M.

FROM mesclado
ORDER BY "N°PROTOCOLO" DESC;
