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
test('as divergências declaradas em backend/specs/ aplicam ao modelo real', async () => {
  const { SemanticModel } = await import('../src/model.ts');
  const model = SemanticModel.fromSpecsDir('backend/specs');

  const ids = model.divergencias.map((a) => a.divergencia.id).sort();
  assert.deepEqual(ids, ['peso-criado-domingo', 'peso-instalado-fim-de-semana']);

  // A régua revista em 09/11/2026: sábado 1, domingo 0, feriado 0 (tabela FERIADOS e
  // o 20/11), igual nas duas tabelas.
  for (const tabela of ['CALENDARIO INSTALADO', 'CALENDARIO CRIADO']) {
    const dax = model.column(tabela, 'PESO')!.dax!;
    assert.match(dax, /SWITCH\(DiaDaSemana, 7, 0, 1\)/, `${tabela}: domingo 0 e sábado 1`);
    assert.match(dax, /LOOKUPVALUE\(FERIADOS\[Feriado\]/, `${tabela}: feriado pela tabela FERIADOS`);
    assert.match(dax, /Dia = DATE\(YEAR\(Dia\), 11, 20\)/, `${tabela}: o 20/11 conta como feriado`);
  }

  // E toda divergência tem de dizer de onde veio.
  for (const a of model.divergencias) {
    assert.match(a.divergencia.pergunta, /^PERGUNTAS-NEGOCIO#\d+$/);
    assert.ok(a.divergencia.porque.length > 40, `${a.divergencia.id}: 'porque' curto demais`);
  }
});

// ---------------------------------------------------------------------------
// A régua do PESO, revista em 09/11/2026.
// ---------------------------------------------------------------------------
//
// De 08/08 a 09/11/2026 o PESO deu sábado 0,5 e domingo 0,5 — uma decisão que ficou
// registrada errada. Na Instalação o sábado é dia cheio e o domingo não conta, que é
// a régua que o Power BI já usava; a régua do comercial (sábado 0,5) não vale aqui.
// O que diverge do Power BI agora é só o feriado de 20/11, que a lista embutida no
// PBIP não tem.

/** A régua decidida em 09/11/2026. `semana` no padrão WEEKDAY(_, 2): 1=segunda, 7=domingo. */
const pesoDecidido = (semana: number): number => (semana === 7 ? 0 : 1);

/** Soma a janela sob a régua, zerando os dias-do-mês que são feriado. */
const soma = (dias: readonly { dia: number; semana: number }[], feriados: ReadonlySet<number>): number =>
  dias.reduce((a, d) => a + (feriados.has(d.dia) ? 0 : pesoDecidido(d.semana)), 0);

/** Dias de um mês: `primeiro` é o dia-da-semana do dia 1 (WEEKDAY(_, 2)). */
const mes = (primeiro: number, tamanho: number) =>
  Array.from({ length: tamanho }, (_, i) => ({ dia: i + 1, semana: ((primeiro - 1 + i) % 7) + 1 }));

test('PESO: domingo 0, sábado e dia de semana 1', () => {
  assert.equal(pesoDecidido(7), 0);
  for (const d of [1, 2, 3, 4, 5, 6]) assert.equal(pesoDecidido(d), 1);
});

test('PESO: novembro/2026 — 5 até 08/11, 18 restantes, 23 no mês', () => {
  // 01/11/2026 é domingo. Feriados: 02/11 (Finados), 15/11 (Proclamação, domingo) e
  // 20/11 (Consciência Negra, sexta).
  const novembro = mes(7, 30);
  const feriados = new Set([2, 15, 20]);
  assert.equal(soma(novembro.filter((d) => d.dia <= 8), feriados), 5, 'DIAS TRABALHADOS até 08/11');
  assert.equal(soma(novembro.filter((d) => d.dia >= 9), feriados), 18, 'DIAS ÚTEIS RESTANTES a partir de 09/11');
  assert.equal(soma(novembro, feriados), 23, 'dias úteis no mês');
});

test('PESO: a única diferença para o Power BI é o 20/11 — um dia a menos em novembro', () => {
  const novembro = mes(7, 30);
  const comoPowerBI = soma(novembro, new Set([2, 15]));
  const decidido = soma(novembro, new Set([2, 15, 20]));
  assert.equal(comoPowerBI - decidido, 1);

});
