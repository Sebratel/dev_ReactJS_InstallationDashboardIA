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
  | { evento: 'api-morreu'; quando: string; codigo: number | null; viveuMs: number };

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

/**
 * As linhas que `--historico` imprime sobre mortes da API. Lista vazia quando não
 * houve nenhuma.
 *
 * Mora aqui, e não dentro do `console.log` do relatório, para poder ser testada: a
 * informação que decide o diagnóstico é **quanto tempo ela viveu** — segundos
 * apontam configuração, horas apontam causa externa —, e essa conversão é a única
 * parte com chance de sair errada.
 */
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
  }
  linhas.push('  A stack cai junto: `subir` NÃO ressuscita a API, de propósito —');
  linhas.push('  a morte mais comum dela é outra instância tomando a porta 3100.');
  linhas.push('  Vida curta (segundos) aponta configuração; vida longa, causa externa.');
  return linhas;
}
