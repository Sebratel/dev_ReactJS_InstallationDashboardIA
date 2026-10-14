-- O banco da plataforma: `DB_InstallationDashboard`, no MariaDB 10.0.11.171 (o mesmo do
-- `DB_Applicattion` e do `DB_ComercialDashboard`). Nomes no padrão do servidor: banco
-- `DB_<Nome>` e tabelas em inglês, snake_case, no plural (como `DB_Hub_Apps`,
-- `DB_Management_Indicators`).
--
-- Idempotente: só CREATE ... IF NOT EXISTS — rodar de novo não apaga nem altera nada, e
-- nada aqui toca outro banco do servidor. Pode ser colado no DBeaver (Ctrl+A, Alt+X) ou
-- aplicado por `npm run banco:cria` (que também cria o usuário restrito, se houver
-- credencial com GRANT OPTION).
--
-- O que mora aqui, e o que NÃO mora (ACHADOS #208):
--   - quem abre cada aba (+ pedidos de acesso e o log de toda mudança);
--   - os eventos de segurança (login, 401, 403, 429), que antes morriam com o container;
--   - as três planilhas do Google, copiadas pelo n8n a cada 15 min, SÓ com as colunas que
--     a plataforma usa — do QUADRO FUNCIONAL, nome e gestor, e nada de CPF/RG/RH.
--   O snapshot e o cache NÃO vêm para cá: em memória/Redis é que a tela é rápida.

CREATE DATABASE IF NOT EXISTS DB_InstallationDashboard
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================================
-- Acesso às abas (modelo do dashboard comercial: viewer / dev / admin)
-- ============================================================================

-- `viewer` não tem linha: é quem não está aqui.
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.user_roles (
  email      VARCHAR(254) NOT NULL PRIMARY KEY,
  role       ENUM('dev', 'admin') NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(254) NOT NULL
) ENGINE = InnoDB;

-- `screen_id` é o id da aba (`backend/specs/dashboards/*.spec.yaml`, campo `id:`). Aba sem
-- linha vale `list` vazia — só admin abre (falha fechada; no comercial nasceria aberta).
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.screens (
  screen_id   VARCHAR(64) NOT NULL PRIMARY KEY,
  access_mode ENUM('list', 'all') NOT NULL DEFAULT 'list',
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by  VARCHAR(254) NOT NULL
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.screen_users (
  screen_id  VARCHAR(64) NOT NULL,
  email      VARCHAR(254) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by VARCHAR(254) NOT NULL,
  PRIMARY KEY (screen_id, email),
  KEY by_email (email)
) ENGINE = InnoDB;

-- Quem entrou e caiu em "sem acesso". Uma linha por e-mail: tentar de novo só soma
-- `attempts`. Admin/dev aprova (dá as abas) ou dispensa pela tela "Acessos".
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.access_requests (
  email         VARCHAR(254) NOT NULL PRIMARY KEY,
  status        ENUM('pending', 'approved', 'dismissed') NOT NULL DEFAULT 'pending',
  attempts      INT UNSIGNED NOT NULL DEFAULT 1,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at   DATETIME(3) NULL,
  resolved_by   VARCHAR(254) NULL,
  KEY by_status (status, last_seen_at)
) ENGINE = InnoDB;

-- Toda mudança feita pela tela "Acessos": quem, o quê, antes e depois. Só cresce — o
-- usuário restrito da API (quando a TI o criar) terá INSERT e SELECT aqui, nunca UPDATE
-- nem DELETE.
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_email  VARCHAR(254) NOT NULL,
  action       VARCHAR(32) NOT NULL,
  target       VARCHAR(254) NULL,
  before_value TEXT NULL,
  after_value  TEXT NULL,
  KEY by_created_at (created_at)
) ENGINE = InnoDB;

-- ============================================================================
-- Eventos de segurança — o que hoje é a linha `[seg]` do log do container
-- ============================================================================
-- Gravados em lote pela API (não atrasam a resposta). Nunca guardam corpo, token, senha
-- nem valor de dado: só quem, de onde, onde e por quê.
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.security_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  event_type VARCHAR(32) NOT NULL,   -- login_ok, login_failed, unauthorized, forbidden, rate_limited, csrf, sessao_ip_mudou, sessao_derrubada, filtro_fora_da_pagina
  http_status SMALLINT UNSIGNED NULL,
  email      VARCHAR(254) NULL,
  ip         VARCHAR(45) NULL,
  method     VARCHAR(8) NULL,
  route      VARCHAR(255) NULL,
  reason     VARCHAR(64) NULL,
  KEY by_created_at (created_at),
  KEY by_email (email, created_at),
  KEY by_type (event_type, created_at)
) ENGINE = InnoDB;

-- ============================================================================
-- Planilhas do Google, copiadas pelo n8n a cada 15 min
-- ============================================================================
-- A cópia é TROCA INTEIRA dentro de uma transação (DELETE + INSERT + data_syncs, COMMIT):
-- quem lê no meio nunca vê a tabela vazia nem pela metade.

-- QUADRO FUNCIONAL: das 37 colunas da planilha (CPF, RG, nascimento, celular, ações
-- trabalhistas, antecedentes...), a plataforma usa DUAS — o nome, para cruzar com o
-- INSTALADOR da produtividade, e o gestor. Só elas entram.
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.employee_managers (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  employee_name VARCHAR(200) NOT NULL,
  manager_name  VARCHAR(200) NULL,
  synced_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY by_employee (employee_name)
) ENGINE = InnoDB;

-- CAPACIDADE EQUIPE (aba STAGING): as colunas que a plataforma usa, sem COLOR / EDITOR /
-- DATA MODIFICAÇÃO / TÉCNICO (OPCIONAL), que a carga já descartava.
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.team_capacities (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  capacity_date      DATE NOT NULL,
  technician_1       VARCHAR(200) NULL,
  technician_2       VARCHAR(200) NULL,
  team               VARCHAR(200) NULL,
  origin_base        VARCHAR(200) NULL,
  manager_name       VARCHAR(200) NULL,
  morning_capacity   INT NULL,
  afternoon_capacity INT NULL,
  synced_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY by_date (capacity_date)
) ENGINE = InnoDB;

-- #APURAÇÃO PREMIAÇÃO: INSTALADOR, QTD., FAIXAS.
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.installer_awards (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  installer_name VARCHAR(200) NOT NULL,
  quantity       INT NULL,
  award_band     VARCHAR(100) NULL,
  synced_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY by_installer (installer_name)
) ENGINE = InnoDB;

-- Uma linha por planilha: a última cópia boa, a última tentativa e o último erro. É o que
-- a saúde da plataforma lê para avisar "a planilha X parou de chegar há N horas".
CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.data_syncs (
  source          VARCHAR(64) NOT NULL PRIMARY KEY,  -- employee_managers, team_capacities, installer_awards
  last_success_at DATETIME(3) NULL,
  last_attempt_at DATETIME(3) NULL,
  row_count       INT UNSIGNED NULL,
  last_error      VARCHAR(500) NULL
) ENGINE = InnoDB;
