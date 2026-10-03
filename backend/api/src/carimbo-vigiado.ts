// Por que a API acredita que está usando ESTE snapshot?
//
// **O defeito que este módulo conserta (B8).** O carimbo do snapshot era
// memoizado e só voltava a ser lido do disco quando um `fs.watch` do diretório
// disparava — dentro de um `try/catch` vazio. Se o watch não entregasse evento,
// nada falhava e nada aparecia em log; a API simplesmente continuava
// acreditando no snapshot de antes. Medido com `npm run probe:watch-snapshot`,
// com o watch morto e um snapshot novo em disco:
//
//   - a chave da resposta aponta para a resposta do snapshot ANTIGO;
//   - `carregadas` não é limpo, e o avaliador segue com o dataset antigo;
//   - o `Aquecedor` lê esse mesmo carimbo e conclui que não há o que aquecer.
//
// As três são silenciosas, e a terceira é a mais traiçoeira: o `Aquecedor` diz,
// no próprio comentário de topo, que trabalha "conferindo o carimbo do snapshot
// de tempos em tempos" — e o memo tinha transformado essa conferida num
// `return` de variável. Dois mecanismos que pareciam independentes dependiam do
// mesmo evento de filesystem.
//
// **A correção NÃO é um terceiro detector.** Já existem três coisas olhando: o
// `fs.watch`, o `Aquecedor` (a cada 5 s) e o poller. Acrescentar um quarto
// relógio seria trocar um modo de falha silenciosa por mais superfície. O que
// este módulo faz é separar duas leituras que estavam confundidas:
//
//   `doMemo()`  — o caminho quente do HTTP, onde 0,57 ms por pedido importa
//                 porque um acerto de cache inteiro custa menos de 10 ms.
//   `confere()` — a leitura de verdade, do disco, usada por quem já roda
//                 periodicamente. Ela reconcilia o memo e, quando os dois
//                 discordam, sabe que o watch não entregou.
//
// A divergência entre os dois é o detector de watch morto, e ele não custa um
// timer novo: sai de uma chamada que já acontecia.
//
// **E o `'error'` do FSWatcher.** `fs.watch` devolve um `EventEmitter` com zero
// ouvintes de `'error'` (conferido em 08/09/2026). Um watch que morre em tempo
// de execução — diretório removido, limite de inotify, mount que sumiu — emite
// `'error'`, e um `'error'` sem ouvinte num `EventEmitter` derruba o processo.
// É o mesmo defeito que o `ioredis` tinha na F2.1, em outro módulo: tudo o mais
// no caminho degradava certo, e quem derrubava era o evento solto do driver.
//
// REGRA DE SAÍDA: o estado publicado carrega carimbo, contagem e horário. O
// carimbo é um hash do manifesto — não é valor de linha, e não identifica
// ninguém.

/** De onde veio o valor que está sendo servido agora. */
export type FonteDoCarimbo = 'disco' | 'memo';

/**
 * O que o observador do diretório está fazendo.
 *
 * `nao-tentado` é diferente de `inativo`: o primeiro é "ninguém pediu o carimbo
 * ainda" (o watch nasce preguiçoso, na primeira leitura), o segundo é "tentou e
 * não deu". Confundir os dois faria uma API recém-subida parecer quebrada.
 */
export type StatusDoWatch = 'nao-tentado' | 'ativo' | 'falhou' | 'morreu';

export interface EstadoDoCarimbo {
  /** O carimbo que a API está servindo. `null` antes da primeira leitura. */
  valor: string | null;
  /** `disco` quando a última leitura foi real; `memo` quando veio da memória. */
  fonte: FonteDoCarimbo;
  watch: { status: StatusDoWatch; motivo?: string };
  /** Quando o carimbo mudou de valor pela última vez. */
  ultimaMudanca: string | null;
  /** Quando o disco foi lido pela última vez — não quando o memo foi devolvido. */
  ultimoCheck: string | null;
  checagens: number;
  mudancas: number;
  /**
   * Quantas vezes o disco discordou do memo.
   *
   * **É o número que denuncia o watch morto.** Maior que zero quer dizer que o
   * carimbo mudou em disco e o `fs.watch` não avisou — a API esteve servindo o
   * snapshot antigo até alguém conferir. Zero, com `watch.status = 'ativo'` e
   * `mudancas > 0`, é a prova de que o watch está entregando.
   */
  divergencias: number;
}

/** O que um observador de diretório precisa oferecer. `fs.watch`, em produção. */
export interface Observador {
  close(): void;
  on(evento: 'error', ouvinte: (err: unknown) => void): unknown;
  unref?(): unknown;
}

export interface OpcoesDoCarimbo {
  /** A conta do carimbo: manifesto mais tabelas calculadas. Pode lançar. */
  leDoDisco: () => string;
  /**
   * Liga o observador do diretório. Devolve `null` quando não há diretório para
   * observar — que não é falha, é uma API sem snapshot ainda.
   *
   * Lançar aqui é tratado como falha de bind: vira `status: 'falhou'` com o
   * motivo, e NÃO é engolido em silêncio.
   */
  vigia: (aoMudar: () => void, aoMorrer: (err: unknown) => void) => Observador | null;
  agora?: () => Date;
  /** Onde as linhas aparecem. Padrão: `console.error`. */
  anuncia?: (linha: string) => void;
}

export class CarimboVigiado {
  readonly #leDoDisco: () => string;
  readonly #vigia: OpcoesDoCarimbo['vigia'];
  readonly #agora: () => Date;
  readonly #anuncia: (linha: string) => void;

  #memo: string | null = null;
  #fonte: FonteDoCarimbo = 'disco';
  #observador: Observador | null = null;
  #status: StatusDoWatch = 'nao-tentado';
  #motivo: string | undefined;
  #ultimaMudanca: Date | null = null;
  #ultimoCheck: Date | null = null;
  #checagens = 0;
  #mudancas = 0;
  #divergencias = 0;

  constructor(opts: OpcoesDoCarimbo) {
    this.#leDoDisco = opts.leDoDisco;
    this.#vigia = opts.vigia;
    this.#agora = opts.agora ?? (() => new Date());
    this.#anuncia = opts.anuncia ?? ((l) => console.error(l));
  }

  /**
   * O carimbo pelo caminho barato — memo se houver, disco na primeira vez.
   *
   * É o que o caminho quente do HTTP usa. A defasagem possível é a mesma que o
   * `fs.watch` sempre teve, com uma diferença: agora ela é LIMITADA, porque
   * `confere()` roda de qualquer jeito a cada volta do `Aquecedor`.
   */
  doMemo(): string {
    this.ligaVigia();
    if (this.#memo !== null) {
      this.#fonte = 'memo';
      return this.#memo;
    }
    return this.confere();
  }

  /**
   * O carimbo lido do DISCO, reconciliando o memo.
   *
   * Chamado por quem já roda de tempos em tempos — o `Aquecedor` a cada 5 s e
   * `GET /api/saude`. Nenhum timer novo: é a mesma chamada de antes, que só
   * voltou a fazer o que o nome dela diz.
   */
  confere(): string {
    this.ligaVigia();
    const valor = this.#leDoDisco();
    const agora = this.#agora();
    this.#checagens += 1;
    this.#ultimoCheck = agora;
    this.#fonte = 'disco';

    if (this.#memo !== null && this.#memo !== valor) {
      // O disco discordou do memo. Ou o `fs.watch` não entregou o evento, ou
      // entregou depois — de qualquer forma, a API esteve servindo o carimbo
      // velho até esta linha. É o sintoma que B8 escondia.
      this.#divergencias += 1;
      if (this.#status === 'ativo') {
        this.#status = 'morreu';
        this.#motivo = 'o disco mudou e o watch não avisou';
        this.#anuncia(
          `[carimbo] o snapshot mudou sem o fs.watch avisar — a conferida periódica pegou. ` +
            `A API estava servindo o carimbo anterior. Divergências: ${this.#divergencias}.`,
        );
      }
    }

    if (this.#memo !== valor) {
      this.#memo = valor;
      this.#mudancas += 1;
      this.#ultimaMudanca = agora;
    }
    return valor;
  }

  /** Esquece o memo — o `fs.watch` disparou, ou o poller invalidou uma tabela. */
  esquece(): void {
    this.#memo = null;
  }

  estado(): EstadoDoCarimbo {
    return {
      valor: this.#memo,
      fonte: this.#fonte,
      watch: this.#motivo === undefined
        ? { status: this.#status }
        : { status: this.#status, motivo: this.#motivo },
      ultimaMudanca: this.#ultimaMudanca?.toISOString() ?? null,
      ultimoCheck: this.#ultimoCheck?.toISOString() ?? null,
      checagens: this.#checagens,
      mudancas: this.#mudancas,
      divergencias: this.#divergencias,
    };
  }

  para(): void {
    this.#observador?.close();
    this.#observador = null;
    if (this.#status === 'ativo') this.#status = 'nao-tentado';
  }

  /**
   * Liga o observador na primeira leitura — preguiçoso porque o diretório pode
   * não existir quando o servidor sobe, e morrer no arranque por causa disso
   * seria trocar uma degradação por indisponibilidade.
   *
   * Uma tentativa que falhou NÃO é repetida a cada leitura: `falhou` e
   * `sem-diretorio` são estados finais até um restart. Repetir faria um
   * `fs.watch` que sempre falha custar uma syscall por pedido HTTP, e encheria
   * o log com a mesma linha para sempre — que é o defeito que a F2.1 consertou
   * no Redis.
   */
  private ligaVigia(): void {
    if (this.#status !== 'nao-tentado') return;
    try {
      const obs = this.#vigia(
        () => this.esquece(),
        (err) => {
          // O watch morreu em tempo de execução. Sem este caminho, o `'error'`
          // do `FSWatcher` sobe como exceção não tratada e o processo MORRE.
          this.#status = 'morreu';
          this.#motivo = mensagem(err);
          this.#observador = null;
          this.#memo = null;
          this.#anuncia(
            `[carimbo] o observador do snapshot morreu (${this.#motivo}). ` +
              `A conferida periódica passa a ser a única garantia.`,
          );
        },
      );
      if (obs === null) {
        // Sem diretório ainda. NÃO é estado final: o snapshot pode aparecer, e
        // aí a próxima leitura tenta de novo.
        this.#status = 'nao-tentado';
        return;
      }
      this.#observador = obs;
      this.#status = 'ativo';
      this.#motivo = undefined;
      obs.unref?.();
    } catch (err) {
      // **Aqui morava o `catch {}` vazio.** Um `fs.watch` que não sobe é
      // degradação prevista (sistema de arquivos sem inotify, limite de watches,
      // mount de rede) — a API continua correta, porque a conferida periódica
      // lê o disco. O que não podia é isso ser invisível.
      this.#status = 'falhou';
      this.#motivo = mensagem(err);
      this.#anuncia(
        `[carimbo] fs.watch não subiu (${this.#motivo}). A API continua correta: ` +
          `o carimbo passa a ser conferido em disco a cada volta do aquecedor.`,
      );
    }
  }
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
