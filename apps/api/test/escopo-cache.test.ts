// O escopo de dado na chave do cache — e a trava que avisa quando ele deixar de
// poder ser constante.
//
// **Estes testes existem por causa de um defeito que passou 5 dias no ar sem erro
// nenhum (ACHADOS #102).** O login entrou em 01/09 e a chave do cache, que já
// carregava um campo de identidade, passou a carregar o e-mail de verdade. Do
// outro lado, o aquecedor se identifica como `aquecedor-interno`. Ninguém
// percebeu porque nada quebra: o painel continua respondendo o número certo, só
// que recalculando tudo, para cada pessoa, toda vez. A saúde chegava a dizer
// `aquecimento: pronto` com 35 chaves quentes que nenhuma pessoa leria.
//
// Por isso a prova aqui é a **igualdade** de chave entre identidades diferentes —
// o oposto do que um teste de cache costuma guardar.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { chaveDaResposta, chaveDoCompleto } from '../src/cache-resposta.ts';
import { escopoDoCache, ESCOPO_TODOS } from '../src/escopo-cache.ts';
import type { Identidade } from '../src/identidade.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PERMISSOES = path.join(ROOT, 'specs', '_catalog', 'permissoes.yaml');

const pessoa = (email: string): Identidade => ({ usuario: email, papeis: ['autenticado'] });
const AQUECEDOR: Identidade = { usuario: 'aquecedor-interno', papeis: ['interno'] };
const FERRAMENTA: Identidade = { usuario: 'ferramenta-interna', papeis: ['interno'] };

test('duas pessoas diferentes compartilham a MESMA entrada de cache', () => {
  assert.equal(
    escopoDoCache(pessoa('erick.azambuja@sebratel.com.br')),
    escopoDoCache(pessoa('outra.pessoa@sebratel.com.br')),
  );
});

test('o aquecedor aquece a entrada que as pessoas leem — o defeito do #102', () => {
  // A regressão que este teste pega: se o escopo voltar a derivar da identidade
  // (ou dos papéis), o aquecedor volta a encher uma partição própria e cada pessoa
  // volta a pagar 6 s na primeira abertura de cada página.
  assert.equal(escopoDoCache(AQUECEDOR), escopoDoCache(pessoa('alguem@sebratel.com.br')));
  assert.equal(escopoDoCache(FERRAMENTA), escopoDoCache(AQUECEDOR));

  const base = {
    pagina: 'visao-geral',
    filtros: [],
    carimbo: 'c1',
    dia: '2026-09-06',
  };
  const doAquecedor = chaveDaResposta({
    ...base, escopo: escopoDoCache(AQUECEDOR), visuais: ['v1'], de: 0, linhas: 200,
  });
  const daPessoa = chaveDaResposta({
    ...base, escopo: escopoDoCache(pessoa('alguem@sebratel.com.br')), visuais: ['v1'], de: 0, linhas: 200,
  });
  assert.equal(daPessoa, doAquecedor, 'a chave da pessoa TEM de ser a que o aquecedor encheu');

  // O cache do resultado inteiro (paginação) tem o mesmo campo e o mesmo risco.
  assert.equal(
    chaveDoCompleto({ ...base, escopo: escopoDoCache(pessoa('a@sebratel.com.br')), visual: 'v1' }),
    chaveDoCompleto({ ...base, escopo: escopoDoCache(AQUECEDOR), visual: 'v1' }),
  );
});

test('o escopo continua NA chave — tirá-lo seria vazamento no dia do recorte por linha', () => {
  const base = {
    pagina: 'visao-geral', filtros: [], visuais: null, de: 0, linhas: 200,
    carimbo: 'c1', dia: '2026-09-06',
  };
  assert.notEqual(
    chaveDaResposta({ ...base, escopo: ESCOPO_TODOS }),
    chaveDaResposta({ ...base, escopo: 'equipe-aranda' }),
  );
});

/**
 * A trava. `escopoDoCache` devolve constante porque **hoje toda conta vê todas as
 * linhas** — não porque dá menos trabalho. A afirmação mora em
 * `specs/_catalog/permissoes.yaml`, e é ele que este teste lê: no dia em que
 * alguém ligar recorte por página ou por linha, a constante vira vazamento, e
 * quem avisa é esta falha, não a revisão de código.
 */
test('permissoes.yaml ainda é DESENHO — se não for, escopoDoCache tem de mudar ANTES', () => {
  const doc = YAML.parse(fs.readFileSync(PERMISSOES, 'utf8')) as {
    papeis?: { nome: string }[];
    paginas?: Record<string, unknown>;
    linhas?: Record<string, unknown>;
  };

  const recado =
    'permissoes.yaml saiu do estado DESENHO. `escopoDoCache` (apps/api/src/escopo-cache.ts) ' +
    'devolve UM escopo para todo mundo, o que passa a servir a linha de um usuário para outro. ' +
    'Faça o escopo derivar da regra nova ANTES de ligar a regra.';

  assert.deepEqual(Object.keys(doc.paginas ?? {}), [], recado);
  assert.deepEqual(Object.keys(doc.linhas ?? {}), [], recado);
  assert.deepEqual(
    (doc.papeis ?? []).map((p) => p.nome),
    ['local'],
    recado,
  );
});
