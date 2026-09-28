// O que o `refresh-status.json` esquece — e ele esquece quase tudo.
//
// **O defeito que este arquivo existe para consertar.** `refresh-status.json` guarda
// UM registro por grupo, e cada tick o sobrescreve. Uma falha às 03:00 seguida de um
// sucesso às 03:15 zera `falhasConsecutivas`, apaga o `erro` e não deixa rastro
// nenhum: às 08:00 o arquivo diz "tudo ok, três grupos, zero falhas" e está dizendo a
// verdade sobre a ÚLTIMA tentativa, que é a única que ele conhece. Some com isso o
// fato de que aquele grupo caiu — e falha transitória noturna é exatamente a que
// ninguém vê acontecer.
//
// O daemon também não escrevia em lugar nenhum: `npm start` o sobe com
// `stdio: 'inherit'`, então as linhas dele vivem no terminal de quem digitou o
// comando e morrem junto com ele. Fechado o terminal, o que o agendador fez de
// madrugada é irrecuperável por construção.
//
// **Por que um `.jsonl` e não outro `.json`.** Acrescentar uma linha é uma chamada de
// `appendFileSync` — sem ler, sem mesclar, sem read-modify-write. É a mesma razão pela
// qual os grupos rodam em série (ver `tick.ts`): dois escritores num JSON que precisa
// ser lido antes de ser escrito se apagam em silêncio. Aqui não há o que mesclar.
//
// **Nunca derruba o daemon.** Toda operação é `try/catch` mudo. Um histórico que
// impede o refresh de rodar seria pior que nenhum histórico: o trabalho é o refresh, a
// observabilidade é o acessório.
//
// REGRA DE SAÍDA: id de grupo, contagem e tempo. Nunca valor de linha.

import fs from 'node:fs';
import path from 'node:path';

/**
 * **`.log`, e NÃO `.jsonl`, apesar de o conteúdo ser JSON por linha.** `.jsonl` é o
 * sufixo de TABELA de snapshot (`SUFIXO_CRU` em `packages/snapshot/src/formato.ts`), e
 * três varreduras do diretório reconhecem arquivo pelo nome sem abrir nada —
 * `tools/snapshot/src/confere.ts`, `tools/snapshot/src/converte.ts` e
 * `tools/bench/src/carga.ts`. Com `.jsonl`, este arquivo entraria nas três como se
 * fosse uma query materializada, e `leCabecalho` iria procurar um cabeçalho de tabela
 * na primeira linha de um evento de refresh.
 *
 * É o mesmo cuidado que `guardaErro` já registra em `tools/snapshot/src/index.ts`:
 * *"o nome termina em `.erro.log` para não ser confundido com tabela por
 * `leManifesto`"*. Foi verificado, não suposto — `ehArquivoDeSnapshot`
 * ('refresh-historico.jsonl') devolvia `true`.
 */
export const ARQUIVO_HISTORICO = 'refresh-historico.log';

/**
 * Acima disto o arquivo é aparado, mantendo o FIM. 512 KB dão da ordem de 4 mil
 * eventos — semanas de três grupos a cada 15 min. O corte é por tamanho e não por
 * contagem de linhas porque `statSync` responde sem ler o arquivo, e este código roda
 * dentro do caminho de um tick.
 */
export const TAMANHO_MAXIMO_BYTES = 512 * 1024;

/** Quanto sobra depois de aparar. Metade, para não aparar de novo no evento seguinte. */
const GUARDA_APOS_APARAR = 0.5;

export type EventoDeRefresh =
  | { evento: 'arranque'; quando: string; intervaloMinutos: number; pid: number }
  | { evento: 'grupo'; quando: string; grupo: string; ok: boolean; duracaoMs: number; erro?: string }
  | { evento: 'erro-de-ciclo'; quando: string; erro: string }
  /**
   * O disparo caiu em cima de um ciclo que ainda rodava, e o daemon o pulou
   * (`emExecucao` em `daemon.ts`). **Entrou em 17/09/2026, quando deixou de ser
   * hipotético:** um tick que roda os três grupos mede hoje ~664 s dentro de uma
   * janela de 900 s, e os grupos rodam em série. Uma hora ruim de link e os
   * disparos começam a ser pulados.
   *
   * O que torna isso pior que uma falha: pular NÃO é erro. `estaVencido` mede a
   * idade do último SUCESSO, então o grupo simplesmente roda no ciclo seguinte e
   * o `refresh-status.json` fica verde o tempo todo. A cadência real teria caído
   * pela metade sem uma única linha vermelha em lugar nenhum — que é exatamente o
   * buraco do #129, em outro disfarce.
   */
  | { evento: 'ciclo-pulado'; quando: string; cicloEmCursoHaMs: number }
  /**
   * A API morreu e levou a stack junto (`api.on('exit')` em
   * `tools/subir/src/index.ts`). **Entrou em 18/09/2026, e por uma razão
   * embaraçosa: a API caiu e não houve como descobrir por quê.**
   *
   * O daemon deixa `arranque` no histórico desde 17/09 (#129), então "o
   * agendador reiniciou às 03:00" é recuperável. Da API não havia nada: ela
   * imprimia `A API saiu (código 1).` no terminal de quem digitou `npm start`, e
   * esse terminal é exatamente o que não existe mais quando alguém pergunta.
   *
   * Isto NÃO é ressurreição, e a diferença importa. `subir` ressuscita o daemon
   * e **não** a API, de propósito: a morte mais comum da API é outra instância
   * tomando a porta 3100 (`subir` tem esse caminho e ele derruba o ocupante).
   * Ressuscitar aí poria duas instâncias brigando pela porta para sempre. O que
   * faltava não era reerguer — era saber.
   */
  | {
      evento: 'api-morreu';
      quando: string;
      codigo: number | null;
      viveuMs: number;
      /**
       * **Os três campos abaixo entraram em 22/09/2026**, depois de quatro mortes com
       * `0xC0000409` sem motivo nenhum registrado. Opcionais porque as linhas
       * antigas do log não os têm. Ver `tools/subir/src/diagnostico.ts`.
       *
       * `motivo`: o `header.event` do relatório de erro fatal, ou a última linha do
       * stderr com cara de erro.
       */
      motivo?: string;
      /** Nome do relatório de erro fatal em `snapshot/diagnostico/`, se houve. */
      relatorio?: string;
      /** Nome do arquivo com a cauda do stderr em `snapshot/diagnostico/`. */
      stderr?: string;
    }
  /**
   * O agendador subiu DENTRO da API (`apps/api/src/agendador.ts`), em vez de num
   * processo dedicado. **Entrou em 19/09/2026.**
   *
   * É o par do `arranque` acima, e existe separado de propósito: os dois descrevem
   * cadências diferentes. O `arranque` do daemon registra UM intervalo — ele varre
   * todos os grupos a cada 15 min e decide ali quem venceu. O agendador da API tem um
   * relógio POR GRUPO, então o que importa registrar é a lista inteira. Lendo o
   * histórico depois do fato, é esta linha que diz qual dos dois estava no comando.
   */
  | {
      evento: 'agendador-arranque';
      quando: string;
      pid: number;
      grupos: { id: string; intervaloMinutos: number }[];
    }
  /**
   * O relógio de um grupo bateu enquanto esse MESMO grupo ainda rodava (ou já
   * esperava na fila), e o disparo foi descartado por não ter o que acrescentar.
   *
   * **Não confundir com `ciclo-pulado`, que é o defeito que este substitui.** No
   * daemon, um grupo demorado fazia o disparo seguinte pular os grupos TODOS — o
   * `frio` perdia a vez porque o `medio` ainda rodava, e nada acendia. Aqui o grupo
   * atrasado apenas espera a fila; quem é descartado é só a segunda cópia dele
   * mesmo, que materializaria exatamente o que já está sendo materializado.
   *
   * Continua sendo cadência perdida, e continua não sendo falha: `estaVencido` mede
   * idade do último SUCESSO, então o `refresh-status.json` fica verde. Se este evento
   * aparece com frequência num grupo, o intervalo dele é menor que o custo dele — e
   * essa é uma decisão de `specs/_catalog/refresh.yaml`, não um conserto de código.
   */
  | { evento: 'disparo-coalescido'; quando: string; grupo: string; emCursoHaMs: number }
  /**
   * Um grupo que vem falhando seguido NÃO rodou: está em espera crescente
   * (`proximaTentativa` em `tick.ts`). Não é falha nova — é o freio de uma que já
   * aconteceu. `ate` é quando ele volta a tentar; um pedido manual passa por cima.
   */
  | { evento: 'grupo-adiado'; quando: string; grupo: string; falhasConsecutivas: number; ate: string }
  /**
   * O vigia de travamento (`apps/api/src/vigia-travamento.ts`) matou a API: o laço
   * principal ficou parado mais que `limiteMs`. Quem religa é o `restart` do contêiner.
   */
  | { evento: 'api-travou'; quando: string; paradoHaMs: number; limiteMs: number }
  /**
   * A MÁQUINA DORMIU. Detectado por batimento: um temporizador de cadência fixa que
   * demorou muito mais que a própria cadência para disparar só pode ter sido
   * congelado junto com o processo.
   *
   * **Não é diagnóstico por adivinhação — é a assinatura, e ela foi medida.** Em
   * 19/09/2026 os três grupos dispararam com 14 ms entre si (18:51:48.519 / .522 /
   * .533 UTC) depois de 2h14min sem evento nenhum. Temporizadores de 15, 20 e 30 min
   * não coincidem em 14 ms: é o Windows liberando de uma vez tudo que venceu
   * enquanto dormia. O log de energia confirmou, ao segundo — `Espera S0 (Ocioso com
   * Baixo Consumo), Conectado via Rede`, o modo que congela processo Win32 e mantém
   * a rede de pé.
   *
   * `paradaMs` é o tamanho do congelamento, e `grupoEmVoo` é quem estava
   * materializando na hora (ou `null`). Se havia um, os sockets dele com o banco
   * morreram durante o sono e a carga está perdida — ver `carga-interrompida`.
   */
  | {
      evento: 'maquina-suspensa';
      quando: string;
      paradaMs: number;
      grupoEmVoo: string | null;
    }
  /**
   * Uma carga que morreu porque a máquina suspendeu embaixo dela — e que POR ISSO
   * não conta como falha.
   *
   * **A distinção não é cosmética.** Em 19/09/2026 o `medio` apareceu no banner como
   * "cargas falharam: alocacao-patrimonio, apuracao-premiacao, ..." com onze nomes e
   * `saiu com código 1`, e a leitura natural disso é que onze queries quebraram. Não
   * quebrou nenhuma: o notebook entrou em espera 28 s depois da carga começar, ficou
   * 2h14min congelado, e o exit 1 foi o driver do Postgres relatando que a conexão
   * tinha morrido no sono. Contar isso como falha da plataforma manda procurar
   * defeito onde não há, e acende um alarme que nenhum conserto de código apaga.
   *
   * Consequências de classificar aqui em vez de em `grupo`: `falhasConsecutivas` não
   * sobe, o `refresh-status.json` não fica vermelho, e o grupo volta para a FRENTE da
   * fila para ser refeito já — não no próximo intervalo.
   *
   * O que continua acendendo, e tem de continuar: `estaVencido` mede idade do último
   * SUCESSO. Se a máquina dormir três dias, o grupo fica vencido e o banner diz isso,
   * com razão. O que sumiu foi a palavra "falharam", não o alarme de dado velho.
   */
  /**
   * A API teve um erro que ninguém pegou — `uncaughtException` ou
   * `unhandledRejection` — e SOBREVIVEU a ele.
   *
   * **Existe porque o silêncio aqui custou a operação.** Sem guarda de processo, um
   * erro não tratado mata o Node na hora e a tela sai do ar; o
   * `refresh-historico.log` registrava só `api-morreu` com `codigo: 1`, que é o Node
   * dizendo "exceção não tratada" sem dizer qual. Aconteceu em 18/09/2026, depois de
   * 1.125 s no ar, e não houve como saber o motivo.
   *
   * `fatal: true` é o caso em que a guarda DESISTE de continuar: erro não tratado em
   * rajada não é um pedido azarado, é um processo quebrado, e aí reiniciar limpo é
   * melhor que servir de um estado que ninguém entende.
   */
  | {
      evento: 'erro-nao-tratado';
      quando: string;
      origem: 'uncaughtException' | 'unhandledRejection';
      erro: string;
      /** Quantos erros não tratados este processo já teve, contando este. */
      total: number;
      fatal: boolean;
    }
  | {
      evento: 'carga-interrompida';
      quando: string;
      grupo: string;
      duracaoMs: number;
      motivo: string;
    };

/**
 * Uma linha por evento, no fim do arquivo. Silenciosa em qualquer falha — ver o
 * docstring do topo.
 */
export function registra(snapshotDir: string, evento: EventoDeRefresh): void {
  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const destino = path.join(snapshotDir, ARQUIVO_HISTORICO);
    apara(destino);
    fs.appendFileSync(destino, JSON.stringify(evento) + '\n', 'utf8');
  } catch {
    // Observabilidade não interrompe trabalho.
  }
}

/**
 * Corta o começo quando o arquivo passa do teto. Reescreve inteiro, o que só acontece
 * uma vez a cada milhares de eventos — e a linha PARCIAL do começo do corte é
 * descartada por `leHistorico`, que ignora linha que não faz `JSON.parse`.
 */
function apara(destino: string): void {
  let tamanho = 0;
  try {
    tamanho = fs.statSync(destino).size;
  } catch {
    return; // ainda não existe
  }
  if (tamanho <= TAMANHO_MAXIMO_BYTES) return;
  const bruto = fs.readFileSync(destino, 'utf8');
  const corte = Math.floor(bruto.length * (1 - GUARDA_APOS_APARAR));
  const daPrimeiraLinhaInteira = bruto.indexOf('\n', corte);
  if (daPrimeiraLinhaInteira < 0) return;
  fs.writeFileSync(destino, bruto.slice(daPrimeiraLinhaInteira + 1), 'utf8');
}

/**
 * Os últimos `limite` eventos, do mais antigo para o mais novo. Linha ilegível é
 * pulada, não lançada: o arquivo pode ter sido aparado no meio de uma linha, ou o
 * processo ter morrido com meia linha escrita.
 */
export function leHistorico(snapshotDir: string, limite = 200): EventoDeRefresh[] {
  try {
    const bruto = fs.readFileSync(path.join(snapshotDir, ARQUIVO_HISTORICO), 'utf8');
    const eventos: EventoDeRefresh[] = [];
    for (const linha of bruto.split('\n')) {
      if (!linha.trim()) continue;
      try {
        eventos.push(JSON.parse(linha) as EventoDeRefresh);
      } catch {
        continue;
      }
    }
    return limite > 0 ? eventos.slice(-limite) : eventos;
  } catch {
    return [];
  }
}

export interface ResumoDeGrupo {
  grupo: string;
  tentativas: number;
  falhas: number;
  ultimaFalha?: string;
  ultimoErro?: string;
  duracaoMediaMs: number;
}

/**
 * O que `refresh-status.json` não consegue responder: quantas vezes este grupo caiu na
 * janela, e quando foi a última — mesmo que o tick seguinte tenha dado certo e apagado
 * o rastro no status.
 */
export function resumePorGrupo(eventos: EventoDeRefresh[]): ResumoDeGrupo[] {
  const porGrupo = new Map<string, ResumoDeGrupo & { somaMs: number }>();
  for (const e of eventos) {
    if (e.evento !== 'grupo') continue;
    let r = porGrupo.get(e.grupo);
    if (!r) {
      r = { grupo: e.grupo, tentativas: 0, falhas: 0, duracaoMediaMs: 0, somaMs: 0 };
      porGrupo.set(e.grupo, r);
    }
    r.tentativas += 1;
    r.somaMs += e.duracaoMs;
    if (!e.ok) {
      r.falhas += 1;
      r.ultimaFalha = e.quando;
      r.ultimoErro = e.erro;
    }
  }
  return [...porGrupo.values()].map(({ somaMs, ...r }) => ({
    ...r,
    duracaoMediaMs: r.tentativas > 0 ? Math.round(somaMs / r.tentativas) : 0,
  }));
}

export interface ResumoDePulos {
  /** Quantos disparos caíram em cima de um ciclo ainda em curso. */
  pulos: number;
  /** O último deles, para saber se é história velha ou está acontecendo agora. */
  ultimo?: string;
  /** O ciclo mais longo que atropelou um disparo — o pior caso observado. */
  maiorAtropeloMs: number;
}

/**
 * Quantas vezes a cadência foi perdida sem que nada ficasse vermelho.
 *
 * Fica separado de `resumePorGrupo` porque a pergunta é de outra natureza: aquele
 * responde "este grupo está falhando?", e este responde "o relógio está sendo
 * cumprido?". Um refresh pode responder SIM ao primeiro e NÃO ao segundo a tarde
 * inteira — e é esse o caso que nenhum dos dois arquivos de estado enxergava.
 */
export function resumeDePulos(eventos: readonly EventoDeRefresh[]): ResumoDePulos {
  const r: ResumoDePulos = { pulos: 0, maiorAtropeloMs: 0 };
  for (const e of eventos) {
    if (e.evento !== 'ciclo-pulado') continue;
    r.pulos += 1;
    r.ultimo = e.quando;
    if (e.cicloEmCursoHaMs > r.maiorAtropeloMs) r.maiorAtropeloMs = e.cicloEmCursoHaMs;
  }
  return r;
}

export interface ResumoDeCoalescidos {
  grupo: string;
  /** Quantas vezes o relógio deste grupo bateu em cima dele mesmo. */
  descartados: number;
  ultimo: string;
  /** O mais longo que um deles já estava rodando — o pior caso observado. */
  maiorEmCursoMs: number;
  /**
   * Destes, quantos o grupo estava apenas ESPERANDO na fila (`emCursoHaMs === 0`) em
   * vez de materializando.
   *
   * **Os dois casos têm conselhos opostos e o relatório os confundia.** Descarte com
   * o grupo rodando diz que o intervalo dele é menor que o custo dele — conserta-se
   * afrouxando a cadência. Descarte com o grupo na fila diz que OUTRO grupo está
   * segurando a fila, e afrouxar a cadência deste não muda nada. Em 19/09/2026 o
   * relatório imprimiu `quente 1x, já rodava há 0s` e mandou afrouxar o `quente`,
   * quando o que havia acontecido é que o `medio` estava congelado por uma suspensão
   * da máquina havia 2h15min.
   */
  esperandoNaFila: number;
}

/**
 * Quais grupos estão pedindo cadência que não cabe no próprio custo.
 *
 * Fica separado de `resumeDePulos` porque responde outra pergunta, embora o sintoma
 * seja parecido. Aquele contava ticks do daemon perdidos INTEIROS — um grupo lento
 * fazia todos os outros perderem a vez. Este conta só o grupo que atropelou a si
 * mesmo, que é a única perda de cadência que sobra quando cada grupo tem relógio
 * próprio e fila (`apps/api/src/agendador.ts`).
 *
 * Um número alto aqui NÃO é defeito de código: é `intervalo_minutos` menor que o
 * custo medido do grupo. O conserto mora em `specs/_catalog/refresh.yaml`.
 */
export function resumeDeCoalescidos(eventos: readonly EventoDeRefresh[]): ResumoDeCoalescidos[] {
  const porGrupo = new Map<string, ResumoDeCoalescidos>();
  for (const e of eventos) {
    if (e.evento !== 'disparo-coalescido') continue;
    const r = porGrupo.get(e.grupo);
    if (!r) {
      porGrupo.set(e.grupo, {
        grupo: e.grupo,
        descartados: 1,
        ultimo: e.quando,
        maiorEmCursoMs: e.emCursoHaMs,
        esperandoNaFila: e.emCursoHaMs === 0 ? 1 : 0,
      });
      continue;
    }
    r.descartados += 1;
    r.ultimo = e.quando;
    if (e.emCursoHaMs === 0) r.esperandoNaFila += 1;
    if (e.emCursoHaMs > r.maiorEmCursoMs) r.maiorEmCursoMs = e.emCursoHaMs;
  }
  return [...porGrupo.values()].sort((a, b) => b.descartados - a.descartados);
}

/**
 * As linhas que `--historico` imprime sobre mortes da API. Lista vazia quando não
 * houve nenhuma.
 *
 * Mora aqui, e não dentro do `console.log` do relatório, para poder ser testada: a
 * informação que decide o diagnóstico é **quanto tempo ela viveu** — segundos
 * apontam configuração, horas apontam causa externa —, e essa conversão é a única
 * parte com chance de sair errada.
 */
export interface ResumoDeSuspensoes {
  vezes: number;
  /** Soma do tempo congelado — é isto que explica um "vencida há N horas" sem falha. */
  totalParadoMs: number;
  maiorParadaMs: number;
  ultimo: string;
  /** Quantas cargas a suspensão matou no meio. */
  cargasPerdidas: number;
}

/**
 * As suspensões da máquina no período do histórico.
 *
 * **Serve para separar duas coisas que se parecem no banner e não têm o mesmo
 * conserto**: dado velho porque a plataforma falhou, e dado velho porque o host
 * dormiu. A segunda não tem conserto em código — tem em política de energia, ou em
 * mudar de host. Um número que sobe aqui todo dia é a resposta.
 */
export function resumeDeSuspensoes(eventos: readonly EventoDeRefresh[]): ResumoDeSuspensoes | null {
  const suspensoes = eventos.filter((e) => e.evento === 'maquina-suspensa') as Extract<
    EventoDeRefresh,
    { evento: 'maquina-suspensa' }
  >[];
  if (suspensoes.length === 0) return null;
  return {
    vezes: suspensoes.length,
    totalParadoMs: suspensoes.reduce((t, e) => t + e.paradaMs, 0),
    maiorParadaMs: Math.max(...suspensoes.map((e) => e.paradaMs)),
    ultimo: suspensoes[suspensoes.length - 1]!.quando,
    cargasPerdidas: eventos.filter((e) => e.evento === 'carga-interrompida').length,
  };
}

export function descreveMortesDaApi(eventos: readonly EventoDeRefresh[], ultimas = 5): string[] {
  const mortes = eventos.filter((e) => e.evento === 'api-morreu');
  if (mortes.length === 0) return [];
  const linhas = [`MORTES DA API: ${mortes.length}`];
  for (const m of mortes.slice(-ultimas)) {
    const e = m as Extract<EventoDeRefresh, { evento: 'api-morreu' }>;
    const viveu =
      e.viveuMs >= 3_600_000
        ? `${(e.viveuMs / 3_600_000).toFixed(1)} h`
        : `${Math.round(e.viveuMs / 1000)} s`;
    linhas.push(`  ${e.quando}  código ${e.codigo ?? '?'}  depois de ${viveu} no ar`);
    if (e.motivo) linhas.push(`      motivo: ${e.motivo}`);
    const arquivos = [e.relatorio, e.stderr].filter(Boolean);
    if (arquivos.length > 0) linhas.push(`      em snapshot/diagnostico/: ${arquivos.join(', ')}`);
  }
  linhas.push('  A stack cai junto: `subir` NÃO ressuscita a API, de propósito —');
  linhas.push('  a morte mais comum dela é outra instância tomando a porta 3100.');
  linhas.push('  Vida curta (segundos) aponta configuração; vida longa, causa externa.');
  return linhas;
}
