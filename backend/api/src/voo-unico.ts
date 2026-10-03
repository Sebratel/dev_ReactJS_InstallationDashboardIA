// Single-flight: por chave, no máximo UM cálculo em andamento.
//
// **O número que justifica isto**, medido na API de verdade em 08/09/2026, com
// `snapshot/` real e 2 workers — 6 GET idênticos e simultâneos em MISS contra
// `diario-instalacao`:
//
//     req1..req4 ..... 15,5 s
//     req5, req6 ..... 25,7 s
//     worker_ms ...... média 10,3 s, pico 17,5 s
//     concorrentes_mesma_chave_max = 4    calculos_duplicados = 4
//
// Seis pedidos pela **mesma resposta** pagaram seis cálculos, numa piscina de
// duas workers, e os dois últimos esperaram 25,7 s por uma página que custa
// ~10 s a frio. Não era carga de pico: era a mesma conta feita seis vezes.
//
// **E o SSE fabrica exatamente essa rajada.** Quando o poller detecta mudança, a
// API invalida o cache daquela página e avisa por `GET /api/eventos`. Todos os
// navegadores com a página aberta acordam no mesmo instante, e como o escopo do
// cache é o mesmo para todos (`escopo-cache.ts`, ACHADOS #102), eles pedem a
// MESMA chave — logo depois de a entrada ter sido apagada. Sem esta peça, cada
// evento de realtime custa um cálculo por espectador. Com ela, um.
//
// **O que este módulo NÃO é.** Não é cache: não guarda resultado, não tem TTL,
// não conhece Redis. Ele só faz N esperas convergirem numa execução enquanto ela
// dura, e some no instante em que ela termina. Quem guarda o resultado é o cache
// de resposta, que continua exatamente onde estava.
//
// **A chave é a MESMA do cache de resposta** (`chaveDaResposta`), e é isso que
// dá de graça duas propriedades que seriam trabalhosas de manter à mão:
//
//   * pedidos de recortes diferentes nunca se fundem — filtros, visuais, janela
//     e clicados já estão na chave;
//   * um snapshot novo (ou a virada do dia UTC) muda o carimbo, muda a chave, e
//     um pedido novo **não pode** entrar num voo iniciado sob o dado velho.

/** O resultado de um voo, e se quem chamou foi quem o iniciou. */
export interface Voo<T> {
  valor: T;
  /**
   * `true` para quem disparou o cálculo, `false` para quem pegou carona.
   *
   * Sai na resposta como `cache: 'coalescido'` e vira contador. Sem distinguir os
   * dois, o ganho desta peça seria invisível de fora: um servidor que funde 20
   * pedidos em 1 e um que calcula os 20 respondem a mesma coisa, e só o relógio
   * denuncia a diferença.
   */
  iniciou: boolean;
}

export class VooUnico {
  readonly #emVoo = new Map<string, Promise<unknown>>();
  /**
   * Um dado opaco por voo em andamento, para quem chega poder saber ALGO sobre o
   * voo em que vai entrar antes de entrar nele.
   *
   * Existe por um caso concreto (F3): a prioridade de fila é a de quem iniciou o
   * voo, então um clique que pega carona num aquecimento herda a posição de fila
   * dele. Saber disso exige comparar a prioridade do pedido com a do voo — e o
   * único jeito de essa comparação não vazar é o rótulo viver e morrer junto com
   * o voo, sob a mesma conferência de identidade. Um `Map` paralelo no `Servidor`
   * ficaria com entradas para sempre no dia em que o cálculo lançasse.
   *
   * `VooUnico` não interpreta o valor: para ele é um `unknown` que entra e sai.
   */
  readonly #rotulos = new Map<string, unknown>();

  /** Quantos cálculos distintos estão em andamento agora. Sai em `/api/saude`. */
  get emAndamento(): number {
    return this.#emVoo.size;
  }

  /** O rótulo do voo desta chave, ou `undefined` se não há voo em andamento. */
  rotuloDe(chave: string): unknown {
    return this.#rotulos.get(chave);
  }

  /**
   * Executa `executar()` — ou entra no que já estiver rodando para esta chave.
   *
   * **A entrada é registrada antes de qualquer `await`**, e isso não é detalhe: o
   * corpo de uma função `async` roda de forma síncrona até o primeiro `await`,
   * então dois pedidos que chegam no mesmo tick do event loop veem o mesmo
   * mapa. Se o registro ficasse depois de um `await`, a janela entre a decisão e
   * a gravação deixaria passar exatamente a rajada que isto existe para fundir.
   *
   * **A limpeza é atada à promessa, não ao `await` de quem chamou.** Amarrá-la ao
   * `finally` do iniciador funcionaria hoje, mas passaria a depender de o
   * iniciador continuar sendo quem espera — e o dia em que alguém disparar um voo
   * sem esperar por ele, a chave ficaria presa para sempre. `then(ok, erro)` com
   * os dois braços também impede que a rejeição vire "unhandled": o braço de erro
   * a consome nesta derivação, e a original continua sendo tratada por quem
   * espera.
   *
   * **A conferência de identidade na limpeza** (`=== promessa`) evita que um voo
   * que terminou apague o registro de um voo NOVO da mesma chave, iniciado no
   * intervalo — o que faria o terceiro pedido calcular de novo em vez de esperar.
   */
  async faz<T>(chave: string, executar: () => Promise<T>, rotulo?: unknown): Promise<Voo<T>> {
    const existente = this.#emVoo.get(chave) as Promise<T> | undefined;
    if (existente !== undefined) {
      return { valor: await existente, iniciou: false };
    }

    // O `async` aqui normaliza um `executar()` que lance de forma SÍNCRONA: sem
    // ele, a exceção subiria antes de a entrada existir no mapa em uns casos e
    // depois em outros, e a limpeza teria de cobrir os dois.
    const promessa = (async () => await executar())();
    this.#emVoo.set(chave, promessa);
    // O `else` importa: um voo novo sem rótulo tem de APAGAR o do anterior, senão
    // a chave passaria a carregar o rótulo de um voo que já terminou.
    if (rotulo !== undefined) this.#rotulos.set(chave, rotulo);
    else this.#rotulos.delete(chave);
    const limpa = (): void => {
      // O rótulo sai sob a MESMA conferência de identidade da promessa: sem ela,
      // o fim de um voo apagaria o rótulo do voo novo que ocupou a chave, e a
      // comparação de prioridade passaria a mentir exatamente sob carga.
      if (this.#emVoo.get(chave) === promessa) {
        this.#emVoo.delete(chave);
        this.#rotulos.delete(chave);
      }
    };
    promessa.then(limpa, limpa);

    return { valor: await promessa, iniciou: true };
  }
}
