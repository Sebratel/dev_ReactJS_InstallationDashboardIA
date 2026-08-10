// Divergência deliberada: o mecanismo que permite discordar do Power BI sem editar
// arquivo gerado — e sem discordar em silêncio.
//
// **Os testes que importam são os três de erro alto.** Uma substituição de DAX que
// falha calada é pior que não ter mecanismo nenhum: o relatório serviria uma fórmula
// que ninguém escolheu, e a spec regenerada esconderia isso. Cada `throw` aqui existe
// porque o silêncio no lugar dele produz número plausível e errado.

import assert from 'node:assert/strict';
import test from 'node:test';
import { aplicaDivergencias, shaDeDax, type Divergencia } from '../src/divergencias.ts';

const ORIGINAL = 'IF([DiaDaSemana] = 7, 0, 1)';
const NOVO = 'IF([DiaDaSemana] >= 6, 0.5, 1)';

function divergencia(extra: Partial<Divergencia> = {}): Divergencia {
  return {
    id: 'peso-fds',
    tipo: 'coluna',
    tabela: 'CALENDARIO',
    objeto: 'PESO',
    pergunta: 'PERGUNTAS-NEGOCIO#1',
    decidido: '2026-08-08',
    porque: 'equipe reduzida no fim de semana',
    original_sha: shaDeDax(ORIGINAL),
    dax: NOVO,
    ...extra,
  };
}

/** Modelo mínimo: só o que `aplicaDivergencias` toca. */
function modelo(dax: string | null = ORIGINAL, calculated = true) {
  const col = { calculated, dax };
  return {
    col,
    column: (t: string, c: string) => (t === 'CALENDARIO' && c === 'PESO' ? col : null),
    measure: () => null,
  };
}

test('substitui o DAX e devolve o original', () => {
  const m = modelo();
  const [a] = aplicaDivergencias(m, [divergencia()]);
  assert.equal(m.col.dax, NOVO);
  assert.equal(a!.original, ORIGINAL);
  assert.equal(a!.divergencia.id, 'peso-fds');
});

// ---------------------------------------------------------------------------
// Os três erros altos
// ---------------------------------------------------------------------------

/**
 * O guarda que dá sentido a todos os outros. Sem ele, alguém conserta a fórmula no
 * Power BI, `npm run extract` traz a versão nova, e este arquivo a descarta em
 * silêncio para aplicar um remendo decidido contra outra fórmula — para sempre.
 */
test('DAX original mudou desde a decisão: ERRA ALTO e manda reler a pergunta', () => {
  const m = modelo('IF([DiaDaSemana] = 7, 0, 1) // corrigido no PBI');
  assert.throws(
    () => aplicaDivergencias(m, [divergencia()]),
    /decidida contra um DAX que mudou.*PERGUNTAS-NEGOCIO#1.*original_sha/s,
  );
  assert.equal(m.col.dax, 'IF([DiaDaSemana] = 7, 0, 1) // corrigido no PBI', 'não pode ter aplicado');
});

test('objeto que não existe mais: ERRA ALTO nomeando a pergunta', () => {
  const m = modelo();
  assert.throws(
    () => aplicaDivergencias(m, [divergencia({ objeto: 'PESO_QUE_SUMIU' })]),
    /não existe no modelo.*PERGUNTAS-NEGOCIO#1/s,
  );
});

test('objeto sem DAX: ERRA ALTO — trocar fórmula de coluna física não quer dizer nada', () => {
  const m = modelo(null, false);
  assert.throws(() => aplicaDivergencias(m, [divergencia()]), /não tem\s+DAX/s);
});

/**
 * O sha ignora reindentação de propósito: reformatar o DAX no Power BI não muda o que
 * ele calcula, e invalidar a decisão por causa de um espaço seria um alarme que ensina
 * a ignorar alarmes. Mas mudar a conta tem de invalidar.
 */
test('o sha ignora espaço em branco, e não ignora mudança de conta', () => {
  // Reindentar e quebrar linha não muda a conta; o sha normaliza corridas de branco.
  // (Não normaliza a **posição** do branco: `a ,` e `a,` seguem sendo textos
  // diferentes. É conservador para o lado certo — no máximo pede uma releitura a mais.)
  assert.equal(shaDeDax('IF(a,\n   1,\n   0)'), shaDeDax('  IF(a, 1, 0)  '));
  assert.notEqual(shaDeDax('IF(a, 1, 0)'), shaDeDax('IF(a, 1, 2)'));
});

// ---------------------------------------------------------------------------
// O arquivo real
// ---------------------------------------------------------------------------

/**
 * As divergências de verdade, aplicadas ao modelo de verdade.
 *
 * Este teste falha de duas maneiras úteis: se alguém apagar uma decisão sem reabrir a
 * pergunta, e se `npm run extract` trouxer um PESO diferente do que foi decidido — aí
 * o `original_sha` erra alto e a mensagem chega antes do número errado.
 */
test('as divergências declaradas em specs/ aplicam ao modelo real', async () => {
  const { SemanticModel } = await import('../src/model.ts');
  const model = SemanticModel.fromSpecsDir('specs');

  const ids = model.divergencias.map((a) => a.divergencia.id).sort();
  assert.deepEqual(ids, ['peso-criado-domingo', 'peso-instalado-fim-de-semana']);

  // A regra decidida em 08/08/2026: sábado e domingo valem 0,5 nas duas tabelas.
  for (const tabela of ['CALENDARIO INSTALADO', 'CALENDARIO CRIADO']) {
    const dax = model.column(tabela, 'PESO')!.dax!;
    assert.match(dax, /DiaDaSemana >= 6, 0\.5/, `${tabela}: o fim de semana tem de valer 0,5`);
  }

  // E toda divergência tem de dizer de onde veio.
  for (const a of model.divergencias) {
    assert.match(a.divergencia.pergunta, /^PERGUNTAS-NEGOCIO#\d+$/);
    assert.ok(a.divergencia.porque.length > 40, `${a.divergencia.id}: 'porque' curto demais`);
  }
});
