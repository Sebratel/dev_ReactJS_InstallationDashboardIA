// A última linha de defesa da API: um erro que ninguém pegou não pode tirar a tela do
// ar sem deixar rastro.
//
// **O defeito que ela fecha é medido.** `snapshot/refresh-historico.log` registrou em
// 18/09/2026 `api-morreu, codigo: 1, depois de 1125 s no ar`. Código 1 em Node é
// exceção não tratada, e era tudo que ficava: nem a mensagem, nem a pilha, nem qual
// pedido a provocou. A operação ficou sem painel e ninguém tinha como dizer por quê.
//
// **A decisão difícil, e por que ela é esta.** O conselho de manual é sair do processo
// depois de um `uncaughtException`, porque o estado pode estar corrompido. Ele vale
// para um servidor que ESCREVE. Esta API é estritamente somente-leitura (regra 2 do
// CLAUDE.md): ela lê snapshot de disco e devolve JSON. O "estado" que poderia
// corromper é cache — descartável por construção. Entre servir dado de um minuto atrás
// e não servir nada, a tela é o produto: é o mesmo raciocínio que `#recusa` no
// agendador já aplica ("derrubar a API por causa disso trocaria dado velho por tela
// nenhuma").
//
// **Mas não a qualquer preço.** Erro não tratado em RAJADA não é um pedido azarado: é
// um processo quebrado, e insistir nele serve respostas que ninguém entende. Passando
// do teto, a guarda desiste e sai com código diferente de zero — que é o que faz o
// `restart: unless-stopped` do contêiner, ou o operador, subir uma instância limpa.
//
// REGRA DE SAÍDA: mensagem de erro e contagem. O `erro` de um pedido pode conter
// caminho e id; nunca imprime corpo de resposta nem valor de linha (regra 6).

import { registra } from '../../../tools/refresh/src/historico.ts';

/**
 * Quantos erros não tratados cabem na janela antes de a guarda desistir.
 *
 * Dez é folgado de propósito: o caso que esta guarda existe para cobrir é o erro
 * ISOLADO — uma borda de parsing, um pedido malformado, uma promessa órfã de
 * biblioteca. Um processo que produz dez em um minuto não está tendo azar.
 */
export const TETO_DE_ERROS = 10;

/** A janela em que o teto conta. Fora dela, a contagem recomeça. */
export const JANELA_MS = 60_000;

export interface OpcoesDaGuarda {
  /** Onde o `refresh-historico.log` mora — o mesmo do agendador. */
  snapshotDir: string;
  anuncia?: (linha: string) => void;
  agora?: () => Date;
  /** Injetável no teste: em produção é o `process` de verdade. */
  processo?: Pick<NodeJS.Process, 'on'>;
  /** Injetável no teste: em produção é `process.exit`. */
  desiste?: (codigo: number) => void;
}

export interface EstadoDaGuarda {
  /** Erros não tratados desde que o processo subiu. */
  total: number;
  /** Quantos dentro da janela corrente — é este que bate no teto. */
  naJanela: number;
  ultimo: string | null;
}

/**
 * Instala os dois ouvintes e devolve como consultar o que eles viram.
 *
 * Devolver o estado não é enfeite: sem isso, "a API está de pé" e "a API está de pé e
 * já engoliu 7 erros" são indistinguíveis de fora, e a segunda precisa aparecer no
 * `/api/saude` antes de virar a terceira.
 */
export function instalaGuardaDeProcesso(opts: OpcoesDaGuarda): () => EstadoDaGuarda {
  const anuncia = opts.anuncia ?? ((l: string) => console.error(l));
  const agora = opts.agora ?? ((): Date => new Date());
  const processo = opts.processo ?? process;
  const desiste = opts.desiste ?? ((c: number): void => void process.exit(c));

  let total = 0;
  let naJanela = 0;
  let janelaAbriuEm = 0;
  let ultimo: string | null = null;

  const trata = (origem: 'uncaughtException' | 'unhandledRejection', bruto: unknown): void => {
    const quando = agora();
    const t = quando.getTime();
    // A janela é deslizante por reinício, não por soma: um erro a cada dez minutos
    // nunca acumula até o teto, e é exatamente o caso que NÃO deve derrubar nada.
    if (janelaAbriuEm === 0 || t - janelaAbriuEm > JANELA_MS) {
      janelaAbriuEm = t;
      naJanela = 0;
    }
    total += 1;
    naJanela += 1;

    const erro =
      bruto instanceof Error ? `${bruto.message}\n${bruto.stack ?? ''}`.trim() : String(bruto);
    ultimo = quando.toISOString();
    const fatal = naJanela >= TETO_DE_ERROS;

    anuncia(
      `\n[guarda] ERRO NÃO TRATADO (${origem}), o ${total}º deste processo, ` +
        `${naJanela} em ${(JANELA_MS / 1000).toFixed(0)}s:\n${erro}\n` +
        (fatal
          ? '[guarda] rajada acima do teto — isto não é azar, é o processo quebrado. Saindo para subir limpo.\n'
          : '[guarda] a API CONTINUA servindo: ela é somente-leitura e lê snapshot de disco.\n'),
    );

    // O registro vem antes da desistência de propósito: num processo que está saindo,
    // é a única coisa que sobrevive para o próximo a investigar.
    registra(opts.snapshotDir, {
      evento: 'erro-nao-tratado',
      quando: ultimo,
      origem,
      // Só a mensagem no arquivo — a pilha inteira vai para o console. Uma linha de
      // log é lida por gente, e `leHistorico` corta o arquivo por tamanho.
      erro: bruto instanceof Error ? bruto.message : String(bruto),
      total,
      fatal,
    });

    if (fatal) desiste(1);
  };

  // `uncaughtException` sem ouvinte mata o Node na hora. `unhandledRejection` a partir
  // do Node 15 também: o padrão virou `--unhandled-rejections=throw`, e uma promessa
  // órfã de qualquer dependência derruba a tela. Os dois entram aqui.
  processo.on('uncaughtException', (err: unknown) => trata('uncaughtException', err));
  processo.on('unhandledRejection', (motivo: unknown) => trata('unhandledRejection', motivo));

  return () => ({ total, naJanela, ultimo });
}
