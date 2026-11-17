import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assinaEventos } from '../src/services/eventosService.ts';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instancias: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  fechado = false;
  readonly #ouvintes = new Map<string, Array<() => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instancias.push(this);
  }

  addEventListener(tipo: string, cb: () => void): void {
    const lista = this.#ouvintes.get(tipo) ?? [];
    lista.push(cb);
    this.#ouvintes.set(tipo, lista);
  }

  emiteEventoNomeado(tipo: string): void {
    for (const cb of this.#ouvintes.get(tipo) ?? []) cb();
  }

  simulaAbertura(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }

  simulaQuedaFatal502(): void {
    // No HTML5 EventSource, um 502/503/504 do proxy muda readyState para CLOSED (2) e dispara onerror sem reconectar sozinho.
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event('error'));
  }

  close(): void {
    this.fechado = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe('assinaEventos (reconexão automática de SSE)', () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    FakeEventSource.instancias = [];
    vi.useFakeTimers();
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.EventSource = originalEventSource;
  });

  it('reabre EventSource com backoff quando cai em CLOSED (ex.: 502 no restart da API) e avisa aoReconectar', () => {
    const mudancas: string[][] = [];
    const acessos: number[] = [];
    const reconexoes: number[] = [];

    const desinscreve = assinaEventos(
      (ids) => mudancas.push(ids),
      () => acessos.push(1),
      () => reconexoes.push(1),
    );

    expect(FakeEventSource.instancias).toHaveLength(1);
    const primeira = FakeEventSource.instancias[0]!;
    primeira.simulaAbertura();
    expect(reconexoes).toHaveLength(0);

    // Simula restart da API em que o Nginx devolve 502 e o navegador fecha o EventSource permanentemente.
    primeira.simulaQuedaFatal502();
    expect(primeira.fechado).toBe(true);
    expect(FakeEventSource.instancias).toHaveLength(1);

    // Após 1s de backoff, abre nova instância automaticamente.
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instancias).toHaveLength(2);
    const segunda = FakeEventSource.instancias[1]!;

    // Se falhar de novo imediatamente, dobra o backoff para 2s.
    segunda.simulaQuedaFatal502();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instancias).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instancias).toHaveLength(3);

    const terceira = FakeEventSource.instancias[2]!;
    terceira.simulaAbertura();
    expect(reconexoes).toHaveLength(1);

    // A nova instância entrega eventos normalmente.
    terceira.onmessage?.({ data: JSON.stringify({ dashboards: ['visao-geral'] }) } as MessageEvent);
    terceira.emiteEventoNomeado('acessos');
    expect(mudancas).toEqual([['visao-geral']]);
    expect(acessos).toHaveLength(1);

    // Ao desinscrever, fecha a conexão atual e não agenda mais reconexões.
    desinscreve();
    expect(terceira.fechado).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instancias).toHaveLength(3);
  });
});
