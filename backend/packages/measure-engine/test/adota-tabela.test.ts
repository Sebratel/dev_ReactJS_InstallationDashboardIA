// Adotar a tabela em vez de copiá-la (ACHADOS #48).
//
// `addTable` copia porque memorizar coluna calculada escreve na linha, e mexer no
// objeto de quem chamou surpreenderia. A materialização do snapshot quer o efeito
// contrário — o valor tem de cair na linha que vai ser gravada — e a cópia custa
// uma segunda `field-agenda` inteira na memória.
//
// O teste que importa é o da **chave não normalizada**: sem a conferência, o
// avaliador procuraria a coluna, não acharia, e devolveria BLANK. A coluna inteira
// viraria zero no arquivo, sem erro nenhum.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Dataset } from '../src/dataset.ts';
import { Evaluator } from '../src/evaluator.ts';
import { SemanticModel, type ModelColumn } from '../../semantic-model/src/model.ts';

function col(name: string, extra: Partial<ModelColumn> = {}): ModelColumn {
  return { name, type: null, format: null, sourceColumn: null, calculated: false, dax: null, ...extra };
}

function modelo() {
  const m = new SemanticModel();
  m.addTable({
    id: 't',
    name: 'T',
    queryRef: 'q-t',
    columns: [col('valor'), col('DOBRO', { calculated: true, dax: "'T'[valor] * 2" })],
  });
  return m;
}

test('adotaTabela não copia: as linhas do chamador são as do dataset', () => {
  const linhas = [{ valor: 3 }, { valor: 5 }];
  const d = new Dataset();
  d.adotaTabela('T', linhas as never);
  assert.equal(d.rows('T')[0], linhas[0], 'tem de ser o mesmo objeto, não uma cópia');
});

test('addTable copia — o contrato oposto continua valendo', () => {
  const linhas = [{ valor: 3 }];
  const d = new Dataset();
  d.addTable('T', linhas as never);
  assert.notEqual(d.rows('T')[0], linhas[0], 'addTable não pode passar a adotar sem querer');
});

test('a memorização da coluna calculada cai na linha do chamador', () => {
  const linhas: Record<string, unknown>[] = [{ valor: 3 }];
  const dataset = new Dataset();
  dataset.adotaTabela('T', linhas as never);
  const ev = new Evaluator({ model: modelo(), dataset, now: new Date(Date.UTC(2026, 7, 8)) });
  assert.equal(ev.columnValue('T', 'DOBRO', linhas[0] as never), 6);
  assert.equal(linhas[0]!.dobro, 6, 'o valor tem de estar na linha que o snapshot vai gravar');
});

test('chave não normalizada ERRA ALTO em vez de virar BLANK calado', () => {
  // Sem esta conferência o avaliador não acharia 'valor' (a chave é 'Valor'), e
  // 'DOBRO' sairia BLANK para a tabela inteira — número errado, sem sinal nenhum.
  const d = new Dataset();
  assert.throws(
    () => d.adotaTabela('T', [{ Valor: 3 }] as never),
    (e: Error) => {
      assert.match(e.message, /não está normalizada/);
      assert.match(e.message, /BLANK/, 'a mensagem tem de dizer qual é o estrago');
      assert.match(e.message, /addTable/, 'e qual é a saída');
      return true;
    },
  );
});

test('a conferência varre todas as linhas, não só a primeira', () => {
  // Olhar só a primeira é o atalho barato que erra na tabela cuja última linha
  // ganhou uma coluna a mais — e é exatamente onde a chave torta apareceria.
  const d = new Dataset();
  assert.throws(() => d.adotaTabela('T', [{ valor: 1 }, { valor: 2, Extra: 9 }] as never), /Extra/);
});

test('adotar duas vezes a mesma tabela erra, como addTable', () => {
  const d = new Dataset();
  d.adotaTabela('T', [{ valor: 1 }] as never);
  assert.throws(() => d.adotaTabela('T', [{ valor: 2 }] as never), /já registrada/);
});

// `temColunaFisicaPorChave` é o atalho de `columnValue` para não normalizar três
// vezes por célula lida. Ele CONFIA que as chaves já vêm normalizadas — e confiar
// sem conferir só é aceitável se a armadilha estiver fixada por teste.

test('temColunaFisicaPorChave concorda com hasPhysicalColumn quando a chave é normalizada', () => {
  const d = new Dataset();
  d.addTable('Protocolos Geral', [{ 'N°Protocolo': 1, Cidade: 'Canoas' }] as never);

  assert.ok(d.hasPhysicalColumn('PROTOCOLOS GERAL', 'CIDADE'));
  assert.ok(d.temColunaFisicaPorChave('protocolos geral', 'cidade'));
  assert.ok(d.temColunaFisicaPorChave('protocolos geral', 'n°protocolo'));

  assert.ok(!d.hasPhysicalColumn('PROTOCOLOS GERAL', 'INEXISTENTE'));
  assert.ok(!d.temColunaFisicaPorChave('protocolos geral', 'inexistente'));
  assert.ok(!d.temColunaFisicaPorChave('tabela que não existe', 'cidade'));
});

test('chave CRUA no atalho devolve false — é a armadilha que o nome do método avisa', () => {
  const d = new Dataset();
  d.addTable('Protocolos Geral', [{ Cidade: 'Canoas' }] as never);

  // Não erra: devolve `false`, e `columnValue` trataria uma coluna física como se
  // fosse calculada. Fixar aqui é o que impede alguém de "simplificar" trocando
  // `hasPhysicalColumn` por este atalho num sítio que não normalizou antes.
  assert.ok(!d.temColunaFisicaPorChave('PROTOCOLOS GERAL', 'CIDADE'));
  assert.ok(!d.temColunaFisicaPorChave('protocolos geral', 'Cidade'));
  assert.ok(!d.temColunaFisicaPorChave(' protocolos geral ', 'cidade'));

  // E a porta normal continua aceitando o nome como ele vier.
  assert.ok(d.hasPhysicalColumn(' Protocolos Geral ', ' Cidade '));
});
