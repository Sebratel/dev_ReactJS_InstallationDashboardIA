// `VooUnico` — o single-flight, isolado do servidor.
//
// Estes testes são sobre a MECÂNICA (registro, limpeza, identidade da chave);
// o comportamento ponta a ponta, com HTTP e worker de verdade, está em
// `single-flight.test.ts`. A separação é a mesma de `poller-realtime.test.ts`:
// a parte pura tem de ser exercitável sem subir servidor nenhum, senão os casos
// de erro e de corrida nunca são escritos.

import assert from 'node:assert/strict';
import test from 'node:test';
import { VooUnico } from '../src/voo-unico.ts';

/** Uma promessa que só resolve quando o teste mandar. */
function represada<T>(): { promessa: Promise<T>; solta: (v: T) => void; falha: (e: Error) => void } {
  let solta!: (v: T) => void;
  let falha!: (e: Error) => void;
  const promessa = new Promise<T>((ok, erro) => {
    solta = ok;
    falha = erro;
  });
  return { promessa, solta, falha };
}

test('seis chamadas na mesma chave executam UMA vez, e todas recebem o mesmo valor', async () => {
  const voo = new VooUnico();
  const portao = represada<string>();
  let execucoes = 0;

  const seis = Array.from({ length: 6 }, () =>
    voo.faz('k', () => {
      execucoes++;
      return portao.promessa;
    }),
  );

  assert.equal(voo.emAndamento, 1, 'as seis tinham de ter convergido num voo só');
  portao.solta('resposta');
  const resultados = await Promise.all(seis);

  assert.equal(execucoes, 1, 'a função de cálculo foi chamada mais de uma vez');
  assert.deepEqual(
    resultados.map((r) => r.valor),
    Array(6).fill('resposta'),
  );
  // Exatamente uma iniciou; as outras cinco pegaram carona. É esta distinção que
  // vira `cache: 'coalescido'` na resposta e o contador em `/api/saude` — sem
  // ela, o ganho seria invisível de fora.
  assert.equal(resultados.filter((r) => r.iniciou).length, 1);
});

test('chaves diferentes NÃO se fundem', async () => {
  const voo = new VooUnico();
  const executadas: string[] = [];
  const [a, b] = await Promise.all([
    voo.faz('a', async () => {
      executadas.push('a');
      return 1;
    }),
    voo.faz('b', async () => {
      executadas.push('b');
      return 2;
    }),
  ]);
  assert.deepEqual(executadas.sort(), ['a', 'b']);
  assert.equal(a.valor, 1);
  assert.equal(b.valor, 2);
  assert.equal(a.iniciou && b.iniciou, true, 'cada chave tem o seu próprio voo');
});

test('o voo some quando termina — a chamada seguinte calcula de novo', async () => {
  const voo = new VooUnico();
  let execucoes = 0;
  const conta = async (): Promise<number> => ++execucoes;

  await voo.faz('k', conta);
  assert.equal(voo.emAndamento, 0, 'voo terminado não pode continuar registrado');
  await voo.faz('k', conta);
  assert.equal(execucoes, 2, 'a segunda chamada tinha de ter calculado de novo');
});

test('ERRO: todos os que esperavam recebem a MESMA falha', async () => {
  const voo = new VooUnico();
  const portao = represada<string>();
  let execucoes = 0;

  const tres = Array.from({ length: 3 }, () =>
    voo.faz('k', () => {
      execucoes++;
      return portao.promessa;
    }).catch((e: unknown) => e as Error),
  );
  portao.falha(new Error('o snapshot sumiu'));
  const erros = await Promise.all(tres);

  assert.equal(execucoes, 1);
  for (const e of erros) assert.match(e.message, /o snapshot sumiu/);
});

test('ERRO libera o estado: a chamada SEGUINTE pode calcular, em vez de herdar a falha', async () => {
  // É o caso que mais importa de um single-flight mal feito. Se a promessa
  // rejeitada ficasse no mapa, aquela chave passaria a devolver a MESMA falha
  // para sempre — e o remédio seria reiniciar o processo. Sob rajada de SSE isso
  // não seria "um pedido com erro": seria a página inteira morta até o carimbo
  // do snapshot mudar.
  const voo = new VooUnico();
  await assert.rejects(() => voo.faz('k', () => Promise.reject(new Error('falhou'))));
  assert.equal(voo.emAndamento, 0, 'o voo que falhou tinha de ter saído do mapa');
  const depois = await voo.faz('k', async () => 'agora foi');
  assert.equal(depois.valor, 'agora foi');
  assert.equal(depois.iniciou, true);
});

test('erro SÍNCRONO na função de cálculo também limpa o voo', async () => {
  // `executar()` pode lançar antes de devolver promessa nenhuma (um `throw` na
  // montagem do pedido, antes do primeiro `await`). Sem a normalização em
  // `faz()`, a exceção subiria por um caminho diferente do da rejeição — e só um
  // dos dois estaria coberto pela limpeza.
  const voo = new VooUnico();
  await assert.rejects(() =>
    voo.faz('k', () => {
      throw new Error('estourou na hora');
    }),
  );
  assert.equal(voo.emAndamento, 0);
});

test('um voo que termina NÃO apaga o voo novo da mesma chave', async () => {
  // A conferência de identidade na limpeza. Sem ela, o `delete` do voo antigo
  // removeria o registro do voo que começou no intervalo, e o terceiro pedido
  // calcularia de novo em vez de esperar — o single-flight passaria a vazar sob
  // carga, que é exatamente quando ele precisa funcionar.
  const voo = new VooUnico();
  const primeiro = represada<string>();
  const segundo = represada<string>();

  const p1 = voo.faz('k', () => primeiro.promessa);
  primeiro.solta('um');
  await p1;

  const p2 = voo.faz('k', () => segundo.promessa);
  const carona = voo.faz('k', () => {
    throw new Error('não deveria ter sido chamada — havia voo em andamento');
  });

  segundo.solta('dois');
  assert.equal((await p2).valor, 'dois');
  assert.equal((await carona).valor, 'dois');
  assert.equal((await carona).iniciou, false);
});

test('a chave é opaca: quem monta a identidade é quem chama', async () => {
  // `VooUnico` não sabe o que é filtro, visual ou carimbo — ele compara texto. É
  // isso que faz a garantia do requisito 18 sair de graça: a chave que ele recebe
  // é `chaveDaResposta()`, que já carrega o carimbo do snapshot e o dia UTC.
  // Snapshot novo é chave nova, e chave nova não alcança o voo antigo.
  const voo = new VooUnico();
  const portao = represada<string>();
  let execucoes = 0;
  const executa = (): Promise<string> => {
    execucoes++;
    return portao.promessa;
  };

  const antigo = voo.faz('resp:v1:...:CARIMBO-VELHO:2026-09-08', executa);
  const novo = voo.faz('resp:v1:...:CARIMBO-NOVO:2026-09-08', executa);
  assert.equal(voo.emAndamento, 2, 'carimbos diferentes não podem dividir o mesmo voo');

  portao.solta('x');
  await Promise.all([antigo, novo]);
  assert.equal(execucoes, 2);
});
