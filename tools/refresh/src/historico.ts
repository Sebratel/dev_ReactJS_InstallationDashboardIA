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
  | { evento: 'erro-de-ciclo'; quando: string; erro: string };

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
