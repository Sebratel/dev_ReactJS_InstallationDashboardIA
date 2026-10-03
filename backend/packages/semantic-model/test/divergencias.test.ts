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

// ---------------------------------------------------------------------------
// Por que os dois cards de PESO podem bater com o Power BI sem que nada esteja
// quebrado.
// ---------------------------------------------------------------------------
//
// A paridade de 11/08/2026 acusou `divergencia-nao-aplicada` em
// `DIAS TRABALHADOS NO MÊS` (8) e `DIAS ÚTEIS RESTANTES NO MÊS` (18): os dois
// batiam exatamente com o Power BI, e card marcado `divergente:` que bate é falha
// por desenho. Parecia que a decisão do PESO tinha ficado no papel.
//
// Não tinha. A coluna PESO do snapshot traz domingo 0,5 e sábado 0,5, como
// decidido. O que acontece é aritmética:
//
//     nossa regra    sáb 0,5 + dom 0,5 = 1,0
//     regra antiga   sáb 1,0 + dom 0,0 = 1,0
//
// **Um fim de semana COMPLETO vale o mesmo nas duas.** As medidas somam PESO sobre
// uma janela de datas, e as duas janelas de agosto/2026 têm só fins de semana
// inteiros (01–10 tem dois, 11–31 tem três). Os cards são cegos para a decisão.
//
// Isto não é motivo para afrouxar o harness: ele está certo em dizer que aquele
// card não prova o que se esperava dele. É motivo para saber quando o card serve
// de testemunha — e é isso que este teste fixa.

/** A regra decidida em 08/08/2026. Feriado zera; fim de semana vale meio dia. */
const pesoDecidido = (diaDaSemana: number): number => (diaDaSemana >= 6 ? 0.5 : 1);

/** A regra que o Power BI aplica: sábado é dia cheio, domingo não existe. */
const pesoPowerBI = (diaDaSemana: number): number =>
  diaDaSemana === 6 ? 1 : diaDaSemana === 7 ? 0 : 1;

/** Soma a janela sob uma regra. `dias` são dias-da-semana no padrão WEEKDAY(_, 2). */
const soma = (dias: readonly number[], regra: (d: number) => number): number =>
  dias.reduce((a, d) => a + regra(d), 0);

/** Uma janela de `n` dias começando na `inicio`-ésima posição da semana (1=segunda). */
const janela = (inicio: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => ((inicio - 1 + i) % 7) + 1);

test('PESO: fim de semana completo vale o mesmo nas duas regras — o card fica cego', () => {
  // Sábado + domingo: 0,5+0,5 contra 1+0.
  assert.equal(soma([6, 7], pesoDecidido), 1);
  assert.equal(soma([6, 7], pesoPowerBI), 1);

  // Semana inteira, e qualquer múltiplo dela.
  for (const semanas of [1, 2, 3, 8]) {
    const dias = janela(1, 7 * semanas);
    assert.equal(
      soma(dias, pesoDecidido),
      soma(dias, pesoPowerBI),
      `${semanas} semana(s) inteira(s) não distinguem as regras`,
    );
  }
});

test('PESO: as duas janelas reais de agosto/2026 são cegas — e por quê', () => {
  // 01/08/2026 é sábado; 11/08/2026 é terça. Conferido contra o calendário
  // materializado em snapshot/calc.calendario-instalado.jsonl.
  const trabalhados = janela(6, 10); // 01 a 10/08 — sáb .. seg
  const restantes = janela(2, 21); // 11 a 31/08 — ter .. seg

  assert.equal(soma(trabalhados, pesoDecidido), 8, 'DIAS TRABALHADOS NO MÊS');
  assert.equal(soma(trabalhados, pesoPowerBI), 8, 'e o Power BI mostra 8');

  assert.equal(soma(restantes, pesoDecidido), 18, 'DIAS ÚTEIS RESTANTES NO MÊS');
  assert.equal(soma(restantes, pesoPowerBI), 18, 'e o Power BI mostra 18');

  // A causa, dita como condição e não como coincidência.
  for (const dias of [trabalhados, restantes]) {
    const sabados = dias.filter((d) => d === 6).length;
    const domingos = dias.filter((d) => d === 7).length;
    assert.equal(sabados, domingos, 'a janela tem fins de semana emparelhados');
  }
});

test('PESO: janela com sábado ou domingo solto DISTINGUE as regras', () => {
  // É esta a condição: as duas regras divergem se, e só se, a janela tiver
  // sábados e domingos em número diferente. Um card sobre uma janela assim
  // serviria de testemunha — os dois de agosto/2026 não servem.
  const soSabado = [5, 6]; // sexta e sábado
  assert.equal(soma(soSabado, pesoDecidido), 1.5);
  assert.equal(soma(soSabado, pesoPowerBI), 2);

  const soDomingo = [7, 1]; // domingo e segunda
  assert.equal(soma(soDomingo, pesoDecidido), 1.5);
  assert.equal(soma(soDomingo, pesoPowerBI), 1);

  // E a diferença é exatamente meio dia por dia solto, com o sinal do lado que sobra.
  for (let n = 1; n <= 6; n += 1) {
    const dias = janela(6, n); // começa no sábado, corta antes de fechar a semana
    const sabados = dias.filter((d) => d === 6).length;
    const domingos = dias.filter((d) => d === 7).length;
    const esperado = 0.5 * (sabados - domingos);
    assert.equal(
      soma(dias, pesoPowerBI) - soma(dias, pesoDecidido),
      esperado,
      `janela de ${n} dia(s) a partir do sábado`,
    );
  }
});
