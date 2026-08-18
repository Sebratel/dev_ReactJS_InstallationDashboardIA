-- Tabelas de mentira com os NOMES de verdade.
--
-- Os nomes importam e o conteúdo não: o observador resolve tabela → queries pelo
-- `source_tables` das specs, então `erp.assignment_incidents` aqui exercita o mesmo
-- caminho de mapa que `erp.assignment_incidents` no Voalle exercitaria. As colunas
-- são três inventadas — nada aqui imita dado de cliente, e nada aqui é dado real.
--
-- Escolhidas por cobrirem casos diferentes do mapa:
--   assignment_incidents  espinha do relatório, muitas queries dependem
--   contracts             cadastro, TTL longo
--   tabela_que_ninguem_usa  prova que "tabela desconhecida" aparece no relatório

CREATE SCHEMA IF NOT EXISTS erp;

CREATE TABLE erp.assignment_incidents (
  id           bigserial PRIMARY KEY,
  protocol     text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE erp.contracts (
  id           bigserial PRIMARY KEY,
  v_status     integer NOT NULL DEFAULT 1,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE erp.tabela_que_ninguem_usa (
  id           bigserial PRIMARY KEY,
  nota         text
);

-- Uma linha em cada, para o snapshot inicial do Debezium (`op: r`) ter o que ler.
INSERT INTO erp.assignment_incidents (protocol) VALUES ('SEED-0');
INSERT INTO erp.contracts (v_status) VALUES (1);
INSERT INTO erp.tabela_que_ninguem_usa (nota) VALUES ('sem query');
