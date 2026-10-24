// A comparação da página ao vivo com a do snapshot, e as travas do modo sombra.
//
// A comparação diz QUAL visual e ONDE (quantas linhas, quais colunas), nunca o valor: o
// log da sombra vai para o `docker logs`, e a página tem nome e endereço de cliente.
// A sombra nunca atrasa nem derruba o pedido: decide na hora, roda uma por vez, não
// repete a mesma pergunta, e engole o próprio erro.

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { leAgregadasAoVivo, leCatalogoAoVivo } from '../../packages/ao-vivo/src/catalogo.ts';
import { QueryRegistry } from '../../packages/query-engine/src/registry.ts';
import type { Connector } from '../../packages/query-engine/src/types.ts';
import { SemanticModel } from '../../packages/semantic-model/src/model.ts';
import { codificaFiltro, decodificaFiltros } from '../../packages/widget-engine/src/filtro-url.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import type { PaginaCalculada, VisualCalculado } from '../src/calcula.ts';
import { comparaPaginas, juntaPaginas } from '../src/pagina-ao-vivo.ts';
import { SombraAoVivo, type ObservacaoDaSombra } from '../src/sombra-ao-vivo.ts';

const SPECS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'specs');

const visual = (id: string, dados: unknown, extra: Partial<VisualCalculado> = {}): VisualCalculado => ({
  id,
  tipo: 'tableEx',
  posicao: { x: 0, y: 0, z: 0, width: 1, height: 1 } as VisualCalculado['posicao'],
  conteudo: 'tabela',
  dados,
  ms: Math.random() * 100,
  ...extra,
});
const pagina = (visuais: VisualCalculado[]): PaginaCalculada => ({
  id: 'agendamento-field',
  nome: 'Agendamento',
  tamanho: null as unknown as PaginaCalculada['tamanho'],
  dadoDe: null,
  visuais,
  resumo: { calculados: visuais.length, falharam: 0, semCalculo: 0 },
  ms: 1,
});
const tabela = (linhas: unknown[][]) => ({ colunas: [{ nome: 'Base' }, { nome: 'Cliente' }], linhas, linhasTotais: linhas.length });

test('igual é igual mesmo com outro tempo de cálculo; ordem, valor, erro e ausência aparecem pela forma', () => {
  const ref = pagina([
    visual('a', tabela([['Canoas', 'SEGREDO-1'], ['Gravataí', 'SEGREDO-2']])),
    visual('b', tabela([['Canoas', 'SEGREDO-1'], ['Gravataí', 'SEGREDO-2']])),
    visual('c', tabela([['Canoas', 'SEGREDO-1']])),
    visual('d', { valor: 10 }, { conteudo: 'card' }),
    visual('e', { valor: 1 }, { conteudo: 'card' }),
    visual('f', { valor: 1 }, { conteudo: 'card' }),
  ]);
  const vivo = pagina([
    visual('a', tabela([['Canoas', 'SEGREDO-1'], ['Gravataí', 'SEGREDO-2']])),
    visual('b', tabela([['Gravataí', 'SEGREDO-2'], ['Canoas', 'SEGREDO-1']])),
    visual('c', tabela([['Canoas', 'SEGREDO-9']])),
    visual('d', undefined, { conteudo: 'card', erro: 'SEGREDO-ERRO' }),
    visual('f', { valor: 2 }, { conteudo: 'card' }),
  ]);
  const c = comparaPaginas(ref, vivo, new Map([['f', 'fora de propósito']]));
  assert.equal(c.comparados, 5);
  assert.equal(c.fora, 1);
  assert.equal(c.iguais, 1);
  assert.deepEqual(c.soOrdem.map((d) => d.id), ['b'], 'empate reordenado não é número diferente');
  assert.match(c.soOrdem[0]!.porque, /linhas: os mesmos 2 em outra ordem/);
  assert.deepEqual(c.diferentes.map((d) => d.id), ['c', 'd', 'e']);
  const porque = new Map([...c.diferentes, ...c.soOrdem].map((d) => [d.id, d.porque]));
  assert.match(porque.get('c')!, /linhas: 1 só na referência, 1 só ao vivo .*colunas com valor diferente: Cliente$/);
  assert.equal(porque.get('d'), 'erro só ao vivo');
  assert.equal(porque.get('e'), 'ausente ao vivo');
  for (const p of porque.values()) assert.doesNotMatch(p, /SEGREDO/, 'nenhum valor nem mensagem de erro no motivo');
});

test('a página volta inteira na ordem do relatório: os ao vivo e os de fora, do snapshot', () => {
  const alvo = { ...loadDashboards(SPECS).find((d) => d.id === 'agendamento-field')!, visuals: [] as never[] };
  const ids = ['a', 'b', 'c', 'd'];
  const alvoComVisuais = { ...alvo, visuals: ids.map((id) => ({ id })) as never };
  const vivo = pagina([visual('a', 1), visual('c', 3)]);
  const doSnapshot = { ...pagina([visual('b', 2)]), resumo: { calculados: 1, falharam: 1, semCalculo: 2 } };
  const junta = juntaPaginas(alvoComVisuais, vivo, doSnapshot);
  assert.deepEqual(junta.visuais.map((v) => v.id), ['a', 'b', 'c'], 'na ordem do alvo; o que ninguém trouxe não é inventado');
  assert.deepEqual(junta.resumo, { calculados: 3, falharam: 1, semCalculo: 2 });
  assert.equal(junta.id, 'agendamento-field');
});

// ------------------------------------------------------------------ a sombra

const model = SemanticModel.fromSpecsDir(SPECS);
const dash = loadDashboards(SPECS).find((d) => d.id === 'agendamento-field')!;
const AGORA = new Date('2026-10-23T15:00:00Z');

function sombra(): { s: SombraAoVivo; contas: Map<string, number>; linhas: string[]; pedidos: number[] } {
  const contas = new Map<string, number>();
  const linhas: string[] = [];
  const pedidos: number[] = [];
  const recusa: Connector = {
    id: 'dbVoalle',
    async execute() {
      pedidos.push(1);
      throw new Error('conexão recusada\nSEGREDO na segunda linha');
    },
  };
  const s = new SombraAoVivo({
    ctx: {
      registry: QueryRegistry.fromSpecsDir(SPECS),
      model,
      catalogo: leCatalogoAoVivo(SPECS),
      connectors: new Map([['dbVoalle', recusa]]),
      culture: null,
    },
    model,
    relatosDoDia: leAgregadasAoVivo(SPECS).get('relatos-do-dia')!,
    snapshotDir: '/nao/existe',
    registra: (l) => linhas.push(l),
    conta: (n, q) => contas.set(n, (contas.get(n) ?? 0) + q),
  });
  return { s, contas, linhas, pedidos };
}

const observacao = (mes: string, pagina_ = dash): ObservacaoDaSombra => {
  const daTela = decodificaFiltros([
    codificaFiltro({ tabela: 'calendar', coluna: 'Data', nivel: 'Ano', valores: [2026] }),
    codificaFiltro({ tabela: 'calendar', coluna: 'Data', nivel: 'Mês', valores: [mes] }),
  ]);
  return {
    dash: pagina_,
    alvo: { ...pagina_, filters: [...(pagina_.filters ?? []), ...daTela] },
    daTela,
    janela: { de: 0, linhas: 200 },
    clicados: [],
    agora: AGORA,
    pagina: pagina([]),
  };
};

test('a sombra só roda período fechado da página da fase 1, uma por vez, sem repetir a pergunta', async () => {
  const { s, contas, pedidos } = sombra();

  s.observa(observacao('setembro', { ...dash, id: 'outra-pagina' }));
  assert.equal(s.emCurso, null, 'outra página: nem decide');

  s.observa(observacao('outubro'));
  assert.equal(contas.get('sombra_periodo_aberto'), 1, 'o mês corrente diverge por idade, não por regra');
  assert.equal(s.emCurso, null);

  s.observa(observacao('setembro'));
  const rodada = s.emCurso;
  assert.ok(rodada, 'setembro fechou: roda em segundo plano');
  s.observa(observacao('agosto'));
  assert.equal(contas.get('sombra_ocupada'), 1, 'uma rodada por vez');
  await rodada;
  assert.ok(pedidos.length > 0, 'chegou a perguntar ao banco');

  s.observa(observacao('setembro'));
  assert.equal(contas.get('sombra_repetida'), 1, 'a mesma pergunta não roda de novo dentro do intervalo');
  assert.equal(s.emCurso, null);
});

test('o erro da rodada vira uma linha de log e uma métrica — sem valor e sem derrubar ninguém', async () => {
  const { s, contas, linhas } = sombra();
  assert.doesNotThrow(() => s.observa(observacao('setembro')));
  const r = await s.emCurso;
  assert.equal(r, null);
  assert.equal(contas.get('sombra_rodadas'), 1);
  assert.equal(contas.get('sombra_erro'), 1);
  assert.equal(linhas.length, 1);
  assert.match(linhas[0]!, /^\[ao-vivo\] sombra agendamento-field falhou \(a resposta da tela não muda\): .*conexão recusada/);
  assert.doesNotMatch(linhas[0]!, /SEGREDO/, 'só a primeira linha da mensagem');
});
