#!/usr/bin/env node
// `npm run refresh` — um TICK do Refresh Manager: vê o que está vencido em
// `specs/_catalog/refresh.yaml`, roda em série (nunca em paralelo — ver o
// docstring de `tick.ts`), grava `snapshot/refresh-status.json`, e termina.
//
// **Sem daemon 24/7.** Cada disparo é um processo curto que nasce, faz o que está
// vencido nesta passada, e morre. O gatilho é externo — Agendador de Tarefas do
// Windows (ou `cron`), a cada N minutos, com "não iniciar uma nova instância" como
// segunda camada de proteção contra sobreposição (a primeira é a série dentro do
// tick — ver `tick.ts`). Um tick que falha é só aquele tick: o próximo, disparado
// pelo agendador, tenta de novo sozinho — é a mesma filosofia de `--incremental`
// (parar e reportar, não tentar se recuperar sozinho).
//
// **Por que não dentro da API, nem um daemon Node separado.** `apps/api` já se
// desenha como leitora pura de um `snapshot/` que outro ator muda — meter o
// escritor dentro do leitor borra essa fronteira, e o motor de M mantém todos os
// passos vivos ao mesmo tempo (ver tools/snapshot/src/index.ts:9-15), o mesmo
// estouro de heap que o isolamento por processo já existe para evitar. Um daemon
// 24/7 fora da API funcionaria, mas o Windows não tem PM2/systemd hoje
// (docs/DEPLOY.md, tabela de prontidão) — viraria um processo que ninguém
// reinicia sozinho se cair no meio de um ciclo. O modelo "tick" tem raio de
// explosão estritamente menor.
//
// **Este processo não carrega `Dataset` nem `SemanticModel`.** Só lê YAML/JSON e
// spawna filhos — o heap grande é problema do filho (`tools/snapshot/src/
// index.ts`), não deste orquestrador. Não precisa de `--max-old-space-size` extra.
//
// REGRA DE SAÍDA: nunca imprime valor de linha — só id de grupo, contagem e tempo.
//
// Uso:
//   npm run refresh

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../../packages/query-engine/src/config.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { leGrupos, validaGrupos, type GrupoDeRefresh } from './grupos.ts';
import { leStatus, escreveStatus } from './status.ts';
import { estaVencido, executaTick, type ResultadoDeExecucao } from './tick.ts';

for (const a of process.argv.slice(2)) {
  if (a !== '--plano') {
    console.error(`argumento desconhecido: ${a}`);
    console.error('use: --plano   (não roda nada, só diz o que rodaria)');
    process.exit(2);
  }
}
const soPlano = process.argv.includes('--plano');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

const SNAPSHOT_DIR = path.join(ROOT, DIRETORIO_PADRAO);
/** Cobre `field-agenda` (1,4 milhão de linhas) no grupo mais pesado. */
const MEMORIA_MB = 8192;

const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
const grupos = leGrupos(path.join(ROOT, 'specs'));

if (grupos.size === 0) {
  console.log('specs/_catalog/refresh.yaml não existe ou não declara grupo nenhum. Nada a fazer.');
  process.exit(0);
}

const problemas = validaGrupos(grupos, new Set(registry.queries.keys()));
if (problemas.length) {
  console.error('specs/_catalog/refresh.yaml tem problema(s) — nenhum grupo roda até corrigir:');
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(2);
}

function roda(grupo: GrupoDeRefresh): ResultadoDeExecucao {
  const argv = [
    `--max-old-space-size=${MEMORIA_MB}`,
    path.join(ROOT, 'tools', 'snapshot', 'src', 'index.ts'),
    `--memoria=${MEMORIA_MB}`,
    `--query=${grupo.queries.join(',')}`,
    '--refazer',
    ...(grupo.incremental ? ['--incremental'] : []),
  ];
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, stdio: 'inherit' });
  if (r.status === 0) return { ok: true };
  return { ok: false, erro: `saiu com código ${r.status ?? r.signal}` };
}

const statusAnterior = leStatus(SNAPSHOT_DIR);
console.log(`Refresh Manager: ${grupos.size} grupo(s) declarado(s).`);

if (soPlano) {
  const agora = new Date();
  for (const grupo of grupos.values()) {
    const vencido = estaVencido(statusAnterior[grupo.id], grupo.intervaloMinutos, agora);
    console.log(
      `  ${grupo.id}: ${vencido ? 'vencido, rodaria agora' : 'não vencido'} ` +
        `(${grupo.queries.length} query(s), a cada ${grupo.intervaloMinutos} min)`,
    );
  }
  process.exit(0);
}

const t0 = Date.now();
const { resultados } = await executaTick(grupos, statusAnterior, {
  agora: () => new Date(),
  roda,
  persiste: (status) => escreveStatus(SNAPSHOT_DIR, status),
});

console.log(`\nTick concluído em ${(Date.now() - t0).toLocaleString('pt-BR')} ms.`);
let houveFalha = false;
for (const r of resultados) {
  if (!r.vencido) {
    console.log(`  ${r.id}: não vencido — pula.`);
    continue;
  }
  console.log(
    `  ${r.id}: ${r.ok ? 'ok' : 'FALHOU'} (${r.duracaoMs} ms)` + (r.erro ? ` — ${r.erro}` : ''),
  );
  if (!r.ok) houveFalha = true;
}

process.exit(houveFalha ? 1 : 0);
