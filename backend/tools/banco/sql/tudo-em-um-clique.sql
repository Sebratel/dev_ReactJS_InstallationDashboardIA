-- TUDO EM UM CLIQUE: schema.sql + usuarios.sql num único bloco (`BEGIN NOT ATOMIC ... END`,
-- MariaDB 10.1+), que o DBeaver executa como UM comando — selecione tudo (Ctrl+A) e
-- Ctrl+Enter. Sem depender do Alt+X.
--
-- Idempotente: só IF NOT EXISTS. Não apaga, não altera e não toca outro banco nem outro
-- usuário. Quem roda precisa de GRANT OPTION (a TI) por causa da parte dos usuários. Troque
-- as três senhas antes de rodar.
BEGIN NOT ATOMIC
  CREATE DATABASE IF NOT EXISTS DB_InstallationDashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

  -- Acesso às abas
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.user_roles (
    email VARCHAR(254) NOT NULL PRIMARY KEY,
    role ENUM('dev','admin') NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    updated_by VARCHAR(254) NOT NULL
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.screens (
    screen_id VARCHAR(64) NOT NULL PRIMARY KEY,
    access_mode ENUM('list','all') NOT NULL DEFAULT 'list',
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    updated_by VARCHAR(254) NOT NULL
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.screen_users (
    screen_id VARCHAR(64) NOT NULL,
    email VARCHAR(254) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by VARCHAR(254) NOT NULL,
    PRIMARY KEY (screen_id, email),
    KEY by_email (email)
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.access_requests (
    email VARCHAR(254) NOT NULL PRIMARY KEY,
    status ENUM('pending','approved','dismissed') NOT NULL DEFAULT 'pending',
    attempts INT UNSIGNED NOT NULL DEFAULT 1,
    first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    resolved_at DATETIME(3) NULL,
    resolved_by VARCHAR(254) NULL,
    KEY by_status (status, last_seen_at)
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    actor_email VARCHAR(254) NOT NULL,
    action VARCHAR(32) NOT NULL,
    target VARCHAR(254) NULL,
    before_value TEXT NULL,
    after_value TEXT NULL,
    KEY by_created_at (created_at)
  ) ENGINE=InnoDB;

  -- Segurança
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.security_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    event_type VARCHAR(32) NOT NULL,
    http_status SMALLINT UNSIGNED NULL,
    email VARCHAR(254) NULL,
    ip VARCHAR(45) NULL,
    method VARCHAR(8) NULL,
    route VARCHAR(255) NULL,
    reason VARCHAR(64) NULL,
    KEY by_created_at (created_at),
    KEY by_email (email, created_at),
    KEY by_type (event_type, created_at)
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.screen_usage_daily (
    day DATE NOT NULL,
    screen_id VARCHAR(64) NOT NULL,
    email VARCHAR(254) NOT NULL,
    opens INT UNSIGNED NOT NULL DEFAULT 0,
    last_opened_at DATETIME(3) NOT NULL,
    PRIMARY KEY (day, screen_id, email),
    KEY by_screen (screen_id, day)
  ) ENGINE=InnoDB;

  -- Planilhas (n8n a cada 15 min), só com as colunas usadas
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.employee_managers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    employee_name VARCHAR(200) NOT NULL,
    manager_name VARCHAR(200) NULL,
    synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY by_employee (employee_name)
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.team_capacities (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    capacity_date DATE NOT NULL,
    technician_1 VARCHAR(200) NULL,
    technician_2 VARCHAR(200) NULL,
    team VARCHAR(200) NULL,
    origin_base VARCHAR(200) NULL,
    manager_name VARCHAR(200) NULL,
    morning_capacity INT NULL,
    afternoon_capacity INT NULL,
    synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY by_date (capacity_date)
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.installer_awards (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    installer_name VARCHAR(200) NOT NULL,
    quantity INT NULL,
    award_band VARCHAR(100) NULL,
    synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY by_installer (installer_name)
  ) ENGINE=InnoDB;
  CREATE TABLE IF NOT EXISTS DB_InstallationDashboard.data_syncs (
    source VARCHAR(64) NOT NULL PRIMARY KEY,
    last_success_at DATETIME(3) NULL,
    last_attempt_at DATETIME(3) NULL,
    row_count INT UNSIGNED NULL,
    last_error VARCHAR(500) NULL
  ) ENGINE=InnoDB;

  -- Usuários de privilégio mínimo (exige GRANT OPTION). Não altera nenhum usuário existente.
  CREATE USER IF NOT EXISTS 'installation_reader'@'%' IDENTIFIED BY 'TROQUE_SENHA_1';
  GRANT SELECT ON DB_Applicattion.* TO 'installation_reader'@'%';
  GRANT SELECT ON DB_InstallationDashboard.employee_managers TO 'installation_reader'@'%';
  GRANT SELECT ON DB_InstallationDashboard.team_capacities   TO 'installation_reader'@'%';
  GRANT SELECT ON DB_InstallationDashboard.installer_awards  TO 'installation_reader'@'%';
  GRANT SELECT ON DB_InstallationDashboard.data_syncs        TO 'installation_reader'@'%';

  CREATE USER IF NOT EXISTS 'installation_access'@'%' IDENTIFIED BY 'TROQUE_SENHA_2';
  GRANT SELECT, INSERT, UPDATE, DELETE ON DB_InstallationDashboard.user_roles      TO 'installation_access'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON DB_InstallationDashboard.screens         TO 'installation_access'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON DB_InstallationDashboard.screen_users    TO 'installation_access'@'%';
  GRANT SELECT, INSERT, UPDATE         ON DB_InstallationDashboard.access_requests TO 'installation_access'@'%';
  GRANT SELECT, INSERT                 ON DB_InstallationDashboard.audit_logs      TO 'installation_access'@'%';
  GRANT SELECT, INSERT                 ON DB_InstallationDashboard.security_events TO 'installation_access'@'%';
  GRANT SELECT, INSERT, UPDATE         ON DB_InstallationDashboard.screen_usage_daily TO 'installation_access'@'%';

  CREATE USER IF NOT EXISTS 'installation_n8n'@'%' IDENTIFIED BY 'TROQUE_SENHA_3';
  GRANT SELECT, INSERT, DELETE ON DB_InstallationDashboard.employee_managers TO 'installation_n8n'@'%';
  GRANT SELECT, INSERT, DELETE ON DB_InstallationDashboard.team_capacities   TO 'installation_n8n'@'%';
  GRANT SELECT, INSERT, DELETE ON DB_InstallationDashboard.installer_awards  TO 'installation_n8n'@'%';
  GRANT SELECT, INSERT, UPDATE ON DB_InstallationDashboard.data_syncs        TO 'installation_n8n'@'%';
END
