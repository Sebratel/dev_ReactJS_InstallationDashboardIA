-- PARTE 2 — para a TI (exige GRANT OPTION; o DevSebratel e o usuário atual da API não
-- têm). Rodar DEPOIS do schema.sql. Troque as três senhas antes de rodar.
--
-- Cria três usuários NOVOS, cada um com o mínimo. Não altera nenhum usuário existente:
-- o MARIA_USER de hoje é compartilhado por outros sistemas (medido em 13/10/2026: conexões
-- de 8 origens, inclusive IPs públicos) e continua como está. Só o .env do dashboard troca.
--
-- Host '%': o servidor vê esta máquina como 192.168.214.168 (não 10.x), e a API ainda vai
-- para o Portainer, de IP a definir. A proteção principal é o privilégio mínimo + senha
-- forte; quando o IP final existir, a TI pode trocar '%' por ele.

-- 1) Leitura do dashboard: substitui o MARIA_USER no .env do dashboard. É o ganho grande —
--    a API deixa de carregar uma credencial com ALL PRIVILEGES no servidor inteiro.
CREATE USER IF NOT EXISTS 'installation_reader'@'%' IDENTIFIED BY 'TROQUE_SENHA_1' REQUIRE SSL;
GRANT SELECT ON DB_Applicattion.* TO 'installation_reader'@'%';
GRANT SELECT ON DB_InstallationDashboard.employee_managers TO 'installation_reader'@'%';
GRANT SELECT ON DB_InstallationDashboard.team_capacities   TO 'installation_reader'@'%';
GRANT SELECT ON DB_InstallationDashboard.installer_awards  TO 'installation_reader'@'%';
GRANT SELECT ON DB_InstallationDashboard.data_syncs        TO 'installation_reader'@'%';

-- 2) Acessos da API: a tela "Acessos" e os eventos de segurança. Logs só aceitam inclusão.
CREATE USER IF NOT EXISTS 'installation_access'@'%' IDENTIFIED BY 'TROQUE_SENHA_2' REQUIRE SSL;
GRANT SELECT, INSERT, UPDATE, DELETE ON DB_InstallationDashboard.user_roles      TO 'installation_access'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON DB_InstallationDashboard.screens         TO 'installation_access'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON DB_InstallationDashboard.screen_users    TO 'installation_access'@'%';
GRANT SELECT, INSERT, UPDATE         ON DB_InstallationDashboard.access_requests TO 'installation_access'@'%';
GRANT SELECT, INSERT                 ON DB_InstallationDashboard.audit_logs      TO 'installation_access'@'%';
GRANT SELECT, INSERT                 ON DB_InstallationDashboard.security_events TO 'installation_access'@'%';
GRANT SELECT, INSERT, UPDATE         ON DB_InstallationDashboard.screen_usage_daily TO 'installation_access'@'%';

-- 3) n8n: só as três tabelas das planilhas e o registro da cópia. Não lê acesso nem
--    eventos de segurança, e não alcança outro banco.
CREATE USER IF NOT EXISTS 'installation_n8n'@'%' IDENTIFIED BY 'TROQUE_SENHA_3' REQUIRE SSL;
GRANT SELECT, INSERT, DELETE         ON DB_InstallationDashboard.employee_managers TO 'installation_n8n'@'%';
GRANT SELECT, INSERT, DELETE         ON DB_InstallationDashboard.team_capacities   TO 'installation_n8n'@'%';
GRANT SELECT, INSERT, DELETE         ON DB_InstallationDashboard.installer_awards  TO 'installation_n8n'@'%';
GRANT SELECT, INSERT, UPDATE         ON DB_InstallationDashboard.data_syncs        TO 'installation_n8n'@'%';

-- Conferência: cada um tem de listar só o que está acima.
SHOW GRANTS FOR 'installation_reader'@'%';
SHOW GRANTS FOR 'installation_access'@'%';
SHOW GRANTS FOR 'installation_n8n'@'%';
