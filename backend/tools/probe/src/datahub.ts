#!/usr/bin/env node
// `npm run probe:datahub` — descobre o SHAPE da resposta do Data Hub para
// `QUADRO FUNCIONAL` e compara com o que a spec extraída do PBIP espera.
//
// Existe porque o connector precisa mapear campo a campo, e nome de campo errado
// não dá erro: dá coluna vazia depois, no meio de 9 medidas. Ver
// docs/DECISAO-CAMADA-M.md, Anexo A.
//
// REGRA DE SAÍDA: é dado de RH com CPF. Isto imprime nome de campo, tipo,
// contagem de nulos e cardinalidade — nunca valor de linha. A única exceção é
// `GESTOR`, cujos três nomes já estão na spec (o `Table.SelectRows` os cita
// literalmente) e que é justamente a pergunta 2 do anexo. A saída é segura para
// colar em chat/ticket, igual à do `doctor`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { applyDotEnv, loadConfig, missingFor } from '../../../packages/query-engine/src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
applyDotEnv(ROOT);

const cfg = loadConfig();
const faltando = missingFor('datahub');
if (faltando.length) {
  console.error(`Faltou no .env: ${faltando.join(', ')}. Ver .env.example.`);
  process.exit(1);
}

/** Esconde o token em qualquer texto antes de imprimir. */
const mask = (s: unknown): string =>
  cfg.datahub.token ? String(s).replaceAll(cfg.datahub.token, '<TOKEN>') : String(s);

/**
 * Chave de comparação de nome de coluna: sem acento, sem caixa, sem separador.
 * O M de hoje tem `"DATA DE NASCIMENTO "` com espaço no fim — comparar cru
 * reportaria diferença onde não há.
 */
const chave = (s: string): string =>
  s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[\s_-]+/g, '');

// -------------------------------------------------------------- a chamada
type Linha = Record<string, unknown>;
interface Envelope {
  dataset?: string;
  total?: number;
  limit?: number;
  offset?: number;
  rows?: Linha[];
}

const PAGINA = 500;
const alvo = `${cfg.datahub.baseUrl}/datasets/${encodeURIComponent(cfg.datahub.datasets.quadroFuncional)}/rows`;
console.log(`GET ${alvo}?limit=${PAGINA}&offset=…`);
console.log('auth: header X-Api-Token (não query string — token em URL vaza para log)');

async function pagina(offset: number): Promise<Envelope> {
  const url = new URL(alvo);
  url.searchParams.set('limit', String(PAGINA));
  url.searchParams.set('offset', String(offset));
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'X-Api-Token': cfg.datahub.token },
    });
  } catch (err) {
    console.error(`FALHA de rede: ${mask(err instanceof Error ? err.message : err)}`);
    return process.exit(1);
  }
  const corpo = await res.text();
  if (!res.ok) {
    console.error(`\nHTTP ${res.status} ${res.statusText} — ${mask(corpo.slice(0, 300))}`);
    if (res.status === 403) {
      console.error(
        '403 = token reconhecido, sem acesso a este conjunto (o escopo do token não o inclui).\n' +
          'Conjunto inexistente é 404, e ainda não sincronizado é 409. Corpo que não é JSON\n' +
          'não veio da API: é o proxy do nome público (use o endereço interno).',
      );
    }
    return process.exit(1);
  }
  try {
    return JSON.parse(corpo) as Envelope;
  } catch (err) {
    console.error(`resposta não é JSON: ${err instanceof Error ? err.message : err}`);
    return process.exit(1);
  }
}

const t0 = process.hrtime.bigint();
const primeira = await pagina(0);
const linhas: Linha[] = [...(primeira.rows ?? [])];
const total = primeira.total ?? linhas.length;
// Pagina por offset até bater o `total` em vez de mandar um `limit` gigante:
// o servidor hoje honra qualquer limit, mas isso é um detalhe que pode mudar
// sem aviso, e a diferença apareceria como gente faltando numa medida.
while (linhas.length < total) {
  const p = await pagina(linhas.length);
  if (!p.rows?.length) break; // fonte parou de devolver: não insista
  linhas.push(...p.rows);
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

console.log('\n── Envelope ───────────────────────────────────────────');
for (const [k, v] of Object.entries(primeira)) {
  console.log(`  ${k}: ${Array.isArray(v) ? `array[${v.length}]` : JSON.stringify(v)}`);
}
console.log(
  `\n── ${linhas.length} linhas (de total=${total}) em ${Math.ceil(total / PAGINA)} páginas, ${ms.toFixed(0)}ms ──`,
);
if (linhas.length !== total) {
  console.log(`  ATENÇÃO: buscou ${linhas.length}, envelope diz ${total}`);
}
if (!linhas.length) {
  console.error('Nenhuma linha — nada a inspecionar.');
  process.exit(1);
}

// -------------------------------------------------------------- campos
// Varre TODAS as linhas: campo que só aparece na linha 900 também conta, e é
// exatamente o que um `slice(0, 5)` deixaria passar.
interface Perfil {
  tipos: Set<string>;
  nulos: number;
  vazios: number;
  distintos: Set<unknown>;
}
const campos = new Map<string, Perfil>();
for (const linha of linhas) {
  for (const [k, v] of Object.entries(linha)) {
    let p = campos.get(k);
    if (!p) {
      p = { tipos: new Set(), nulos: 0, vazios: 0, distintos: new Set() };
      campos.set(k, p);
    }
    if (v === null || v === undefined) {
      p.nulos++;
      continue;
    }
    if (v === '') {
      p.vazios++;
      continue;
    }
    p.tipos.add(Array.isArray(v) ? 'array' : typeof v);
    if (p.distintos.size <= 60) p.distintos.add(typeof v === 'object' ? '{obj}' : v);
  }
}

console.log(`\n── ${campos.size} campos ─────────────────────────────────`);
console.log('  campo | tipos | nulos | vazios | distintos');
for (const [k, p] of campos) {
  const tipos = [...p.tipos].join(',') || '(sempre nulo/vazio)';
  console.log(
    `  ${k} | ${tipos} | ${p.nulos} | ${p.vazios} | ${p.distintos.size > 60 ? '>60' : p.distintos.size}`,
  );
}

// -------------------------------------------------------------- spec vs API
// As colunas esperadas saem da spec GERADA, não de uma lista digitada aqui: se
// alguém mexer no Power Query, `npm run extract` reescreve a spec e esta sonda
// acompanha sozinha.
const specPath = path.join(ROOT, 'backend', 'specs', '_catalog', 'queries', 'quadro-funcional.spec.yaml');
const spec = yaml.parse(fs.readFileSync(specPath, 'utf8')) as { m_expression?: string };
const m = spec.m_expression ?? '';
const transform = m.match(/Table\.TransformColumnTypes\([^,]+,\{(.+?)\}\)/s)?.[1] ?? '';
const esperadas = [...transform.matchAll(/\{"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);

console.log(`\n── Spec (${esperadas.length} colunas do Table.TransformColumnTypes) vs API ──`);
const daApi = new Map([...campos.keys()].map((k) => [chave(k), k]));
const casando: Array<[string, string]> = [];
const faltandoNaApi: string[] = [];
for (const e of esperadas) {
  const achou = daApi.get(chave(e));
  if (achou) casando.push([e, achou]);
  else faltandoNaApi.push(e);
}
console.log(`  casam: ${casando.length}/${esperadas.length}`);
for (const [e, a] of casando) if (e !== a) console.log(`  grafia diferente: spec "${e}" ← api "${a}"`);
console.log(`  faltando na API (${faltandoNaApi.length}): ${faltandoNaApi.join(', ') || '(nenhuma)'}`);
const usadas = new Set(casando.map(([, a]) => chave(a)));
const sobrando = [...campos.keys()].filter((k) => !usadas.has(chave(k)));
console.log(`  sobrando na API (${sobrando.length}): ${sobrando.join(', ') || '(nenhuma)'}`);

// -------------------------------------------------------------- filtro de gestor
// Pergunta 2 do Anexo A: o filtro já vem aplicado, ou precisa ser replicado?
const filtro = m.match(/Table\.SelectRows[^)]*?\)\)/s)?.[0] ?? '';
const gestoresDoM = [...filtro.matchAll(/=\s*"([^"]+)"/g)].map((x) => x[1]);
const colGestor = [...campos.keys()].find((k) => /gestor/i.test(k));

console.log('\n── Filtro de GESTOR ──────────────────────────────────');
if (!colGestor) {
  console.log(`  FALHA: nenhum campo com "gestor" no nome. O M filtra por ${gestoresDoM.length} gestores`);
  console.log('  e sem essa coluna o filtro não tem como ser replicado.');
} else {
  const cont = new Map<string, number>();
  for (const l of linhas) {
    const g = l[colGestor] == null ? '(nulo)' : String(l[colGestor]);
    cont.set(g, (cont.get(g) ?? 0) + 1);
  }
  console.log(`  campo "${colGestor}", ${cont.size} valores distintos:`);
  for (const [g, n] of [...cont].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(6)}  ${g}`);
  }
  const presentes = gestoresDoM.filter((e) => [...cont.keys()].some((g) => chave(g) === chave(e)));
  const ausentes = gestoresDoM.filter((e) => !presentes.includes(e));
  console.log(`\n  dos ${gestoresDoM.length} gestores que o M cita, presentes: ${presentes.length}`);
  if (ausentes.length) console.log(`  AUSENTES: ${ausentes.join(', ')} — replicar o filtro perderia linha`);
  const jaFiltrado = cont.size <= gestoresDoM.length && presentes.length === cont.size;
  console.log(
    jaFiltrado
      ? '  → a fonte JÁ vem filtrada; o Table.SelectRows seria redundante'
      : '  → a fonte vem COMPLETA; o Table.SelectRows precisa ser replicado depois de buscar',
  );
}

// -------------------------------------------------------------- domínios
// Só campos de baixa cardinalidade e que não identificam ninguém: rótulo de
// status, nome de time, centro de custo. Isto é dado organizacional, e é o que
// permite conversar com quem publica o dataset sem colar planilha de RH em chat.
const PESSOAIS = /name|cpf|email|rg|celular|nascimento|birth|key|id$|registration/i;
console.log('\n── Domínios dos campos categóricos ───────────────────');
for (const [k, p] of campos) {
  if (PESSOAIS.test(k) || p.distintos.size > 30 || p.distintos.size === 0) continue;
  const cont = new Map<string, number>();
  for (const l of linhas) {
    const v = l[k] == null || l[k] === '' ? '(vazio)' : String(l[k]);
    cont.set(v, (cont.get(v) ?? 0) + 1);
  }
  console.log(`  ${k} (${cont.size}):`);
  for (const [v, n] of [...cont].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(6)}  ${v}`);
  }
}

// -------------------------------------------------------------- duplicidade
// A mesclagem dentro de PROTOCOLOS PRODUTIVIDADE casa por colaborador. Chave
// repetida ali não dá erro: multiplica linha, e a medida sobe sem ninguém ver.
const chaveNatural = ['CPF', 'ID', 'MATRÍCULA'].map((n) => daApi.get(chave(n))).filter(Boolean) as string[];
console.log('\n── Unicidade das chaves candidatas ───────────────────');
for (const k of chaveNatural) {
  const vals = linhas.map((l) => l[k]).filter((v) => v !== null && v !== undefined && v !== '');
  const distintos = new Set(vals.map(String)).size;
  const dup = vals.length - distintos;
  console.log(
    `  ${k}: ${vals.length} preenchidos, ${distintos} distintos` +
      (dup ? `  ← ${dup} repetidos (mesclagem multiplicaria linha)` : '  ← única'),
  );
}
