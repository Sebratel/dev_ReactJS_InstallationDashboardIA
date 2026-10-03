// `backend/tools/snapshot/` nunca teve pasta de teste — é o único motivo pelo qual uma
// restauração ruim (`0aae15c`) deixou `index.ts` e `calculadas.ts` quebrados por dias
// sem os 1494 testes verdes notarem: o glob de `npm test` (`backend/tools/*/test/*.test.ts`)
// simplesmente não olhava para cá.
//
// `index.ts` tinha `SyntaxError`/`ReferenceError` em QUALQUER execução (`avisos`,
// `politicas`, `materializaColunas`, `resumoDoErro` usados sem nunca serem
// declarados/importados). `calculadas.ts` tinha `Identifier 'pular' has already been
// declared` — blocos colados por cima de si mesmos — e a mesma restauração apagou
// `--todas` e `--parcial=` (com a validação e o desvio de escrita que os acompanhava)
// da lista de argumentos conhecidos.
//
// Estes testes são deliberadamente hermétricos: só exercitam caminhos que terminam
// ANTES de tocar `snapshot/` (dado de cliente, fora do repositório) ou o banco real —
// a verificação contra dado de verdade foi feita ao vivo, manualmente, ao consertar o
// bug (mesma disciplina de `backend/tools/probe/`, que também fica fora de `npm test`). O que
// cabe aqui é o que qualquer clone limpo consegue rodar: a CLI carrega sem estourar, e
// a validação de argumento continua recusando o que sempre recusou.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const INDEX = path.join(ROOT, 'backend', 'tools', 'snapshot', 'src', 'index.ts');
const CALCULADAS = path.join(ROOT, 'backend', 'tools', 'snapshot', 'src', 'calculadas.ts');

function roda(script: string, args: string[]): { status: number | null; saida: string } {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, saida: (r.stdout ?? '') + (r.stderr ?? '') };
}

// ------------------------------------------------------------------- index.ts

test('index.ts --plano carrega o módulo inteiro sem SyntaxError/ReferenceError', () => {
  // `--pagina=capa` só depende de `backend/specs/` (committed) — nenhum acesso a `snapshot/`
  // nem ao banco. É o caminho mais curto que ainda importa o arquivo inteiro.
  const { status, saida } = roda(INDEX, ['--pagina=capa', '--plano']);
  assert.equal(status, 0, saida);
  assert.match(saida, /Materializaria \d+ query\(s\)/);
});

test('index.ts sem argumento nenhum recusa, não trava', () => {
  const { status, saida } = roda(INDEX, []);
  assert.equal(status, 2, saida);
  assert.match(saida, /Escolha o que materializar/);
});

test('index.ts recusa argumento desconhecido', () => {
  const { status, saida } = roda(INDEX, ['--bogus=1']);
  assert.equal(status, 2, saida);
  assert.match(saida, /argumento desconhecido: --bogus=1/);
});

// --------------------------------------------------------------- calculadas.ts

test('calculadas.ts --plano --todas carrega sem SyntaxError, e --todas é reconhecido', () => {
  // A regressão exata de 0aae15c: `--todas` tinha sumido da lista de conhecidos, e o
  // encadeamento em index.ts:709 (`calculadas.ts --todas`) saía com "argumento
  // desconhecido" — o congelamento falhava sempre, silenciosamente para quem só olhava
  // o snapshot das QUERIES (que tinha rodado bem).
  const { status, saida } = roda(CALCULADAS, ['--plano', '--todas']);
  assert.equal(status, 0, saida);
  assert.match(saida, /Congelar \d+ tabela\(s\) calculada\(s\)/);
});

test('calculadas.ts recusa argumento desconhecido', () => {
  const { status, saida } = roda(CALCULADAS, ['--bogus=1']);
  assert.equal(status, 2, saida);
  assert.match(saida, /argumento desconhecido: --bogus=1/);
});

test('calculadas.ts recusa --isolar e --sem-isolar juntos', () => {
  // A outra validação que a mesma restauração apagou — sem ela os dois convivem
  // caladas e o comportamento vira o que o código decidir por último.
  const { status, saida } = roda(CALCULADAS, ['--plano', '--tabela=x', '--isolar', '--sem-isolar']);
  assert.equal(status, 2, saida);
  assert.match(saida, /--isolar e --sem-isolar ao mesmo tempo/);
});

test('calculadas.ts recusa --parcial= sem exatamente um --coluna=', () => {
  // A validação que protege o modo filho: sem ela, `--parcial=` seguiria em frente e
  // `congelaIsolada` (ACHADOS #67) descreveria linhas por posição contra um filho que
  // calculou a coluna errada — plausível e errado, silencioso.
  const semColuna = roda(CALCULADAS, ['--parcial=x.jsonl', '--tabela=x']);
  assert.equal(semColuna.status, 2, semColuna.saida);
  assert.match(semColuna.saida, /--parcial= é o modo filho: exige exatamente um --coluna=/);

  const duasColunas = roda(CALCULADAS, [
    '--parcial=x.jsonl', '--tabela=x', '--coluna=a', '--coluna=b',
  ]);
  assert.equal(duasColunas.status, 2, duasColunas.saida);
});

test('calculadas.ts aceita --parcial= com exatamente um --coluna= (passa da validação)', () => {
  // Não é o teste da ESCRITA em si — reescrever de verdade exige um snapshot real em
  // disco (a ferramenta não tem `--saida=`/`--dir=`, achado da própria investigação: o
  // `DIR` é fixo em `ROOT/snapshot`), e isso foi verificado ao vivo, manualmente, ao
  // consertar o bug (`--tabela="Status Protocolo Dia" --coluna="Base Dia" --parcial=…`,
  // sem erro). O que este teste prova, de forma hermética, é a METADE que dava pra
  // provar sem tocar disco: um `--parcial=` com um único `--coluna=` PASSA da validação
  // "--parcial= exige exatamente um --coluna=" e chega em "nenhuma tabela calculada no
  // alcance" — ou seja, a validação para de recusar exatamente quando o uso é legítimo.
  const { status, saida } = roda(CALCULADAS, [
    '--parcial=/qualquer/caminho.jsonl', '--tabela=TABELA-QUE-NAO-EXISTE', '--coluna=x',
  ]);
  assert.equal(status, 2, saida);
  assert.match(saida, /nenhuma tabela calculada no alcance/);
  // Confirma que o erro é "tabela fora do alcance" e não "--parcial= sem --coluna="
  // — ou seja, passou da validação de argumento, não travou nela.
  assert.doesNotMatch(saida, /exige exatamente um --coluna=/);
});
