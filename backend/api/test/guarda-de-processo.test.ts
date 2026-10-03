// A guarda de processo da API — `backend/api/src/guarda-de-processo.ts`.
//
// **`snapshotDir` é SEMPRE temporário aqui**, pela mesma razão de
// `agendador.test.ts`: escrever no `snapshot/` real faz `/api/saude` mentir. Ver o
// aviso lá, que veio de defeito de verdade em 16/09/2026.
//
// O `process` também é SEMPRE de mentira. Instalar um `uncaughtException` de verdade
// no processo do `node --test` sequestraria o relator de erros do próprio corredor de
// testes, e um teste que quebra a ferramenta que o executa não é um teste.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  instalaGuardaDeProcesso,
  JANELA_MS,
  TETO_DE_ERROS,
} from '../src/guarda-de-processo.ts';
import { leHistorico } from '../../tools/refresh/src/historico.ts';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guarda-'));
}

/** Um `process` de mentira: guarda os ouvintes para o teste os disparar à mão. */
function processoFalso(): {
  processo: Pick<NodeJS.Process, 'on'>;
  dispara: (evento: string, carga: unknown) => void;
  /** Função, e não instantâneo: os ouvintes só existem DEPOIS de a guarda instalar. */
  ouvindo: () => string[];
} {
  const ouvintes = new Map<string, (c: unknown) => void>();
  return {
    processo: {
      on: ((evento: string, fn: (c: unknown) => void) => {
        ouvintes.set(evento, fn);
        return undefined as never;
      }) as Pick<NodeJS.Process, 'on'>['on'],
    },
    dispara: (evento, carga) => {
      const fn = ouvintes.get(evento);
      if (!fn) throw new Error(`nada escuta '${evento}' — a guarda não instalou o ouvinte`);
      fn(carga);
    },
    ouvindo: () => [...ouvintes.keys()],
  };
}

function montaGuarda(dir: string, relogio: { agora: Date }) {
  const f = processoFalso();
  const saidas: number[] = [];
  const ditas: string[] = [];
  const estado = instalaGuardaDeProcesso({
    snapshotDir: dir,
    processo: f.processo,
    agora: () => relogio.agora,
    anuncia: (l) => ditas.push(l),
    desiste: (c) => saidas.push(c),
  });
  return { ...f, estado, saidas, ditas };
}

test('guarda: escuta os DOIS eventos que matam o Node', () => {
  const dir = tmp();
  const f = processoFalso();
  instalaGuardaDeProcesso({ snapshotDir: dir, processo: f.processo, anuncia: () => {} });
  // `unhandledRejection` não é opcional: desde o Node 15 o padrão é `throw`, e uma
  // promessa órfã de qualquer dependência derruba a tela igual a uma exceção.
  assert.deepEqual(f.ouvindo().sort(), ['uncaughtException', 'unhandledRejection']);
});

test('guarda: um erro isolado é registrado e a API CONTINUA servindo', () => {
  const dir = tmp();
  const relogio = { agora: new Date('2026-09-21T12:00:00.000Z') };
  const g = montaGuarda(dir, relogio);

  g.dispara('uncaughtException', new Error('leitura de coluna inexistente'));

  assert.deepEqual(g.saidas, [], 'um erro só NÃO pode derrubar a API — a tela é o produto');
  assert.equal(g.estado().total, 1);
  const e = leHistorico(dir).find((x) => x.evento === 'erro-nao-tratado');
  assert.ok(e, 'sem registro, o próximo a investigar tem só `api-morreu codigo: 1`');
  assert.equal((e as { origem: string }).origem, 'uncaughtException');
  assert.equal((e as { fatal: boolean }).fatal, false);
  assert.equal((e as { erro: string }).erro, 'leitura de coluna inexistente');
});

test('guarda: promessa órfã entra pelo outro ouvinte e conta igual', () => {
  const dir = tmp();
  const relogio = { agora: new Date('2026-09-21T12:00:00.000Z') };
  const g = montaGuarda(dir, relogio);

  // Rejeição com valor que NÃO é Error — é o caso que um `err.message` distraído
  // transformaria em `undefined` no log, justamente quando o log é tudo que há.
  g.dispara('unhandledRejection', 'ECONNRESET');

  assert.equal(g.estado().total, 1);
  const e = leHistorico(dir).find((x) => x.evento === 'erro-nao-tratado');
  assert.equal((e as { origem: string }).origem, 'unhandledRejection');
  assert.equal((e as { erro: string }).erro, 'ECONNRESET');
});

test('guarda: RAJADA acima do teto desiste — e registra ANTES de sair', () => {
  const dir = tmp();
  const relogio = { agora: new Date('2026-09-21T12:00:00.000Z') };
  const g = montaGuarda(dir, relogio);

  for (let i = 0; i < TETO_DE_ERROS; i += 1) {
    g.dispara('uncaughtException', new Error(`falha ${i}`));
  }

  assert.deepEqual(g.saidas, [1], 'rajada é processo quebrado, não azar: sair é o certo');
  const eventos = leHistorico(dir).filter((x) => x.evento === 'erro-nao-tratado');
  assert.equal(eventos.length, TETO_DE_ERROS);
  // O registro precede a desistência: num processo que está saindo, é a única coisa
  // que sobrevive para quem for investigar depois.
  assert.equal((eventos[TETO_DE_ERROS - 1] as { fatal: boolean }).fatal, true);
  assert.equal((eventos[0] as { fatal: boolean }).fatal, false);
});

test('guarda: erros espaçados NUNCA acumulam até o teto', () => {
  const dir = tmp();
  const relogio = { agora: new Date('2026-09-21T12:00:00.000Z') };
  const g = montaGuarda(dir, relogio);

  // Um erro a cada janela e meia, o dobro do teto de vezes. Se a contagem fosse
  // cumulativa em vez de deslizante, isto derrubaria uma API que só teve azar
  // esparso ao longo de meia hora — o oposto do que a guarda existe para fazer.
  for (let i = 0; i < TETO_DE_ERROS * 2; i += 1) {
    relogio.agora = new Date(relogio.agora.getTime() + JANELA_MS * 1.5);
    g.dispara('uncaughtException', new Error(`esparso ${i}`));
  }

  assert.deepEqual(g.saidas, []);
  assert.equal(g.estado().total, TETO_DE_ERROS * 2);
  assert.equal(g.estado().naJanela, 1, 'a janela reabre a cada erro espaçado');
});

test('guarda: histórico ilegível não impede a API de sobreviver ao erro', () => {
  // `registra` é silenciosa em qualquer falha (a regra de `historico.ts`:
  // observabilidade não interrompe trabalho). Se um disco cheio fizesse a guarda
  // lançar, o remédio matava o paciente — a guarda VIRARIA a causa da queda.
  const dir = path.join(tmp(), 'nao', 'existe', 'este', 'caminho');
  const relogio = { agora: new Date('2026-09-21T12:00:00.000Z') };
  const g = montaGuarda(dir, relogio);

  assert.doesNotThrow(() => g.dispara('uncaughtException', new Error('disco cheio')));
  assert.deepEqual(g.saidas, []);
  assert.equal(g.estado().total, 1);
});

test('guarda: o estado é consultável — "de pé" e "de pé tendo engolido 7" são diferentes', () => {
  const dir = tmp();
  const relogio = { agora: new Date('2026-09-21T12:00:00.000Z') };
  const g = montaGuarda(dir, relogio);

  assert.deepEqual(g.estado(), { total: 0, naJanela: 0, ultimo: null });
  g.dispara('uncaughtException', new Error('x'));
  const depois = g.estado();
  assert.equal(depois.total, 1);
  assert.equal(depois.ultimo, '2026-09-21T12:00:00.000Z');
});
