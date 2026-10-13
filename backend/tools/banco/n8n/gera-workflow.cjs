// Gera backend/tools/banco/n8n/planilhas-para-banco.json (rodar na raiz do checkout).
const fs = require('fs');

const ESC = String.raw`const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  const s = String(v).trim();
  if (s === '') return 'NULL';
  const troca = { '\0': '\\0', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\r': '\\r', '\x1a': '\\Z', '"': '\\"', "'": "\\'", '\\': '\\\\' };
  return "'" + s.replace(/[\0\b\t\n\r\x1a"'\\]/g, (c) => troca[c]) + "'";
};`;

const COMUM = ESC + String.raw`
// Acha a coluna pelo nome do cabeçalho, sem ligar para acento, maiúscula ou espaço sobrando.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const campo = (linha, nome) => {
  const alvo = norm(nome);
  for (const [k, v] of Object.entries(linha)) if (norm(k) === alvo) return v;
  return undefined;
};
const linhas = $input.all().map((i) => i.json).filter((j) => j && Object.keys(j).length > 0);`;

const INTEIRO = String.raw`
const inteiro = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
};`;

const TROCA = (tabela, colunas) => `
// PROTEÇÃO: planilha vazia (aba renomeada, Google fora) NÃO apaga a tabela — vira erro e
// vai para a data_syncs. A plataforma continua com a última cópia boa.
if (valores.length === 0) throw new Error('Planilha veio sem nenhuma linha válida — a tabela ${tabela} NÃO foi apagada.');
// Troca inteira: o nó MySQL roda todos estes comandos numa TRANSAÇÃO só (Query Batching =
// Transaction). Quem lê no meio nunca vê a tabela vazia nem pela metade.
const consultas = ['DELETE FROM ${tabela}'];
for (let i = 0; i < valores.length; i += 500) {
  consultas.push('INSERT INTO ${tabela} (${colunas}) VALUES ' +
    valores.slice(i, i + 500).map((v) => '(' + v.map(esc).join(', ') + ')').join(', '));
}
consultas.push("INSERT INTO data_syncs (source, last_success_at, last_attempt_at, row_count, last_error) " +
  "VALUES ('${tabela}', NOW(3), NOW(3), " + valores.length + ", NULL) ON DUPLICATE KEY UPDATE " +
  "last_success_at = VALUES(last_success_at), last_attempt_at = VALUES(last_attempt_at), " +
  "row_count = VALUES(row_count), last_error = NULL");
return consultas.map((query) => ({ json: { query } }));`;

const DATA = String.raw`
// DATA pode chegar como número serial do Sheets (dias desde 30/12/1899), como "13/10/2026"
// ou como "2026-10-13" — conforme a formatação da célula. As três viram AAAA-MM-DD.
const data = (v) => {
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000)).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
};`;

const PREPARA = {
  employee_managers:
    `// QUADRO FUNCIONAL → employee_managers. Das 37 colunas da planilha, SÓ nome e gestor saem
// daqui: CPF, RG, nascimento, celular e o resto de RH nunca chegam ao banco nem à plataforma.
` + COMUM + `
const valores = linhas
  .map((l) => [campo(l, 'NOME'), campo(l, 'GESTOR')])
  .filter(([nome]) => String(nome ?? '').trim() !== '');` + TROCA('employee_managers', 'employee_name, manager_name'),

  team_capacities:
    `// CAPACIDADE EQUIPE (aba STAGING) → team_capacities.
` + COMUM + DATA + INTEIRO + `
const valores = linhas
  .map((l) => [
    data(campo(l, 'DATA')),
    campo(l, 'TÉCNICO 1'),
    campo(l, 'TÉCNICO 2'),
    campo(l, 'EQUIPE'),
    campo(l, 'BASE DE ORIGEM'),
    campo(l, 'GERENTE/SUPERVISOR'),
    inteiro(campo(l, 'CAPACIDADE MANHÃ')),
    inteiro(campo(l, 'CAPACIDADE TARDE')),
  ])
  .filter(([d]) => d !== null);` +
    TROCA('team_capacities', 'capacity_date, technician_1, technician_2, team, origin_base, manager_name, morning_capacity, afternoon_capacity'),

  installer_awards:
    `// #APURAÇÃO PREMIAÇÃO → installer_awards. O cabeçalho está na LINHA 2 (a 1ª é título),
// como o relatório original lia (Table.Skip 1).
` + COMUM + INTEIRO + `
const valores = linhas
  .map((l) => [campo(l, 'INSTALADOR'), inteiro(campo(l, 'QTD.')), campo(l, 'FAIXAS')])
  .filter(([nome]) => String(nome ?? '').trim() !== '');` + TROCA('installer_awards', 'installer_name, quantity, award_band'),
};

const FALHA = (fonte) =>
  `// Algo falhou nesta planilha (Google, coluna sumida, banco fora). Nada foi apagado: só
// registra o erro na data_syncs — é o que a saúde da plataforma lê para avisar.
` + ESC + `
const e = $input.first().json;
const msg = String(e?.error?.message ?? e?.error ?? e?.message ?? 'erro desconhecido').slice(0, 480);
return [{ json: { query: "INSERT INTO data_syncs (source, last_attempt_at, last_error) VALUES ('${fonte}', NOW(3), " + esc(msg) + ") ON DUPLICATE KEY UPDATE last_attempt_at = VALUES(last_attempt_at), last_error = VALUES(last_error)" } }];`;

const CRED_SHEETS = { googleSheetsOAuth2Api: { id: '', name: 'Google Sheets (planilhas da instalação)' } };
const CRED_MYSQL = { mySql: { id: '', name: 'MariaDB — DB_InstallationDashboard' } };

const FONTES = [
  { fonte: 'employee_managers', titulo: 'QUADRO FUNCIONAL', doc: '13aqmagy60DF_KJ5I4jucJD67qlJNOzzE1g1-sdU0Gjo', aba: 'QUADRO FUNCIONAL', cabecalho: 1 },
  { fonte: 'team_capacities', titulo: 'CAPACIDADE EQUIPE', doc: '1hocqNXymH5U9NouhhcIQNOjujacdltwvS4lLA_hFGcI', aba: 'STAGING', cabecalho: 1 },
  { fonte: 'installer_awards', titulo: 'APURAÇÃO PREMIAÇÃO', doc: '1UUyahgV-Z6WJGT1U7BAQjPg1TfLxPZoKnwJoQSAcYYM', aba: '#APURAÇÃO PREMIAÇÃO', cabecalho: 2 },
];

const nodes = [];
const connections = {};
const liga = (de, para, saida = 0) => {
  connections[de] ??= { main: [] };
  while (connections[de].main.length <= saida) connections[de].main.push([]);
  connections[de].main[saida].push({ node: para, type: 'main', index: 0 });
};
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

nodes.push({
  id: id(), name: 'A cada 15 minutos', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 260],
  parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } },
});
nodes.push({
  id: id(), name: 'Leia antes de ativar', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-20, -460],
  parameters: {
    width: 760, height: 440,
    content: [
      '## Planilhas → DB_InstallationDashboard (a cada 15 min)',
      '',
      'Copia as 3 planilhas do dashboard de instalação para o MariaDB, **só com as colunas que a plataforma usa** (do QUADRO FUNCIONAL: nome e gestor — CPF, RG e o resto de RH não saem da planilha).',
      '',
      '**Antes de ativar:**',
      '1. Nos 3 nós do Google Sheets: escolha a credencial do Google que já lê essas planilhas.',
      '2. Nos 6 nós MySQL: crie/escolha a credencial **MySQL** → host `10.0.11.171`, porta `3306`, database `DB_InstallationDashboard`, usuário `installation_n8n` (quando a TI criar) ou um usuário que vocês já usam no n8n.',
      '3. Rode uma vez à mão (**Execute workflow**) e confira no DBeaver: `SELECT * FROM DB_InstallationDashboard.data_syncs;` — 3 linhas, `last_error` vazio.',
      '4. Ative o workflow.',
      '',
      '**Proteções:** cada planilha é independente (uma falhar não para as outras); planilha vazia **não apaga** a tabela; a troca é numa transação só; todo erro vai para `data_syncs.last_error`.',
    ].join('\n'),
  },
});

FONTES.forEach((f, i) => {
  const y = i * 280;
  const nSheets = `Ler ${f.titulo}`;
  const nPrepara = `Preparar ${f.fonte}`;
  const nTroca = `Trocar ${f.fonte}`;
  const nFalha = `Falha ${f.fonte}`;
  const nRegistra = `Registrar falha ${f.fonte}`;
  nodes.push({
    id: id(), name: nSheets, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: [260, y],
    alwaysOutputData: true, onError: 'continueErrorOutput',
    parameters: {
      documentId: { __rl: true, mode: 'id', value: f.doc },
      sheetName: { __rl: true, mode: 'name', value: f.aba },
      options: {
        ...(f.cabecalho !== 1
          ? { dataLocationOnSheet: { values: { rangeDefinition: 'specifyRange', headerRow: f.cabecalho, firstDataRow: f.cabecalho + 1 } } }
          : {}),
        outputFormatting: { values: { general: 'UNFORMATTED_VALUE', date: 'SERIAL_NUMBER' } },
      },
    },
    credentials: CRED_SHEETS,
  });
  nodes.push({
    id: id(), name: nPrepara, type: 'n8n-nodes-base.code', typeVersion: 2, position: [520, y], onError: 'continueErrorOutput',
    parameters: { mode: 'runOnceForAllItems', jsCode: PREPARA[f.fonte] },
  });
  nodes.push({
    id: id(), name: nTroca, type: 'n8n-nodes-base.mySql', typeVersion: 2.4, position: [780, y], onError: 'continueErrorOutput',
    parameters: { operation: 'executeQuery', query: '={{ $json.query }}', options: { queryBatching: 'transaction' } },
    credentials: CRED_MYSQL,
  });
  nodes.push({
    id: id(), name: nFalha, type: 'n8n-nodes-base.code', typeVersion: 2, position: [1040, y + 120],
    parameters: { mode: 'runOnceForAllItems', jsCode: FALHA(f.fonte) },
  });
  nodes.push({
    id: id(), name: nRegistra, type: 'n8n-nodes-base.mySql', typeVersion: 2.4, position: [1300, y + 120],
    parameters: { operation: 'executeQuery', query: '={{ $json.query }}', options: {} },
    credentials: CRED_MYSQL,
  });
  liga('A cada 15 minutos', nSheets);
  liga(nSheets, nPrepara, 0);
  liga(nSheets, nFalha, 1);
  liga(nPrepara, nTroca, 0);
  liga(nPrepara, nFalha, 1);
  liga(nTroca, nFalha, 1);
  liga(nFalha, nRegistra);
});

fs.mkdirSync('backend/tools/banco/n8n', { recursive: true });
fs.writeFileSync(
  'backend/tools/banco/n8n/planilhas-para-banco.json',
  JSON.stringify(
    {
      name: 'Dashboard Instalação — planilhas para o banco (15 min)',
      nodes,
      connections,
      active: false,
      settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' },
      pinData: {},
    },
    null,
    2,
  ) + '\n',
);
module.exports = { PREPARA, FALHA };
console.log(nodes.length, 'nós');
