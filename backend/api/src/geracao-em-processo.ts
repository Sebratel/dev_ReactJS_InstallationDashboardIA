// A busca ao vivo num PROCESSO FILHO (`filho-ao-vivo.ts`), e não na thread principal.
//
// **Por que (24/10/2026).** A busca de um conjunto roda o mesmo pipeline do refresh — SQL,
// passos do Power Query e colunas calculadas — sobre 44–100 mil protocolos, e isso pede
// memória de refresh: sem teto, 1,9 GB de pico para o conjunto do ano e 2,3 GB para o da
// janela. Dentro da API, com o heap do pai em 1024 MB (Dockerfile), a subida com as 13
// páginas ao vivo morreu por heap em ~2 min: as duas buscas correndo juntas na thread que
// também serve HTTP. É a mesma regra do refresh (`executa-grupo.ts`): materializar dentro
// da API faz o pico da carga e o da API serem o MESMO pico. No filho, o heap da API fica
// plano e a memória da busca volta inteira ao sistema quando ele sai.
//
// **O teto do filho, medido.** Uma consulta por vez dentro dele (`buscaDaJanela`,
// `buscaDoAno`), a janela cabe em 800 MB de heap e não em 640; o ano, idem. O mês da
// agenda, desde que traz a agenda completa (25/10/2026), também: setembro de 2026, 208 mil
// linhas, coube em 800 (pico de 917 MB de RSS) e não em 640 — e por isso o período da
// agenda ao vivo é de um mês (`TETO_DE_DIAS_DA_AGENDA`). 1024 MB dão ≥ 22% de folga, com
// pico de 0,9–1,2 GB de RSS. Quem chama põe TODAS as buscas numa fila de UMA
// (`FilaDeBuscas`): pai 768 + workers 2 × 512 + um filho de até 1024 é o que cabe nos
// 3072 MB da `api` (`piscina-workers.test.ts`).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConjuntoAoVivo, PedidoDeGeracao } from './geracao-do-conjunto.ts';

const ENTRADA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'filho-ao-vivo.ts');

/**
 * Ver o cabeçalho: medido, não chutado. Fixo no código, e não numa variável da stack, de
 * propósito: o teste do contrato de memória (`piscina-workers.test.ts`) só enxerga o que
 * está no repositório.
 */
export const HEAP_DO_CONJUNTO_MB = 1024;

/** A busca mais longa medida levou ~95 s; 10 min corta conexão pendurada sem cortar busca lenta. */
export const TEMPO_MAXIMO_DO_FILHO_MS = 10 * 60_000;

/** Quantas linhas finais da saída de erro do filho entram na mensagem da falha, e a largura de cada. */
const LINHAS_DE_ERRO = 3;
const LARGURA = 200;

export interface ResultadoDaGeracao {
  readonly protocolos: number;
  /** O maior RSS do processo filho, em MB — o custo de memória desta busca. */
  readonly picoMB: number;
}

/** O teto de heap do filho de um conjunto — o mesmo para os três, ver o cabeçalho. */
export function heapDoFilhoMB(_conjunto: ConjuntoAoVivo): number {
  return HEAP_DO_CONJUNTO_MB;
}

/** O argv do filho. Separado para o teste afirmar sobre ele sem criar processo. */
export function argvDoFilho(pedido: PedidoDeGeracao, heapMB: number): string[] {
  return [`--max-old-space-size=${heapMB}`, ENTRADA, JSON.stringify(pedido)];
}

function cauda(bruto: string): string {
  return bruto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    // O que não diz o motivo: a pilha nativa do V8 num estouro de heap (dezenas de linhas
    // de endereço), os quadros da pilha de JS e a versão que o Node imprime ao sair. Sem
    // este corte, as últimas linhas eram exatamente estas, e a do `Error: …` ficava de fora
    // (medido em 25/10/2026: uma busca que falhou deixou só "at async …" no log).
    .filter((l) => !/^\d+: [0-9A-Fa-fx]+ /.test(l) && !/^at /.test(l) && !/^Node\.js v/.test(l) && !/^[{}()^]+$/.test(l))
    .slice(-LINHAS_DE_ERRO)
    .map((l) => (l.length > LARGURA ? `${l.slice(0, LARGURA)}...` : l))
    .join(' | ');
}

/**
 * Roda a geração num filho e resolve com o que ele trouxe. Rejeita com a cauda da saída
 * de erro quando ele sai com código ≠ 0, é morto pelo prazo, ou não sobe.
 */
export function geraEmProcesso(
  root: string,
  pedido: PedidoDeGeracao,
  o: { heapMB?: number; tempoMaximoMs?: number; cria?: typeof spawn } = {},
): Promise<ResultadoDaGeracao> {
  const cria = o.cria ?? spawn;
  return new Promise((ok, falha) => {
    const filho = cria(process.execPath, argvDoFilho(pedido, o.heapMB ?? heapDoFilhoMB(pedido.conjunto)), {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let saida = '';
    let erro = '';
    // Só o fim interessa; guardar tudo seria segurar memória na API por nada.
    filho.stdout?.on('data', (p: Buffer | string) => {
      saida = (saida + String(p)).slice(-8192);
    });
    filho.stderr?.on('data', (p: Buffer | string) => {
      erro = (erro + String(p)).slice(-8192);
    });
    let morto = false;
    const prazo = setTimeout(() => {
      morto = true;
      filho.kill('SIGKILL');
    }, o.tempoMaximoMs ?? TEMPO_MAXIMO_DO_FILHO_MS);
    prazo.unref?.();
    // Sem ouvinte, um `'error'` (binário ausente, sistema recusando processo) derrubaria a API.
    filho.on('error', (e: unknown) => {
      clearTimeout(prazo);
      falha(e instanceof Error ? e : new Error(String(e)));
    });
    filho.on('exit', (codigo, sinal) => {
      clearTimeout(prazo);
      if (codigo === 0) {
        const ultima = saida.trim().split(/\r?\n/).at(-1) ?? '';
        try {
          const r = JSON.parse(ultima) as ResultadoDaGeracao;
          if (typeof r.protocolos === 'number') return ok(r);
        } catch {
          // cai na falha abaixo
        }
        return falha(new Error('o processo da busca saiu sem dizer o que trouxe'));
      }
      const porque = morto ? `passou de ${Math.round((o.tempoMaximoMs ?? TEMPO_MAXIMO_DO_FILHO_MS) / 1000)} s` : `saiu com ${codigo ?? sinal}`;
      const c = cauda(erro);
      falha(new Error(`o processo da busca ${porque}${c ? ` — ${c}` : ''}`));
    });
  });
}
