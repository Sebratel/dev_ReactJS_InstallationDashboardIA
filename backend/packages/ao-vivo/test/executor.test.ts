// O executor sem banco: um conector falso responde a agenda, e o teste confere que o
// SQL e os parâmetros chegaram costurados, que o catálogo do projeto não foi tocado, e
// que as colunas de grão da agenda saem calculadas como no refresh.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { QueryRegistry } from '../../query-engine/src/registry.ts';
import type { Connector, ResolvedQuery } from '../../query-engine/src/types.ts';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import { leCatalogoAoVivo } from '../src/catalogo.ts';
import {
  buscaAoVivo,
  calculadasDaQuery,
  catalogoComSql,
  fechamentoDeM,
  recortesDoPedido,
  type ContextoAoVivo,
} from '../src/executor.ts';

const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');
const registry = QueryRegistry.fromSpecsDir(SPECS);
const model = SemanticModel.fromSpecsDir(SPECS);
const catalogo = leCatalogoAoVivo(SPECS);

/** Duas linhas de agenda do mesmo protocolo, em dias diferentes — o suficiente para o rank. */
function linhasDeAgenda(): Record<string, unknown>[] {
  // `Protocolo` como texto: o `pg` devolve `bigint` como string, e o passo de tipo do M
  // (`Protocolo` → text) não converte número implicitamente.
  const linha = (slot: string) => ({
    Protocolo: '123456',
    'Tipo de Protocolo': 'TEC - Instalação',
    'Status Protocolo': 'Encerrado',
    Base: 'Base Canoas (Ativação)',
    Instalador: 'Equipe A',
    'Data Criado': new Date('2026-10-01T09:00:00Z'),
    Reagenda: null,
    'Data finalizado atendimento app': null,
    'Data primeiro Play app': null,
    'Data ultimo play app': null,
    'Prazo SLA': new Date('2026-10-30T18:00:00Z'),
    'Inicio relato': new Date(`${slot}T08:00:00Z`),
    'Fim relato': new Date(`${slot}T09:00:00Z`),
    'Slot Agenda': new Date(`${slot}T08:00:00Z`),
  });
  return [linha('2026-10-10'), linha('2026-10-14')];
}

function contexto(pedidos: { sql: string; params?: Record<string, unknown> }[]): ContextoAoVivo {
  const voalle: Connector = {
    id: 'dbVoalle',
    async execute(q: ResolvedQuery, params?: Record<string, unknown>) {
      pedidos.push({ sql: q.sql ?? '', ...(params ? { params } : {}) });
      return linhasDeAgenda();
    },
  };
  return { registry, model, catalogo, connectors: new Map([['dbVoalle', voalle]]), culture: null };
}

test('catalogoComSql troca o SQL numa cópia — o catálogo do projeto fica intacto', () => {
  const antes = registry.get('field-agenda-slot').sql;
  const copia = catalogoComSql(registry, new Map([['field-agenda-slot', 'SELECT 1']]));
  assert.equal(copia.get('field-agenda-slot').sql, 'SELECT 1');
  assert.equal(registry.get('field-agenda-slot').sql, antes);
  assert.equal(copia.get('protocolos-geral'), registry.get('protocolos-geral'), 'as outras queries são as mesmas');
});

test('os protocolos levam o recorte para as dependências pesadas, e só para elas', () => {
  const recortes = recortesDoPedido({ registry, catalogo }, { query: 'protocolos-geral', params: { protocolos: ['1'] } });
  assert.deepEqual([...recortes.keys()].sort(), ['alocacao-patrimonio', 'protocolos-geral', 'tecnicos-auxiliares', 'troca-endereco']);
  // gestores-equipes é dependência, mas não tem entrada em ao-vivo.yaml: roda inteira.
  assert.ok(fechamentoDeM(registry, 'protocolos-geral').includes('gestores-equipes'));
  for (const params of recortes.values()) assert.deepEqual(params, { protocolos: ['1'] });
});

test('dependência só leva recorte se o pedido traz TODOS os parâmetros dela', () => {
  const recortes = recortesDoPedido({ registry, catalogo }, { query: 'field-agenda-slot', params: { desde: 'a', ate: 'b' } });
  assert.deepEqual([...recortes.entries()], [['field-agenda-slot', { desde: 'a', ate: 'b' }]]);
});

test('sem parâmetros, nada é recortado', () => {
  assert.equal(recortesDoPedido({ registry, catalogo }, { query: 'protocolos-geral' }).size, 0);
});

test('calculadasDaQuery espelha o refresh: grão de slot só com as colunas de grão', () => {
  assert.deepEqual(calculadasDaQuery(model, 'field-agenda-slot'), [
    { tabela: 'FIELD AGENDA', somente: ['Data', 'RankDataProtocolo', 'RankAtualProtocolo', 'Turno', 'Status SLA'] },
  ]);
  assert.deepEqual(calculadasDaQuery(model, 'protocolos-geral'), [{ tabela: 'PROTOCOLOS GERAL' }]);
});

test('com parâmetros, o SQL chega costurado e os valores chegam por parâmetro', async () => {
  const pedidos: { sql: string; params?: Record<string, unknown> }[] = [];
  const r = await buscaAoVivo(contexto(pedidos), {
    query: 'field-agenda-slot',
    params: { desde: '2026-10-01', ate: '2026-11-01' },
    agora: new Date('2026-10-20T12:00:00Z'),
  });
  assert.equal(pedidos.length, 1);
  assert.match(pedidos[0]!.sql, /protocolos_do_periodo/);
  assert.deepEqual(pedidos[0]!.params, { desde: '2026-10-01', ate: '2026-11-01' });
  assert.equal(r.linhas.length, 2);
  assert.equal(r.buscas.length, 1);
});

test('sem parâmetros, é a consulta ORIGINAL — o lado de referência da sonda', async () => {
  const pedidos: { sql: string; params?: Record<string, unknown> }[] = [];
  await buscaAoVivo(contexto(pedidos), { query: 'field-agenda-slot', agora: new Date('2026-10-20T12:00:00Z') });
  assert.equal(pedidos[0]!.sql, registry.get('field-agenda-slot').sql);
  assert.equal(pedidos[0]!.params, undefined);
});

test('as colunas de grão da agenda saem calculadas, como o refresh grava', async () => {
  const r = await buscaAoVivo(contexto([]), {
    query: 'field-agenda-slot',
    params: { desde: '2026-10-01', ate: '2026-11-01' },
    agora: new Date('2026-10-20T12:00:00Z'),
  });
  for (const c of ['Data', 'RankDataProtocolo', 'RankAtualProtocolo', 'Turno', 'Status SLA']) {
    assert.ok(r.colunas.includes(c), `faltou a coluna calculada ${c}`);
  }
  // Dois dias do mesmo protocolo: rank 1 e 2 pela data, e o rank atual é o maior.
  const ranks = r.linhas.map((l) => Number(l['rankdataprotocolo'] ?? l['RankDataProtocolo'])).sort();
  assert.deepEqual(ranks, [1, 2]);
});

test('pedir parâmetros a uma query sem recorte em ao-vivo.yaml recusa', async () => {
  await assert.rejects(
    buscaAoVivo(contexto([]), { query: 'contratos', params: { desde: '2026-10-01' }, agora: new Date() }),
    /não tem recorte em ao-vivo\.yaml/,
  );
});
