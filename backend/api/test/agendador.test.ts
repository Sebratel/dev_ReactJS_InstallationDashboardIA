// O agendador que mora dentro da API — `backend/api/src/agendador.ts`.
//
// **`snapshotDir` é SEMPRE temporário aqui, e isso não é higiene: é o defeito de
// 16/09/2026.** Sem ele, o agendador cai no padrão `path.join(raiz, 'snapshot')` — o
// snapshot REAL — e carimba `refresh-status.json` com sucessos de 0 ms que não
// materializaram nada. Naquele dia `npm test` fez `GET /api/saude` mentir que o
// refresh estava saudável, e o tick de verdade seguinte ainda esperou o intervalo
// inteiro, porque `estaVencido` mede a idade do último SUCESSO. O `roda` injetado é
// justamente o que torna isso invisível. Ver o mesmo aviso em
// `backend/tools/refresh/test/daemon.test.ts`.
//
// O `specsDir` é o REAL, de propósito: assim estes testes também provam que
// `backend/specs/_catalog/refresh.yaml` continua válido contra o Query Registry de verdade.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  Agendador,
  agendaNesteProcesso,
  atrasoAteProximoDisparo,
  atrasoAteRetentativa,
} from '../src/agendador.ts';
import type { GrupoDeRefresh } from '../../tools/refresh/src/grupos.ts';
import { leHistorico } from '../../tools/refresh/src/historico.ts';
import { leStatus } from '../../tools/refresh/src/status.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agendador-'));
}

/** Uma promessa que o teste resolve quando quiser — para segurar um grupo em voo. */
function represa(): { promessa: Promise<void>; abre: () => void } {
  let abre!: () => void;
  const promessa = new Promise<void>((r) => {
    abre = r;
  });
  return { promessa, abre };
}

/** Quantos grupos o arranque colocou para rodar: o que já saiu mais o que espera. */
function aFazer(ag: Agendador): number {
  const e = ag.estado();
  return e.fila.length + (e.emExecucao === null ? 0 : 1);
}

/** Espera uma condição virar verdadeira sem cravar tempo. */
async function esperaAte(cond: () => boolean, oQue: string): Promise<void> {
  const ate = Date.now() + 5_000;
  while (!cond()) {
    if (Date.now() > ate) throw new Error(`não aconteceu em 5s: ${oQue}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Espera a fila drenar sem cravar tempo — o contador de execuções é o relógio. */
async function drena(ag: Agendador, quantos: number): Promise<void> {
  const ate = Date.now() + 5_000;
  while (ag.estado().execucoes < quantos) {
    if (Date.now() > ate) throw new Error(`a fila não drenou: ${ag.estado().execucoes}/${quantos}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('agendaNesteProcesso: o padrão é agendar', () => {
  assert.deepEqual(agendaNesteProcesso({}, []), { agenda: true });
});

test('atrasoAteProximoDisparo: reiniciar preserva o próximo vencimento, não reinicia o intervalo', () => {
  const agora = new Date('2026-10-16T16:40:00.000Z');
  const anterior = {
    ultimaTentativa: '2026-10-16T16:27:00.000Z',
    ultimoSucesso: '2026-10-16T16:27:00.000Z',
    duracaoMs: 1,
    ok: true,
    falhasConsecutivas: 0,
  };
  // 15 min menos 1 min de folga: vence às 16:41, então faltam 60 s — não 15 min.
  assert.equal(atrasoAteProximoDisparo(anterior, 15, agora), 60_000);
});

test('atrasoAteRetentativa: a primeira falha volta em dois minutos, sem esperar a cadência do grupo', () => {
  const agora = new Date('2026-10-16T17:00:00.000Z');
  const falhouUmaVez = {
    ultimaTentativa: agora.toISOString(),
    ultimoSucesso: null,
    duracaoMs: 1,
    ok: false,
    falhasConsecutivas: 1,
  };
  assert.equal(atrasoAteRetentativa(falhouUmaVez, 30, agora), 2 * 60_000);

  const falhouDuasVezes = { ...falhouUmaVez, falhasConsecutivas: 2 };
  assert.equal(atrasoAteRetentativa(falhouDuasVezes, 30, agora), 60 * 60_000);
});

test('agendaNesteProcesso: --sem-refresh e AUTO_REFRESH desligam, e dizem por quê', () => {
  const porBandeira = agendaNesteProcesso({}, ['--sem-refresh']);
  assert.equal(porBandeira.agenda, false);
  assert.match((porBandeira as { motivo: string }).motivo, /--sem-refresh/);

  for (const valor of ['false', '0']) {
    const porAmbiente = agendaNesteProcesso({ AUTO_REFRESH: valor }, []);
    assert.equal(porAmbiente.agenda, false, `AUTO_REFRESH=${valor} tem de desligar`);
    assert.match((porAmbiente as { motivo: string }).motivo, /AUTO_REFRESH/);
  }

  // Qualquer outro valor NÃO desliga. `AUTO_REFRESH=true` desligar o refresh seria a
  // pior forma possível de errar, e é o que um `if (env.AUTO_REFRESH)` distraído faz.
  assert.deepEqual(agendaNesteProcesso({ AUTO_REFRESH: 'true' }, []), { agenda: true });
  assert.deepEqual(agendaNesteProcesso({ AUTO_REFRESH: '1' }, []), { agenda: true });
});

test('agendador: sem status em disco, todo grupo está vencido e roda — UM DE CADA VEZ', async () => {
  const dir = tmp();
  const ordem: string[] = [];
  let simultaneos = 0;
  let pico = 0;

  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    roda: async (g: GrupoDeRefresh) => {
      simultaneos += 1;
      pico = Math.max(pico, simultaneos);
      ordem.push(g.id);
      await new Promise((r) => setTimeout(r, 5));
      simultaneos -= 1;
      return { ok: true };
    },
  });

  ag.inicia();
  const esperados = aFazer(ag);
  assert.ok(esperados >= 3, 'quente, medio e frio deviam estar vencidos num diretório vazio');
  await drena(ag, esperados);
  ag.para();

  // É a regra que o `tick.ts` documenta: dois materializadores simultâneos fazem
  // read-modify-write no mesmo `manifesto.json` e um apaga o que o outro registrou.
  assert.equal(pico, 1);
  assert.ok(ordem.includes('quente') && ordem.includes('medio') && ordem.includes('frio'));

  // O que o operador vai ler depois: status por grupo e uma linha por execução.
  const status = leStatus(dir);
  assert.equal(status.quente?.ok, true);
  assert.ok(status.quente?.ultimoSucesso, 'sucesso tem de carimbar ultimoSucesso');

  const eventos = leHistorico(dir, 100);
  assert.ok(
    eventos.some((e) => e.evento === 'agendador-arranque'),
    'o arranque do agendador tem de ficar no histórico — é ele que distingue "ninguém agenda" de "agenda e falha"',
  );
  assert.ok(eventos.filter((e) => e.evento === 'grupo').length >= 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agendador: um grupo que falha não impede os seguintes, e o erro fica gravado', async () => {
  const dir = tmp();
  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    roda: async (g: GrupoDeRefresh) =>
      g.id === 'medio' ? { ok: false, erro: 'saiu com código 1' } : { ok: true },
  });

  ag.inicia();
  const esperados = aFazer(ag);
  await drena(ag, esperados);
  ag.para();

  assert.equal(ag.estado().falhas, 1);
  const status = leStatus(dir);
  assert.equal(status.medio?.ok, false);
  assert.equal(status.medio?.falhasConsecutivas, 1);
  // A falha NÃO carimba ultimoSucesso: é isso que faz o grupo ser tentado de novo no
  // relógio seguinte, em vez de esperar o intervalo inteiro como se tivesse dado certo.
  assert.equal(status.medio?.ultimoSucesso, null);
  // E os outros rodaram mesmo assim — uma query quebrada não pode congelar o catálogo.
  assert.equal(status.quente?.ok, true);
  assert.equal(status.frio?.ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agendador: disparo em cima do próprio grupo é descartado, não enfileirado duas vezes', async () => {
  const dir = tmp();
  const preso = represa();
  let chamadas = 0;

  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    roda: async () => {
      chamadas += 1;
      await preso.promessa;
      return { ok: true };
    },
  });

  ag.inicia();
  const esperados = aFazer(ag);
  const emVoo = ag.estado().emExecucao;
  assert.ok(emVoo, 'algum grupo tem de estar em execução com o `roda` represado');

  // O relógio do MESMO grupo bate enquanto ele ainda roda. A segunda cópia
  // materializaria exatamente o que já está sendo materializado.
  ag.pede(emVoo);
  ag.pede(emVoo);

  assert.equal(ag.estado().coalescidos, 2);
  assert.ok(!ag.estado().fila.includes(emVoo), 'não pode entrar na fila de novo');
  assert.equal(chamadas, 1, 'nenhum `roda` a mais pode ter sido disparado');

  preso.abre();
  await drena(ag, esperados);
  ag.para();

  const coalescidos = leHistorico(dir, 100).filter((e) => e.evento === 'disparo-coalescido');
  assert.equal(coalescidos.length, 2);
  assert.equal((coalescidos[0] as { grupo: string }).grupo, emVoo);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agendador: um grupo ATRASADO espera a fila — não perde a vez como o daemon perdia', async () => {
  const dir = tmp();
  const preso = represa();
  const rodados: string[] = [];

  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    roda: async (g: GrupoDeRefresh) => {
      rodados.push(g.id);
      if (rodados.length === 1) await preso.promessa;
      return { ok: true };
    },
  });

  ag.inicia();
  const emVoo = ag.estado().emExecucao!;
  const outro = ag.estado().grupos.map((g) => g.id).find((id) => id !== emVoo)!;
  const esperados = aFazer(ag);

  // No daemon, um disparo que caísse aqui virava `ciclo-pulado`: o grupo perdia a vez
  // INTEIRA, e sem nada ficar vermelho, porque pular não é falha (`estaVencido` mede
  // idade do último sucesso). Aqui ele espera a fila.
  assert.ok(ag.estado().fila.includes(outro), `'${outro}' tem de estar esperando, não descartado`);

  preso.abre();
  await drena(ag, esperados);
  ag.para();

  assert.ok(rodados.includes(outro), 'o grupo que esperou tem de acabar rodando');
  assert.equal(ag.estado().coalescidos, 0, 'esperar na fila não é disparo descartado');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agendador: status recente em disco significa nada a fazer no arranque', async () => {
  const dir = tmp();
  const agora = new Date().toISOString();
  const verde = { ultimaTentativa: agora, ultimoSucesso: agora, duracaoMs: 1, ok: true, falhasConsecutivas: 0 };
  fs.writeFileSync(
    path.join(dir, 'refresh-status.json'),
    JSON.stringify({ quente: verde, medio: verde, frio: verde }),
    'utf8',
  );

  let chamadas = 0;
  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    roda: async () => {
      chamadas += 1;
      return { ok: true };
    },
  });
  ag.inicia();
  await new Promise((r) => setTimeout(r, 20));
  ag.para();

  // É o que torna reiniciar barato: subir a API duas vezes seguidas não rematerializa
  // nada. Um arranque que sempre recarrega tudo faz de "reiniciar" uma decisão cara —
  // e decisão cara é decisão adiada.
  assert.equal(chamadas, 0);
  assert.equal(ag.estado().emExecucao, null);
  assert.deepEqual(ag.estado().fila, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agendador: grupo em espera por falhas não roda na cadência, deixa rastro, e pede() passa por cima', async (t) => {
  // A cadência é um `setInterval` de 15–30 min (o `refresh.yaml` real): só o relógio
  // falso chega lá sem esperar. O `setTimeout` fica de verdade — é o que `esperaAte` usa.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const dir = tmp();
  const agora = new Date();
  const verde = { ultimaTentativa: agora.toISOString(), ultimoSucesso: agora.toISOString(), duracaoMs: 1, ok: true, falhasConsecutivas: 0 };
  const caido = { ultimaTentativa: agora.toISOString(), ultimoSucesso: null, duracaoMs: 1, ok: false, falhasConsecutivas: 3 };
  fs.writeFileSync(
    path.join(dir, 'refresh-status.json'),
    JSON.stringify({ quente: verde, medio: caido, frio: verde }),
    'utf8',
  );

  const rodados: string[] = [];
  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    agora: () => agora,
    roda: async (g: GrupoDeRefresh) => {
      rodados.push(g.id);
      return { ok: true };
    },
  });
  ag.inicia();
  try {
    const medio = ag.estado().grupos.find((g) => g.id === 'medio')!;
    t.mock.timers.tick(medio.intervaloMinutos * 60_000);
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(!rodados.includes('medio'), 'com 3 falhas seguidas agora há pouco, a cadência não podia rodar medio');
    const adiados = leHistorico(dir).filter((e) => e.evento === 'grupo-adiado');
    assert.ok(adiados.some((e) => e.evento === 'grupo-adiado' && e.grupo === 'medio' && e.falhasConsecutivas === 3));

    assert.equal(ag.pede('medio'), true);
    await esperaAte(() => rodados.includes('medio'), 'pede() rodar medio mesmo em espera');
  } finally {
    ag.para();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agendador: catálogo ilegível desliga a cadência e DIZ, em vez de derrubar a API', () => {
  const dir = tmp();
  const specsRuim = tmp();
  fs.mkdirSync(path.join(specsRuim, '_catalog'), { recursive: true });
  fs.writeFileSync(path.join(specsRuim, '_catalog', 'refresh.yaml'), 'formato: 99\n', 'utf8');

  const ditas: string[] = [];
  const ag = new Agendador({
    raiz: ROOT,
    specsDir: specsRuim,
    snapshotDir: dir,
    anuncia: (l) => ditas.push(l),
    roda: async () => ({ ok: true }),
  });
  // Não lança: a tela é o produto, e trocar dado velho por tela nenhuma é pior.
  ag.inicia();

  const estado = ag.estado();
  assert.equal(estado.ativo, false);
  assert.ok(estado.motivo, 'desligado sem motivo declarado é o buraco do #129 de novo');
  assert.ok(ditas.some((l) => l.includes('DESLIGADO')));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(specsRuim, { recursive: true, force: true });
});

test('agendador: pede() recusa grupo inexistente, e não faz nada antes de iniciar nem depois de parar', () => {
  const dir = tmp();
  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    roda: async () => ({ ok: true }),
  });
  assert.equal(ag.pede('quente'), false, 'antes de iniciar não há o que pedir');
  ag.inicia();
  assert.equal(ag.pede('nao-existe'), false);
  ag.para();
  assert.equal(ag.pede('quente'), false, 'depois de parar também não');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// SUSPENSÃO DA MÁQUINA — 19/09/2026
//
// O caso real: `medio` começou 16:36:43Z, a Espera S0 do Windows entrou 28 s depois,
// e o grupo ficou "em execução" por 2h17min segurando `quente` e `frio` atrás dele.
// Ao acordar, os três relógios dispararam com 14 ms entre si e o filho do `medio`
// saiu com código 1 — o driver do Postgres relatando conexão morta no sono. O banner
// leu isso como "cargas falharam" e citou as onze queries do grupo, nenhuma das quais
// tinha defeito nenhum.
// ---------------------------------------------------------------------------

test('agendador: máquina suspensa NÃO é falha — a carga é refeita e nada fica vermelho', async () => {
  const dir = tmp();
  let relogio = new Date('2026-09-19T16:36:43.000Z');
  const tentativas: string[] = [];
  let travouUmaVez = false;

  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    batimentoMs: 20,
    carenciaMs: 10,
    agora: () => relogio,
    roda: async (g: GrupoDeRefresh, sinal?: AbortSignal) => {
      tentativas.push(g.id);
      if (!travouUmaVez) {
        travouUmaVez = true;
        // O filho de verdade não percebe o sono: ele fica bloqueado num socket que
        // morreu e só termina quando o matam. É por isso que o agendador precisa
        // matá-lo, em vez de esperar.
        await new Promise<void>((r) => {
          sinal?.addEventListener('abort', () => r(), { once: true });
        });
        return { ok: false, erro: 'interrompida: máquina suspensa' };
      }
      return { ok: true };
    },
  });

  ag.inicia();
  const primeiro = ag.estado().emExecucao;
  assert.ok(primeiro !== null, 'algum grupo tem de estar em voo para o caso existir');

  // 2h14min de congelamento — o tamanho medido em 19/09/2026.
  relogio = new Date(relogio.getTime() + 8_040_000);
  await esperaAte(() => ag.estado().suspensoes === 1, 'a suspensão ser detectada');

  const eventos = leHistorico(dir);
  const suspensao = eventos.find((e) => e.evento === 'maquina-suspensa');
  assert.ok(suspensao, 'a suspensão tem de ficar registrada, ou o próximo a investigar repete o trabalho');
  assert.equal((suspensao as { grupoEmVoo: string | null }).grupoEmVoo, primeiro);
  assert.ok((suspensao as { paradaMs: number }).paradaMs >= 8_040_000);

  await drena(ag, 3);
  ag.para();

  // A carga perdida foi refeita, e na FRENTE: ela perdeu a vez inteira, os outros
  // apenas esperaram.
  assert.equal(tentativas[0], primeiro);
  assert.equal(tentativas[1], primeiro, 'o grupo interrompido tem de voltar para a frente da fila');
  assert.deepEqual([...new Set(tentativas)].sort(), ['frio', 'medio', 'quente']);

  // E não contou como falha em lugar nenhum.
  assert.equal(ag.estado().falhas, 0, 'suspensão do host não é falha da plataforma');
  const interrompida = eventos.concat(leHistorico(dir)).find((e) => e.evento === 'carga-interrompida');
  assert.ok(interrompida, 'a carga perdida tem de ter evento próprio, distinto de `grupo`');
  assert.equal((interrompida as { motivo: string }).motivo, 'máquina suspensa');

  const status = leStatus(dir);
  assert.equal(status[primeiro]?.ok, true, 'o refeito é que manda no status');
  assert.equal(status[primeiro]?.falhasConsecutivas, 0);
  assert.ok(
    !leHistorico(dir).some((e) => e.evento === 'grupo' && !e.ok),
    'nenhum evento `grupo` com ok:false — é esse que o banner lê como "cargas falharam"',
  );
});

test('agendador: parada planejada não conta como falha nem cria backoff no próximo deploy', async () => {
  const dir = tmp();
  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    roda: async (_grupo: GrupoDeRefresh, sinal?: AbortSignal) => {
      await new Promise<void>((resolve) => sinal?.addEventListener('abort', () => resolve(), { once: true }));
      return { ok: false, erro: 'interrompida: agendador encerrado' };
    },
  });

  ag.inicia();
  await esperaAte(() => ag.estado().emExecucao !== null, 'uma carga entrar em voo');
  await ag.encerra();

  assert.equal(ag.estado().falhas, 0);
  assert.deepEqual(leStatus(dir), {}, 'a parada não pode sobrescrever o último status verdadeiro');
  assert.ok(
    !leHistorico(dir).some((e) => e.evento === 'grupo' && !e.ok),
    'o banner não pode ler uma parada de deploy como falha de dado',
  );
});

test('agendador: depois de acordar, o quente vencido vem antes da carga média interrompida', async () => {
  const dir = tmp();
  let relogio = new Date('2026-10-16T16:00:00.000Z');
  const verde = { ultimaTentativa: relogio.toISOString(), ultimoSucesso: relogio.toISOString(), duracaoMs: 1, ok: true, falhasConsecutivas: 0 };
  fs.writeFileSync(path.join(dir, 'refresh-status.json'), JSON.stringify({ quente: verde, frio: verde }), 'utf8');

  const tentativas: string[] = [];
  let primeira = true;
  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    batimentoMs: 20,
    carenciaMs: 10,
    agora: () => relogio,
    roda: async (grupo: GrupoDeRefresh, sinal?: AbortSignal) => {
      tentativas.push(grupo.id);
      if (primeira) {
        primeira = false;
        await new Promise<void>((resolve) => sinal?.addEventListener('abort', () => resolve(), { once: true }));
        return { ok: false, erro: 'interrompida: máquina suspensa' };
      }
      return { ok: true };
    },
  });

  ag.inicia();
  assert.equal(tentativas[0], 'medio', 'só o médio estava vencido antes do sono');
  relogio = new Date(relogio.getTime() + 8_040_000);
  await esperaAte(() => ag.estado().suspensoes === 1, 'a suspensão ser detectada');
  await drena(ag, 2);
  ag.para();

  assert.deepEqual(tentativas.slice(0, 3), ['medio', 'quente', 'medio']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('agendador: suspensão sem nada em voo é registrada e não inventa trabalho', async () => {
  const dir = tmp();
  let relogio = new Date('2026-09-19T16:36:43.000Z');
  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    batimentoMs: 20,
    carenciaMs: 10,
    agora: () => relogio,
    roda: async () => ({ ok: true }),
  });

  ag.inicia();
  await drena(ag, 3);
  relogio = new Date(relogio.getTime() + 8_040_000);
  await esperaAte(() => ag.estado().suspensoes === 1, 'a suspensão ser detectada');
  ag.para();

  const e = leHistorico(dir).find((x) => x.evento === 'maquina-suspensa');
  assert.equal((e as { grupoEmVoo: string | null }).grupoEmVoo, null);
  assert.equal(ag.estado().execucoes, 3, 'dormir não é motivo para materializar fora de cadência');
  assert.ok(!leHistorico(dir).some((x) => x.evento === 'carga-interrompida'));
});

test('agendador: atraso normal de temporizador NÃO vira suspensão', async () => {
  const dir = tmp();
  let relogio = new Date('2026-09-19T16:36:43.000Z');
  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    batimentoMs: 20,
    carenciaMs: 10,
    agora: () => relogio,
    roda: async () => ({ ok: true }),
  });

  ag.inicia();
  await drena(ag, 3);
  // Duas vezes a cadência do batimento: laço de eventos ocupado, coletor de lixo,
  // disco. É vida normal, e diagnosticar suspensão aqui seria pior que não detectar
  // nenhuma — o alarme perderia o sentido. O limiar é 3×.
  relogio = new Date(relogio.getTime() + 20 * 2);
  await new Promise((r) => setTimeout(r, 120));
  ag.para();

  assert.equal(ag.estado().suspensoes, 0);
  assert.ok(!leHistorico(dir).some((x) => x.evento === 'maquina-suspensa'));
});

test('agendador: depois de acordar, a carência segura a fila antes de materializar', async () => {
  // A segunda população de falha medida entre 18 e 21/09/2026: cargas de duração
  // NORMAL que terminaram de 1 s a 110 s depois de um evento de retomada do Windows.
  // Elas não atravessaram o sono — nasceram com a pilha de rede ainda subindo. Ao
  // acordar, os relógios de TODOS os grupos batem de uma vez, então sem carência o
  // primeiro trabalho do agendador ao voltar é disparar tudo no pior momento possível.
  const dir = tmp();
  let relogio = new Date('2026-09-20T12:32:27.000Z');
  const comecos: number[] = [];

  const ag = new Agendador({
    raiz: ROOT,
    snapshotDir: dir,
    anuncia: () => {},
    batimentoMs: 20,
    carenciaMs: 400,
    agora: () => relogio,
    roda: async (_g: GrupoDeRefresh) => {
      comecos.push(Date.now());
      return { ok: true };
    },
  });

  ag.inicia();
  await drena(ag, 3);
  const antes = ag.estado().execucoes;

  // Dorme e acorda com a fila vazia; os relógios de grupo vencem todos juntos.
  relogio = new Date(relogio.getTime() + 8_040_000);
  await esperaAte(() => ag.estado().suspensoes === 1, 'a suspensão ser detectada');
  ag.pede('quente');

  // Durante a carência: o pedido ESPERA na fila, não é perdido e não roda.
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ag.estado().execucoes, antes, 'nada pode começar durante a carência');
  assert.deepEqual(ag.estado().fila, ['quente'], 'e o trabalho não pode se perder');

  // Vencida a carência, a fila anda sozinha — sem depender do próximo relógio.
  await esperaAte(() => ag.estado().execucoes === antes + 1, 'a fila destravar sozinha');
  ag.para();
});
