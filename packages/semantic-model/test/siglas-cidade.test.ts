// O mapa CIDADE -> SIGLA está escrito cinco vezes. Este teste afirma que as cinco
// dizem a mesma coisa, na mesma ordem.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ELE EXISTE
//
// Achado #112: as três queries grandes de ODBC (`protocolos-geral`,
// `protocolos-auxiliares`, `protocolos-telefonia`) tinham cada uma as MESMAS nove
// `Table.ReplaceValue` de cidade, e a quarta cópia está no SQL de
// `protocolos-produtividade` — duas vezes dentro do mesmo arquivo, uma por ramo.
//
// Em 16/09/2026 `protocolos-telefonia` migrou para SQL, e em 17/09/2026
// `protocolos-auxiliares`. São as mesmas cinco cópias: UMA em M (`geral`), duas no
// SQL de `produtividade` e uma em cada um dos SQL de `telefonia` e `auxiliares`.
// **Nenhuma das duas migrações reduziu o número — elas só mudaram a linguagem**, e o
// teste vale exatamente pelo mesmo motivo de antes. O que cada uma evitou foi virar
// seis: traduzir `INDICE 2` ao pé da letra repete a cadeia inteira dentro dele.
//
// Acrescentar uma cidade, ou corrigir uma sigla, exige editar cinco blocos em duas
// linguagens. Esquecer um **não dá erro**: dá dois relatórios discordando sobre a
// mesma cidade, com número plausível dos dois lados. É a família de defeito que este
// projeto não aceita, e era a única proteção existente ler os cinco com atenção.
//
// **Por que um teste e não uma refatoração.** O certo seria as cinco lerem de
// `specs/_catalog/siglas-cidade.yaml`. Isso é reescrever `m_expression` de três
// queries de produção e regravar golden contra o banco real — sessão própria, com
// risco alto de ficar pela metade. O teste custa nada e converte um defeito silencioso
// em um vermelho no `npm test`, que é o que faltava hoje.
//
// **A ordem é comparada, não só o conjunto.** `Replacer.ReplaceText` substitui
// SUBSTRING e as nove chamadas são encadeadas. Hoje nenhuma cidade é substring de
// outra, mas isso é propriedade do dado, não do código — se um dia for, a ordem passa
// a decidir o resultado, e o SQL precisa encadear na mesma ordem que o M.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CATALOGO = path.join(ROOT, 'specs', '_catalog');

interface Par {
  de: string;
  para: string;
}

function le(rel: string): string {
  return fs.readFileSync(path.join(CATALOGO, rel), 'utf8');
}

function mostra(pares: readonly Par[]): string {
  return pares.map((p) => `${p.de}->${p.para}`).join(', ');
}

// ── A declaração ─────────────────────────────────────────────────────────────

const declarado = parseYaml(le('siglas-cidade.yaml')) as {
  cidade_para_sigla: Par[];
  correcoes_indice_2: Par[];
};

const MAPA = declarado.cidade_para_sigla;
const CORRECOES = declarado.correcoes_indice_2;

/**
 * As queries cuja camada M ainda carrega o mapa inteiro.
 *
 * Eram três. `protocolos-telefonia` saiu em 16/09/2026 e `protocolos-auxiliares` em
 * 17/09/2026, as duas ao migrar para SQL — os testes delas estão lá embaixo, junto
 * com o de `protocolos-produtividade`. `protocolos-geral` é a única que resta, e é o
 * trabalho que falta.
 *
 * O laço abaixo continua sendo um laço com um elemento só de propósito: ele volta a
 * ter dois no dia em que alguém escrever o mapa em M de novo, e aí reprova sozinho.
 */
const EM_M = ['protocolos-geral'] as const;

// ── Extração da camada M ─────────────────────────────────────────────────────

/**
 * `Table.ReplaceValue(#"passo","Canoas","CAN",Replacer.ReplaceText,{"CIDADE - Copiar"})`
 *
 * A coluna alvo faz parte do filtro de propósito: o mesmo arquivo tem outras
 * `Table.ReplaceValue` que trocam nulo por "Sem Informação" em meia dúzia de colunas,
 * e essas não são o mapa.
 */
function mapaDoM(fonte: string, colunas: readonly string[]): Par[] {
  const alvo = colunas.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(
    String.raw`Table\.ReplaceValue\(\s*[^,]+,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*Replacer\.ReplaceText\s*,\s*\{"(?:${alvo})"\}\)`,
    'g',
  );
  return [...fonte.matchAll(re)].map((m) => ({ de: m[1]!, para: m[2]! }));
}

// ── Extração do SQL ──────────────────────────────────────────────────────────

/**
 * Cada cadeia de `replace()` do SQL começa logo depois de `initcap("CIDADE"),` e
 * termina no `AS "..."` da coluna. `initcap("CIDADE")` sem vírgula — a projeção da
 * própria CIDADE — não casa, que é o que se quer.
 */
function cadeiasDoSql(fonte: string): Par[][] {
  const marca = 'initcap("CIDADE"),';
  const cadeias: Par[][] = [];
  let i = fonte.indexOf(marca);
  while (i >= 0) {
    const fim = fonte.indexOf('AS "', i);
    assert.ok(fim > i, 'cadeia de replace() sem `AS "coluna"` depois dela');
    const trecho = fonte.slice(i + marca.length, fim);
    cadeias.push(
      [...trecho.matchAll(/'([^']*)'\s*,\s*'([^']*)'\s*\)/g)].map((m) => ({
        de: m[1]!,
        para: m[2]!,
      })),
    );
    i = fonte.indexOf(marca, fim);
  }
  return cadeias;
}

// ── Os testes ────────────────────────────────────────────────────────────────

test('o catálogo declara as nove cidades e as duas correções', () => {
  assert.equal(MAPA.length, 9, 'o mapa mudou de tamanho — as cinco cópias sabem disso?');
  assert.equal(CORRECOES.length, 2);
  for (const p of [...MAPA, ...CORRECOES]) {
    assert.equal(typeof p.de, 'string', 'entrada sem `de:`');
    assert.equal(typeof p.para, 'string', 'entrada sem `para:`');
  }
});

for (const id of EM_M) {
  test(`${id}: a camada M traduz as cidades exatamente como o catálogo`, () => {
    const fonte = le(path.join('queries', `${id}.spec.yaml`));
    const achado = mapaDoM(fonte, ['CIDADE - Copiar', 'SIGLA CIDADE']);
    assert.deepEqual(
      achado,
      MAPA,
      `a camada M de '${id}' divergiu de specs/_catalog/siglas-cidade.yaml.\n` +
        `  no M:        ${mostra(achado)}\n` +
        `  no catálogo: ${mostra(MAPA)}\n` +
        `Se a mudança é intencional, ela precisa entrar nas CINCO cópias — as outras ` +
        `duas queries em M e os dois ramos do SQL de protocolos-produtividade. ` +
        `Editar uma só faz dois relatórios discordarem sobre a mesma cidade, sem erro.`,
    );
  });

  test(`${id}: as duas correções de INDICE 2 continuam lá`, () => {
    const fonte = le(path.join('queries', `${id}.spec.yaml`));
    assert.deepEqual(mapaDoM(fonte, ['INDICE 2']), CORRECOES);
  });
}

test('protocolos-produtividade: os dois ramos do SQL encadeiam o mesmo mapa, na mesma ordem', () => {
  const fonte = le(path.join('queries', 'protocolos-produtividade.spec.yaml'));
  const cadeias = cadeiasDoSql(fonte);

  assert.equal(
    cadeias.length,
    2,
    `esperava duas cadeias de replace() sobre initcap("CIDADE") — uma para ` +
      `"SIGLA CIDADE", outra dentro de "INDICE 2" — e achei ${cadeias.length}.`,
  );

  // Ramo 1: só o mapa.
  assert.deepEqual(cadeias[0], MAPA, 'o ramo "SIGLA CIDADE" do SQL divergiu do catálogo');

  // Ramo 2: o mapa e, depois dele, as duas correções literais de INDICE 2.
  assert.deepEqual(
    cadeias[1],
    [...MAPA, ...CORRECOES],
    'o ramo "INDICE 2" do SQL divergiu do catálogo',
  );
});

test('protocolos-telefonia: o SQL encadeia o mapa UMA vez, e INDICE 2 lê o resultado', () => {
  const fonte = le(path.join('queries', 'protocolos-telefonia.spec.yaml'));
  const cadeias = cadeiasDoSql(fonte);

  // UMA, não duas. `protocolos-produtividade` tem duas porque a tradução direta de
  // `INDICE 2` repete a cadeia inteira dentro dela; o M de telefonia NÃO repetia — a
  // cadeia produzia "SIGLA CIDADE" e `Text.Combine` lia essa coluna. A migração de
  // 16/09/2026 preservou isso com um CTE, e é este número que guarda a decisão: se
  // alguém "simplificar" o CTE inline, aparecem duas cópias e este teste reprova.
  assert.equal(
    cadeias.length,
    1,
    `esperava UMA cadeia de replace() sobre initcap("CIDADE") em protocolos-telefonia ` +
      `— a do CTE \`derivado\` — e achei ${cadeias.length}. Duas significa que ` +
      `"INDICE 2" voltou a recalcular o mapa em vez de ler "SIGLA CIDADE", e o mapa ` +
      `passou de cinco cópias para seis.`,
  );
  assert.deepEqual(cadeias[0], MAPA, 'o mapa no SQL de protocolos-telefonia divergiu do catálogo');

  // As duas correções literais de INDICE 2 continuam, agora sobre a coluna já pronta.
  const corrigidas = [...fonte.matchAll(/'([^']*)','([^']*)'\)\s*AS "INDICE 2"/g)];
  assert.equal(corrigidas.length, 1, 'não achei o fecho de "INDICE 2" no SQL');
  for (const c of CORRECOES) {
    assert.ok(
      fonte.includes(`'${c.de}','${c.para}'`),
      `a correção de INDICE 2 '${c.de}' -> '${c.para}' sumiu do SQL de protocolos-telefonia`,
    );
  }
});

test('protocolos-telefonia não voltou a ter o mapa em M', () => {
  const fonte = le(path.join('queries', 'protocolos-telefonia.spec.yaml'));
  const emM = mapaDoM(fonte, ['CIDADE - Copiar', 'SIGLA CIDADE', 'INDICE 2']);
  assert.equal(
    emM.length,
    0,
    'protocolos-telefonia voltou a traduzir cidade na camada M — o mapa já está no ' +
      'SQL dela desde 16/09/2026, e ter os dois é ter duas respostas para a mesma pergunta.',
  );
});

test('protocolos-auxiliares: o SQL encadeia o mapa UMA vez, e INDICE 2 lê o resultado', () => {
  const fonte = le(path.join('queries', 'protocolos-auxiliares.spec.yaml'));
  const cadeias = cadeiasDoSql(fonte);

  // UMA, não duas — pela mesma razão de `protocolos-telefonia`, e a armadilha aqui
  // era idêntica: no M de `auxiliares` a cadeia produzia "SIGLA CIDADE" e
  // `Text.Combine({[BAIRRO], [SIGLA CIDADE]}, "/")` LIA essa coluna. Traduzir
  // `INDICE 2` ao pé da letra repetiria a cadeia inteira dentro dele e o mapa passaria
  // de cinco cópias para seis — a migração PIORANDO o problema que ela resolve. O CTE
  // `derivado` preserva a cópia única, e é este número que guarda a decisão.
  assert.equal(
    cadeias.length,
    1,
    `esperava UMA cadeia de replace() sobre initcap("CIDADE") em protocolos-auxiliares ` +
      `— a do CTE \`derivado\` — e achei ${cadeias.length}. Duas significa que ` +
      `"INDICE 2" voltou a recalcular o mapa em vez de ler "SIGLA CIDADE".`,
  );
  assert.deepEqual(cadeias[0], MAPA, 'o mapa no SQL de protocolos-auxiliares divergiu do catálogo');

  const corrigidas = [...fonte.matchAll(/'([^']*)','([^']*)'\)\s*AS "INDICE 2"/g)];
  assert.equal(corrigidas.length, 1, 'não achei o fecho de "INDICE 2" no SQL');
  for (const c of CORRECOES) {
    assert.ok(
      fonte.includes(`'${c.de}','${c.para}'`),
      `a correção de INDICE 2 '${c.de}' -> '${c.para}' sumiu do SQL de protocolos-auxiliares`,
    );
  }
});

test('protocolos-auxiliares não voltou a ter o mapa em M', () => {
  const fonte = le(path.join('queries', 'protocolos-auxiliares.spec.yaml'));
  const emM = mapaDoM(fonte, ['CIDADE - Copiar', 'SIGLA CIDADE', 'INDICE 2']);
  assert.equal(
    emM.length,
    0,
    'protocolos-auxiliares voltou a traduzir cidade na camada M — o mapa já está no ' +
      'SQL dela desde 17/09/2026, e ter os dois é ter duas respostas para a mesma pergunta.',
  );
});

test('protocolos-produtividade não voltou a ter o mapa em M', () => {
  // Ela migrou de ~60 passos de M para 3 em 10/09/2026 e é o caminho que as outras
  // três devem seguir. Se `Table.ReplaceValue` reaparecer aqui, ou a migração foi
  // revertida ou existe agora uma SEXTA cópia — as duas merecem parar o teste.
  const fonte = le(path.join('queries', 'protocolos-produtividade.spec.yaml'));
  assert.equal(
    mapaDoM(fonte, ['CIDADE - Copiar', 'SIGLA CIDADE', 'INDICE 2']).length,
    0,
    'protocolos-produtividade voltou a traduzir cidade na camada M — o mapa já está ' +
      'no SQL dela, e ter os dois é ter duas respostas para a mesma pergunta.',
  );
});

test('toda sigla escrita à mão no DAX de PROTOCOLOS GERAL existe no mapa', () => {
  // Rótulo de base ("BASE (NHO/SLE/SPS)") e nome de equipe ("Equipe de Reparo EIO/CAN")
  // NÃO são o mapa — são agrupamento. Mas dependem dele: trocar a sigla de uma cidade
  // sem mexer nestes `IF` deixa o rótulo apontando para sigla que não existe mais.
  const spec = parseYaml(le(path.join('tables', 'protocolos-geral.spec.yaml'))) as {
    columns: { name: string; dax: string | null }[];
  };
  const siglas = new Set(MAPA.map((p) => p.para));
  const vistas = new Set<string>();

  for (const col of spec.columns) {
    if (col.dax === null || col.dax === undefined) continue;
    for (const grupo of col.dax.match(/\b[A-Z]{3,}(?:\/[A-Z]{3,})+\b/g) ?? []) {
      for (const s of grupo.split('/')) {
        vistas.add(s);
        assert.ok(
          siglas.has(s),
          `a coluna calculada '${col.name}' cita a sigla '${s}' (em '${grupo}'), que ` +
            `não está em specs/_catalog/siglas-cidade.yaml. Ou a sigla foi trocada e ` +
            `o DAX ficou para trás, ou o mapa perdeu uma cidade.`,
        );
      }
    }
  }

  assert.ok(vistas.size >= 5, `esperava achar siglas no DAX e achei ${vistas.size}`);
});

test('as cidades comparadas em EQUIPES TEMPORARIAS são cidades do mapa', () => {
  const spec = parseYaml(le(path.join('tables', 'protocolos-geral.spec.yaml'))) as {
    columns: { name: string; dax: string | null }[];
  };
  const col = spec.columns.find((c) => c.name === 'EQUIPES TEMPORARIAS');
  assert.ok(col?.dax, 'a coluna calculada EQUIPES TEMPORARIAS sumiu de PROTOCOLOS GERAL');

  const cidades = new Set(MAPA.map((p) => p.de));
  const comparadas = [...col.dax.matchAll(/\[CIDADE\]\s*==\s*"([^"]+)"/g)].map((m) => m[1]!);

  assert.ok(comparadas.length > 0, 'EQUIPES TEMPORARIAS parou de comparar [CIDADE]');
  for (const c of comparadas) {
    assert.ok(
      cidades.has(c),
      `EQUIPES TEMPORARIAS compara [CIDADE] com "${c}", que não está no mapa de ` +
        `siglas. A comparação é por igualdade exata: se a grafia mudar de um lado só, ` +
        `o protocolo cai em "OUTROS" em silêncio.`,
    );
  }
});
