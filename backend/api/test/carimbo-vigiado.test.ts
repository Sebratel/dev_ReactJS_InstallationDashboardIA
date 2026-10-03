// A procedência do carimbo — "por que a API acredita que está usando ESTE snapshot?"
//
// **O defeito que isto guarda (B8).** O carimbo era memoizado e só voltava a ser
// lido quando um `fs.watch` disparava, dentro de um `catch {}` vazio. Watch mudo
// = API servindo o snapshot anterior por tempo indeterminado, sem log, sem
// sintoma, e com o `Aquecedor` cego junto (ele lê o MESMO carimbo para decidir
// se há o que aquecer).
//
// Os testes aqui cobrem os três estados que importam, na ordem em que eles
// aparecem na vida real:
//
//   1. o watch nem sobe .......... vira estado e linha, nunca silêncio
//   2. o watch sobe e entrega .... o caminho feliz, e ele precisa ser afirmado
//   3. o watch morre depois ...... o mais perigoso, porque começou funcionando
//
// E o quarto, que não é de estado e sim de sobrevivência: um `'error'` do
// `FSWatcher` sem ouvinte derruba o processo.
//
// REGRA DE SAÍDA: nada aqui imprime valor de linha.

import assert from 'node:assert/strict';
import test from 'node:test';
import { CarimboVigiado } from '../src/carimbo-vigiado.ts';

/**
 * Monta um `CarimboVigiado` com o disco e o observador na mão do teste.
 *
 * `disco()` devolve o que estiver em `valor` — trocar `valor` é "alguém
 * reescreveu o snapshot".
 */
function monta(opts: { vigiaLanca?: string; semDiretorio?: boolean } = {}): {
  c: CarimboVigiado;
  set: (v: string) => void;
  leituras: () => number;
  dispara: () => void;
  morre: (err: unknown) => void;
  fechou: () => boolean;
  linhas: string[];
} {
  let valor = 'carimbo-1';
  let leituras = 0;
  let aoMudar: () => void = () => {};
  let aoMorrer: (err: unknown) => void = () => {};
  let fechou = false;
  const linhas: string[] = [];

  const c = new CarimboVigiado({
    leDoDisco: () => {
      leituras += 1;
      return valor;
    },
    vigia: (mudou, morreu) => {
      if (opts.vigiaLanca) throw new Error(opts.vigiaLanca);
      if (opts.semDiretorio) return null;
      aoMudar = mudou;
      aoMorrer = morreu;
      return {
        close: () => {
          fechou = true;
        },
        on: () => undefined,
        unref: () => undefined,
      };
    },
    agora: () => new Date('2026-09-08T12:00:00.000Z'),
    anuncia: (l) => linhas.push(l),
  });

  return {
    c,
    set: (v) => {
      valor = v;
    },
    leituras: () => leituras,
    dispara: () => aoMudar(),
    morre: (err) => aoMorrer(err),
    fechou: () => fechou,
    linhas,
  };
}

// ---------------------------------------------------------------------------
// 1. O watch nem sobe
// ---------------------------------------------------------------------------

test('o `fs.watch` que NÃO sobe vira estado e linha — nunca `catch {}` vazio', async () => {
  const b = monta({ vigiaLanca: 'EMFILE: too many open files' });

  assert.equal(b.c.doMemo(), 'carimbo-1');
  const e = b.c.estado();
  assert.equal(e.watch.status, 'falhou');
  assert.match(e.watch.motivo ?? '', /EMFILE/);
  assert.equal(b.linhas.length, 1, 'uma linha, e uma só');
  assert.match(b.linhas[0]!, /fs\.watch não subiu/);
  assert.match(b.linhas[0]!, /A API continua correta/, 'a linha tem de dizer o que ainda funciona');
});

test('watch que falhou NÃO é retentado a cada leitura — nem syscall, nem linha repetida', async () => {
  // O defeito que a F2.1 consertou no Redis, na mesma forma: um erro que se
  // repete a cada operação enche o log com centenas de linhas idênticas e
  // soterra a primeira, que era a que importava.
  const b = monta({ vigiaLanca: 'ENOSYS' });
  for (let i = 0; i < 50; i++) b.c.doMemo();
  assert.equal(b.linhas.length, 1, `${b.linhas.length} linhas para o mesmo defeito`);
});

test('sem diretório de snapshot NÃO é o watch quebrado — e continua tentando', async () => {
  // Uma API que subiu antes do primeiro `npm run snapshot` não pode aparecer na
  // saúde como observador defeituoso: não há o que observar ainda, e o snapshot
  // pode aparecer a qualquer momento.
  const b = monta({ semDiretorio: true });
  b.c.doMemo();
  assert.equal(b.c.estado().watch.status, 'nao-tentado');
  assert.equal(b.linhas.length, 0, 'não é defeito, então não é linha de erro');
});

// ---------------------------------------------------------------------------
// 2. O watch sobe e entrega
// ---------------------------------------------------------------------------

test('o caminho feliz: o watch dispara, o memo cai, e a próxima leitura vê o novo', async () => {
  const b = monta();
  assert.equal(b.c.doMemo(), 'carimbo-1');
  assert.equal(b.leituras(), 1);

  // Sem evento, o caminho quente não toca o disco — é para isso que o memo existe.
  b.c.doMemo();
  b.c.doMemo();
  assert.equal(b.leituras(), 1, 'o memo não pode ler o disco por pedido');
  assert.equal(b.c.estado().fonte, 'memo');

  b.set('carimbo-2');
  b.dispara();
  assert.equal(b.c.doMemo(), 'carimbo-2');

  const e = b.c.estado();
  assert.equal(e.watch.status, 'ativo');
  assert.equal(e.divergencias, 0, 'o watch entregou — não houve divergência');
  assert.equal(e.mudancas, 2, 'a primeira leitura e a troca');
  assert.equal(e.ultimaMudanca, '2026-09-08T12:00:00.000Z');
});

test('`esquece()` é o caminho do poller — invalidar tabela também derruba o memo', async () => {
  const b = monta();
  b.c.doMemo();
  b.set('carimbo-2');
  b.c.esquece();
  assert.equal(b.c.doMemo(), 'carimbo-2');
});

// ---------------------------------------------------------------------------
// 3. O watch morre DEPOIS de subir — o caso mais perigoso
// ---------------------------------------------------------------------------

test('o watch que CALA é pego pela conferida periódica, e vira divergência', async () => {
  // O TESTE QUE MAIS IMPORTA. O watch subiu, funcionou, e parou de entregar —
  // mount que sumiu, diretório trocado por fora, limite de inotify. Sem a
  // conferida, o memo ficaria velho para sempre: a chave da resposta apontaria
  // para o snapshot anterior, `carregadas` não seria limpo, e o Aquecedor
  // concluiria que não há o que aquecer. Três consequências, todas mudas.
  const b = monta();
  assert.equal(b.c.doMemo(), 'carimbo-1');
  assert.equal(b.c.estado().watch.status, 'ativo');

  // O snapshot muda e o watch NÃO dispara.
  b.set('carimbo-2');
  assert.equal(b.c.doMemo(), 'carimbo-1', 'o caminho quente ainda serve o velho — é o memo');

  // A conferida periódica (a que o Aquecedor faz a cada 5 s) pega.
  assert.equal(b.c.confere(), 'carimbo-2');

  const e = b.c.estado();
  assert.equal(e.divergencias, 1);
  assert.equal(e.watch.status, 'morreu', 'o watch deixou de ser confiável, e isso tem de aparecer');
  assert.match(e.watch.motivo ?? '', /não avisou/);
  assert.equal(b.linhas.length, 1);
  assert.match(b.linhas[0]!, /servindo o carimbo anterior/);

  // E o caminho quente passa a servir o certo daí em diante.
  assert.equal(b.c.doMemo(), 'carimbo-2');
});

test('a divergência é anunciada UMA vez, e o contador continua subindo', async () => {
  const b = monta();
  b.c.doMemo();
  for (let i = 2; i <= 5; i++) {
    b.set(`carimbo-${i}`);
    b.c.confere();
  }
  assert.equal(b.c.estado().divergencias, 4);
  assert.equal(b.linhas.length, 1, 'uma linha para o defeito, não uma por ocorrência');
});

test('watch ATIVO e sem divergência é a prova de que ele está entregando', async () => {
  // O estado que responde "está tudo bem?" — e ele só vale alguma coisa porque o
  // teste acima mostra que o `morreu` realmente acontece.
  const b = monta();
  b.c.doMemo();
  b.set('carimbo-2');
  b.dispara();
  b.c.confere();
  const e = b.c.estado();
  assert.equal(e.watch.status, 'ativo');
  assert.equal(e.divergencias, 0);
  assert.ok(e.mudancas > 0, 'houve mudança, e ela foi vista pelo watch');
});

// ---------------------------------------------------------------------------
// 4. O `'error'` que derrubava o processo
// ---------------------------------------------------------------------------

test('o observador que MORRE em tempo de execução não derruba nada — vira estado', async () => {
  // `fs.watch` devolve um `EventEmitter` com ZERO ouvintes de `'error'`
  // (conferido em 08/09/2026), e um `'error'` sem ouvinte num `EventEmitter`
  // vira exceção não tratada: o processo morre. Mesmo defeito do `ioredis`
  // antes da F2.1 — tudo o mais degradava certo, e quem derrubava era o evento
  // solto.
  const b = monta();
  b.c.doMemo();

  b.morre(new Error('EPERM: watch invalidado'));

  const e = b.c.estado();
  assert.equal(e.watch.status, 'morreu');
  assert.match(e.watch.motivo ?? '', /EPERM/);
  assert.match(b.linhas.at(-1)!, /a conferida periódica passa a ser a única garantia/i);

  // E o memo cai junto: com o observador morto, continuar servindo o valor que
  // ele deveria ter invalidado é a pior das duas opções.
  b.set('carimbo-9');
  assert.equal(b.c.doMemo(), 'carimbo-9');
});

test('`para()` fecha o observador — um watcher vazado não muda resposta nenhuma', async () => {
  const b = monta();
  b.c.doMemo();
  assert.equal(b.fechou(), false);
  b.c.para();
  assert.equal(b.fechou(), true);
});
