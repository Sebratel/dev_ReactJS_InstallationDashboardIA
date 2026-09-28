// Desligamento limpo: SIGTERM/SIGINT param a API em ordem, com teto de tempo.
//
// **Por que existe (27/09/2026, ACHADOS #157).** A API não tratava SIGTERM. No contêiner
// ela era o PID 1, e o Linux não entrega ao PID 1 sinal sem tratador: `docker stop`
// esperava os 10 s de cortesia e matava com SIGKILL — pedido em curso cortado, e nenhuma
// linha no log dizendo que foi desligamento e não queda. O `init: true` do compose tira
// a API do PID 1; este módulo faz o sinal virar uma saída ordenada.
//
// A ordem: parar de aceitar conexão, parar quem gera trabalho (agendador, poller,
// aquecedor), dar alguns segundos para os pedidos em curso terminarem, cortar o que
// sobrou (o SSE nunca termina sozinho) e sair 0. Se algo emperrar, o teto sai 1 antes
// de o Docker desistir. Um segundo sinal é alguém com pressa: sai na hora.
//
// No Windows (`npm start`) o `tools/subir` mata a API com `kill()`, que lá é
// TerminateProcess — não passa por aqui. Isto vale para o contêiner e para Ctrl+C.

import type http from 'node:http';

export interface PassoDeDesligamento {
  nome: string;
  fn: () => void | Promise<void>;
}

export interface OpcoesDeDesligamento {
  /** Os passos, em ordem. Um que lança não impede os seguintes. */
  passos: readonly PassoDeDesligamento[];
  /** Teto do desligamento inteiro. 8 s: abaixo dos 10 s do `docker stop`. */
  tetoMs?: number;
  processo?: Pick<NodeJS.Process, 'once'>;
  sai?: (codigo: number) => void;
  anuncia?: (linha: string) => void;
}

export const TETO_DESLIGAMENTO_MS = 8_000;

/**
 * Liga os tratadores de SIGTERM e SIGINT. Devolve a função que desliga — é ela que os
 * sinais chamam, e é por ela que o teste dispara sem mandar sinal de verdade.
 */
export function instalaDesligamento(opts: OpcoesDeDesligamento): (sinal: string) => Promise<void> {
  const processo = opts.processo ?? process;
  const sai = opts.sai ?? ((c: number): void => void process.exit(c));
  const anuncia = opts.anuncia ?? ((l: string) => console.error(l));
  const tetoMs = opts.tetoMs ?? TETO_DESLIGAMENTO_MS;
  let emCurso = false;

  const desliga = async (sinal: string): Promise<void> => {
    if (emCurso) {
      anuncia(`[desligamento] ${sinal} de novo — saindo agora, sem esperar.`);
      sai(1);
      return;
    }
    emCurso = true;
    const inicio = Date.now();
    anuncia(`[desligamento] ${sinal} recebido — encerrando em ordem (teto ${tetoMs / 1000} s).`);
    const teto = setTimeout(() => {
      anuncia(`[desligamento] teto de ${tetoMs / 1000} s estourado — saindo à força.`);
      sai(1);
    }, tetoMs);
    teto.unref?.();

    for (const p of opts.passos) {
      // Uma linha ANTES de cada passo: se o processo morrer no meio, a última linha diz onde.
      anuncia(`[desligamento]   ${p.nome}…`);
      try {
        await p.fn();
      } catch (err) {
        anuncia(`[desligamento] '${p.nome}' falhou, seguindo: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    clearTimeout(teto);
    anuncia(`[desligamento] encerrado em ${Date.now() - inicio} ms.`);
    sai(0);
  };

  processo.once('SIGTERM', () => void desliga('SIGTERM'));
  processo.once('SIGINT', () => void desliga('SIGINT'));
  return desliga;
}

/**
 * Fecha o servidor HTTP: para de aceitar conexão, fecha as ociosas na hora, dá `folgaMs`
 * para as que têm pedido em curso e corta o resto — o SSE (`/api/eventos`) nunca fecha
 * sozinho, e o navegador reconecta na instância nova.
 */
export function fechaHttp(servidor: http.Server, folgaMs = 3_000): Promise<void> {
  return new Promise((pronto) => {
    servidor.close(() => pronto());
    servidor.closeIdleConnections();
    const corta = setTimeout(() => servidor.closeAllConnections(), folgaMs);
    corta.unref?.();
  });
}
