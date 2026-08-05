#!/usr/bin/env node
// `npm run probe:gsheets` — verifica se a service account alcança as planilhas e
// perfila `QUADRO FUNCIONAL` contra a spec extraída do PBIP.
//
// Existe porque "eu tenho acesso à planilha" e "a service account tem acesso à
// planilha" são fatos diferentes, e é o segundo que o código usa. O passo que
// costuma faltar é compartilhar a planilha com o e-mail da conta de serviço como
// Leitor (passo 6 da tabela em docs/DECISAO-CAMADA-M.md, Anexo B).
//
// REGRA DE SAÍDA: é dado de RH com CPF. Imprime nome de coluna, contagem e
// cardinalidade — nunca valor de linha. Exceção: `GESTOR`, cujos nomes já estão
// na spec e são a razão desta tabela existir. Saída segura para colar em ticket.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { applyDotEnv, loadConfig } from '../../../packages/query-engine/src/config.ts';
import {
  accessToken,
  readServiceAccount,
  SCOPE_SHEETS_READONLY,
} from '../../../packages/query-engine/src/google-auth.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);
const cfg = loadConfig();

/** Nome de coluna comparável: sem acento, sem caixa, sem separador. */
const chave = (s: string): string =>
  s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[\s_-]+/g, '');

// ------------------------------------------------------------------- token
let token: string;
try {
  const sa = readServiceAccount(cfg.gsheets.credentialsPath);
  console.log(`service account: ${sa.client_email}`);
  console.log(`projeto:         ${sa.project_id ?? '(não declarado)'}`);
  token = await accessToken(sa, [SCOPE_SHEETS_READONLY]);
  console.log('token:           obtido (escopo spreadsheets.readonly)\n');
} catch (err) {
  console.error(`FALHA na credencial: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const auth = { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } };

/** Traduz os erros que realmente acontecem aqui em instrução, não em código HTTP. */
function explica(status: number, corpo: string, id: string): string {
  const msg = (JSON.parse(corpo || '{}') as { error?: { message?: string } }).error?.message ?? '';
  if (status === 403 && /Google Sheets API has not been used|disabled/i.test(msg)) {
    return `a Google Sheets API não está ativada no projeto. Ative em\n` +
      `  console.cloud.google.com → APIs e serviços → Biblioteca → Google Sheets API`;
  }
  if (status === 403) {
    return `a planilha existe, mas a service account não tem permissão. Abra a planilha\n` +
      `  → Compartilhar → cole o e-mail da conta de serviço → Leitor.\n` +
      `  (ter acesso com a sua conta Google não dá acesso à conta de serviço)`;
  }
  if (status === 404) {
    return `nenhuma planilha com id ${id}. Confira o id no .env contra a URL da planilha.`;
  }
  return msg || corpo.slice(0, 200);
}

async function pega(url: string, id: string): Promise<unknown> {
  const res = await fetch(url, auth);
  const corpo = await res.text();
  if (!res.ok) {
    console.error(`  HTTP ${res.status} — ${explica(res.status, corpo, id)}`);
    return null;
  }
  return JSON.parse(corpo);
}

// ------------------------------------------------------- acesso a cada planilha
interface Planilha { rotulo: string; id: string }
const planilhas: Planilha[] = [
  { rotulo: 'QUADRO FUNCIONAL', id: cfg.gsheets.quadroFuncionalId },
  { rotulo: '#APURAÇÃO PREMIAÇÃO', id: cfg.gsheets.apuracaoPremiacaoId },
  { rotulo: 'CAPACIDADE EQUIPE', id: cfg.gsheets.capacidadeEquipeId },
];

console.log('── Acesso ────────────────────────────────────────────');
const abasPor = new Map<string, string[]>();
for (const p of planilhas) {
  if (!p.id) {
    console.log(`  ${p.rotulo}: id não configurado no .env — pulando`);
    continue;
  }
  const meta = (await pega(
    `https://sheets.googleapis.com/v4/spreadsheets/${p.id}?fields=properties.title,sheets.properties.title`,
    p.id,
  )) as { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> } | null;
  if (!meta) {
    console.log(`  ${p.rotulo}: SEM ACESSO (acima o motivo)`);
    continue;
  }
  const abas = (meta.sheets ?? []).map((s) => s.properties?.title ?? '?');
  abasPor.set(p.rotulo, abas);
  console.log(`  ${p.rotulo}: OK — "${meta.properties?.title}", ${abas.length} aba(s): ${abas.join(', ')}`);
}

// ------------------------------------------------------- perfil de QUADRO FUNCIONAL
const idQF = cfg.gsheets.quadroFuncionalId;
if (!abasPor.has('QUADRO FUNCIONAL')) {
  console.error('\nSem acesso a QUADRO FUNCIONAL — nada a perfilar.');
  process.exit(1);
}

// O M lê a aba pelo nome: Fonte{[name="QUADRO FUNCIONAL", ItemKind="Table"]}.
// Se a aba tiver sido renomeada, o Power BI de hoje já estaria quebrado — então
// divergência aqui é achado, não detalhe.
const abas = abasPor.get('QUADRO FUNCIONAL')!;
const aba = abas.find((a) => chave(a) === chave('QUADRO FUNCIONAL')) ?? abas[0];
if (chave(aba) !== chave('QUADRO FUNCIONAL')) {
  console.log(`\n  ATENÇÃO: o M lê a aba "QUADRO FUNCIONAL"; usando "${aba}" por ser a primeira`);
}

const valores = (await pega(
  `https://sheets.googleapis.com/v4/spreadsheets/${idQF}/values/${encodeURIComponent(aba)}` +
    `?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,
  idQF,
)) as { values?: unknown[][] } | null;
if (!valores?.values?.length) {
  console.error('\nAba vazia — nada a perfilar.');
  process.exit(1);
}

// Table.PromoteHeaders: primeira linha é cabeçalho.
const [cabecalho, ...corpo] = valores.values;
const cols = cabecalho.map((c) => String(c ?? ''));
console.log(`\n── Aba "${aba}": ${cols.length} colunas, ${corpo.length} linhas de dado ──`);

const idxDe = (nome: string): number => cols.findIndex((c) => chave(c) === chave(nome));
const celula = (linha: unknown[], i: number): string =>
  i < 0 || linha[i] == null ? '' : String(linha[i]).trim();

// ---- spec vs planilha ----------------------------------------------------
const spec = yaml.parse(
  fs.readFileSync(path.join(ROOT, 'specs', '_catalog', 'queries', 'quadro-funcional.spec.yaml'), 'utf8'),
) as { m_expression?: string; url?: string };
const m = spec.m_expression ?? '';
const transform = m.match(/Table\.TransformColumnTypes\([^,]+,\{(.+?)\}\)/s)?.[1] ?? '';
const esperadas = [...transform.matchAll(/\{"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);

// A spec guarda a URL da planilha: se o id do .env for outro, todo o resto deste
// relatório está falando de outra planilha, e isso precisa gritar.
const idNaSpec = spec.url?.match(/\/d\/([\w-]+)/)?.[1];
if (idNaSpec && idNaSpec !== idQF) {
  console.log(`\n  ATENÇÃO: GSHEETS_QUADRO_FUNCIONAL_ID (${idQF}) difere do id na spec (${idNaSpec})`);
}

const faltando = esperadas.filter((e) => idxDe(e) < 0);
const naSpec = new Set(esperadas.map(chave));
const sobrando = cols.filter((c) => c && !naSpec.has(chave(c)));
console.log(`\n── Spec (${esperadas.length} colunas) vs planilha ──`);
console.log(`  casam: ${esperadas.length - faltando.length}/${esperadas.length}`);
console.log(`  faltando na planilha (${faltando.length}): ${faltando.join(', ') || '(nenhuma)'}`);
console.log(`  sobrando na planilha (${sobrando.length}): ${sobrando.join(', ') || '(nenhuma)'}`);

// ---- o filtro de gestor --------------------------------------------------
const filtro = m.match(/Table\.SelectRows[^)]*?\)\)/s)?.[0] ?? '';
const gestoresDoM = [...filtro.matchAll(/=\s*"([^"]+)"/g)].map((x) => x[1]);
const iGestor = idxDe('GESTOR');
console.log('\n── Filtro de GESTOR ──────────────────────────────────');
if (iGestor < 0) {
  console.log('  FALHA: a planilha não tem coluna GESTOR — é a única que a mesclagem expande.');
} else {
  const cont = new Map<string, number>();
  for (const l of corpo) {
    const g = celula(l, iGestor) || '(vazio)';
    cont.set(g, (cont.get(g) ?? 0) + 1);
  }
  const ordenado = [...cont].sort((a, b) => b[1] - a[1]);
  console.log(`  ${cont.size} valores distintos na coluna inteira:`);
  for (const [g, n] of ordenado.slice(0, 15)) console.log(`    ${String(n).padStart(5)}  ${g}`);
  if (ordenado.length > 15) console.log(`    … +${ordenado.length - 15} outros`);

  const ausentes = gestoresDoM.filter((e) => ![...cont.keys()].some((g) => chave(g) === chave(e)));
  console.log(`\n  os ${gestoresDoM.length} gestores que o M filtra: ${gestoresDoM.join(', ')}`);
  if (ausentes.length) {
    console.log(`  AUSENTES na planilha: ${ausentes.join(', ')} — o filtro perderia essas linhas`);
  } else {
    console.log('  todos presentes');
  }
  const passam = corpo.filter((l) =>
    gestoresDoM.some((g) => chave(celula(l, iGestor)) === chave(g)),
  );
  console.log(`  linhas que sobram após o filtro: ${passam.length} de ${corpo.length}`);

  // ---- a chave de junção -------------------------------------------------
  // PROTOCOLOS PRODUTIVIDADE faz NestedJoin por upper_name e depois expande.
  // upper_name repetido não dá erro: multiplica linha, e a medida sobe sozinha.
  const iNome = idxDe('NOME');
  console.log('\n── Chave de junção (upper_name = Text.Upper([NOME])) ──');
  if (iNome < 0) {
    console.log('  FALHA: a planilha não tem coluna NOME — sem ela não há chave.');
  } else {
    const chaves = passam.map((l) => celula(l, iNome).toUpperCase()).filter(Boolean);
    const vazios = passam.length - chaves.length;
    const cont = new Map<string, number>();
    for (const k of chaves) cont.set(k, (cont.get(k) ?? 0) + 1);
    const dups = [...cont.values()].filter((n) => n > 1);
    console.log(`  ${chaves.length} preenchidos, ${cont.size} distintos, ${vazios} vazios`);
    console.log(
      dups.length
        ? `  ${dups.length} nomes repetidos (${dups.reduce((a, b) => a + b, 0) - dups.length} linhas ` +
            'extras): a mesclagem MULTIPLICA linha nesses técnicos'
        : '  chave única: a mesclagem não multiplica linha',
    );
  }
}
