// Quais queries alimentam tabela calculada — o conjunto que decide QUANDO congelar.
//
// **O teste que importa é o do grão reduzido**, e ele existe porque o erro já foi
// cometido. Em 18/09/2026 a previsão do ACHADOS #140 mapeou tabela→query só por
// `queryRef` e concluiu que o grupo `frio` do refresh não alimentava calculada
// nenhuma. `FIELD AGENDA` tem DUAS queries (`backend/specs/_catalog/projecao.yaml`), e a
// padrão — `field-agenda-slot` — está justamente no `frio`. A conclusão foi publicada
// errada e corrigida por medição ao vivo no mesmo dia.
//
// O segundo em importância é o `seguro: false`. Congelar cedo só é correto quando a
// origem de TODA calculada é apurável; se uma só não for, vale a régua conservadora de
// `confereIdadeDaCalculada` e qualquer query posterior a envelheceria de novo.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticModel } from '../../semantic-model/src/model.ts';
import type { ModelColumn } from '../../semantic-model/src/types.ts';
import { queriesQueAlimentamCalculada } from '../src/tabelas-calculadas.ts';

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

/** `OS` e `ALMOXARIFADO` vêm de query; `CIDADES` nasce de DAX sobre `OS`. */
function modelo(): SemanticModel {
  const m = new SemanticModel();
  m.addTable({ id: 'os', name: 'OS', queryRef: 'q-os', columns: [col('CIDADE')] });
  m.addTable({ id: 'alm', name: 'ALMOXARIFADO', queryRef: 'q-alm', columns: [col('ITEM')] });
  m.addTable({
    id: 'cid', name: 'CIDADES', queryRef: null,
    tableDax: "DISTINCT('OS'[CIDADE])",
    columns: [col('CIDADE', { sourceColumn: 'CIDADE' })],
  });
  return m;
}

test('só a query da origem entra — a alheia fica de fora', () => {
  const r = queriesQueAlimentamCalculada(modelo());
  assert.equal(r.seguro, true);
  assert.deepEqual([...r.queries].sort(), ['q-os']);
});

/**
 * **O caso que custou uma conclusão errada.** A tabela de origem tem duas queries, e
 * a que o carregamento usa por padrão depende do pedido. As DUAS têm de entrar: quem
 * chama precisa saber que qualquer uma delas envelhece a calculada.
 */
test('grão reduzido: as DUAS queries da origem entram, não só queryRef', () => {
  const m = modelo();
  m.graoReduzido = [{
    tabela: 'OS',
    queryPadrao: 'q-os-slot',
    queryCompleta: 'q-os',
    colunasGatilho: ['RELATO'],
    decidido: '2026-09-02', por: 'teste', porque: 'o caso do ACHADOS #140',
  }];
  const r = queriesQueAlimentamCalculada(m);
  assert.equal(r.seguro, true);
  assert.deepEqual([...r.queries].sort(), ['q-os', 'q-os-slot'],
    'mapear só por queryRef perderia q-os-slot, e foi exatamente esse o erro');
});

/**
 * Origem não apurável derruba o conjunto INTEIRO, não só aquela tabela: quem chama
 * usa isto para decidir se pode congelar cedo, e congelar cedo com uma calculada de
 * origem desconhecida a deixaria velha sem ninguém para corrigir.
 */
test('DAX que não faz parse devolve seguro:false e não deixa congelar cedo', () => {
  const m = modelo();
  m.addTable({
    id: 'quebrada', name: 'QUEBRADA', queryRef: null,
    tableDax: 'DISTINCT(((((',
    columns: [col('X')],
  });
  const r = queriesQueAlimentamCalculada(m);
  assert.equal(r.seguro, false, 'uma origem desconhecida contamina a decisão toda');
});

test('modelo sem tabela calculada: conjunto vazio, mas seguro', () => {
  const m = new SemanticModel();
  m.addTable({ id: 'os', name: 'OS', queryRef: 'q-os', columns: [col('CIDADE')] });
  const r = queriesQueAlimentamCalculada(m);
  assert.equal(r.seguro, true);
  assert.equal(r.queries.size, 0);
});
