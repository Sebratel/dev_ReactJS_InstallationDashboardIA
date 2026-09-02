// A decisão e a orquestração de um tick — separadas do processo real (spawnSync,
// relógio de verdade) para caber em teste sem tocar disco nem subprocesso.
//
// **Por que grupos rodam em série, nunca em paralelo, dentro do mesmo tick.** Dois
// grupos vencidos ao mesmo tempo fariam, cada um independentemente,
// `leManifesto` -> mescla em memória -> `escreveManifesto`
// (`tools/snapshot/src/index.ts`). É um read-modify-write clássico entre dois
// processos: mesmo com a escrita do manifesto atômica (packages/snapshot/src/
// escrita-atomica.ts), nada impede o processo B de ler o manifesto ANTES de A
// escrever e sobrescrever o resultado de A quando terminar — as entradas que A
// tinha acabado de adicionar somem, silenciosamente, sem erro. Rodar em série
// dentro do tick elimina esse cenário de raiz: só um processo mexe no manifesto
// por vez. A segunda camada — o Agendador de Tarefas não iniciar uma nova
// instância enquanto a anterior roda — protege o caso de um tick anterior ainda
// vivo; esta aqui protege dois grupos do MESMO tick.

import type { GrupoDeRefresh } from './grupos.ts';
import type { StatusDeGrupo, StatusDeRefresh } from './status.ts';

export interface ResultadoDeExecucao {
  ok: boolean;
  /** Resumo — o log completo do filho já foi para stderr via `stdio: 'inherit'`. */
  erro?: string;
}

/**
 * Vencido: nunca teve sucesso, ou o último sucesso foi há mais que o intervalo.
 *
 * **A idade que conta é a do último SUCESSO, não da última tentativa.** Uma falha
 * não deve fazer o grupo esperar o intervalo inteiro de novo — ela já é o
 * "tentar de novo no próximo tick" que a Frente 3 pede, sem lógica de retry
 * especial: o PRÓPRIO tick seguinte é o retry.
 */
export function estaVencido(
  anterior: StatusDeGrupo | undefined,
  intervaloMinutos: number,
  agora: Date,
): boolean {
  if (!anterior?.ultimoSucesso) return true;
  const desde = agora.getTime() - new Date(anterior.ultimoSucesso).getTime();
  return desde >= intervaloMinutos * 60_000;
}

/** O próximo `StatusDeGrupo`, depois de uma execução (sucesso ou falha). */
export function proximoStatus(
  anterior: StatusDeGrupo | undefined,
  agora: Date,
  resultado: ResultadoDeExecucao,
  duracaoMs: number,
): StatusDeGrupo {
  return {
    ultimaTentativa: agora.toISOString(),
    ultimoSucesso: resultado.ok ? agora.toISOString() : (anterior?.ultimoSucesso ?? null),
    duracaoMs,
    ok: resultado.ok,
    falhasConsecutivas: resultado.ok ? 0 : (anterior?.falhasConsecutivas ?? 0) + 1,
    ...(resultado.erro ? { erro: resultado.erro } : {}),
  };
}

export interface ResultadoDoGrupoNoTick {
  id: string;
  vencido: boolean;
  ok?: boolean;
  duracaoMs?: number;
  erro?: string;
}

export interface DependenciasDeTick {
  agora: () => Date;
  /** Roda UM grupo e só devolve quando termina — como `spawnSync`. Nunca em paralelo. */
  roda: (grupo: GrupoDeRefresh) => ResultadoDeExecucao;
  /**
   * Chamado depois de CADA grupo vencido, com o status acumulado até ali — não só
   * no fim do tick. Um tick que morre no meio (o processo é derrubado, a máquina
   * reinicia) não perde o progresso dos grupos que já tinham terminado.
   */
  persiste: (status: StatusDeRefresh) => Promise<void> | void;
}

/**
 * Um tick inteiro: para cada grupo, na ordem em que aparece em `grupos`, decide se
 * está vencido e roda se estiver — em série, nunca em paralelo (ver o comentário
 * do arquivo). Uma falha num grupo não impede os seguintes de rodar.
 */
export async function executaTick(
  grupos: ReadonlyMap<string, GrupoDeRefresh>,
  statusInicial: StatusDeRefresh,
  deps: DependenciasDeTick,
): Promise<{ status: StatusDeRefresh; resultados: ResultadoDoGrupoNoTick[] }> {
  let status: StatusDeRefresh = { ...statusInicial };
  const resultados: ResultadoDoGrupoNoTick[] = [];

  for (const g of grupos.values()) {
    const anterior = status[g.id];
    if (!estaVencido(anterior, g.intervaloMinutos, deps.agora())) {
      resultados.push({ id: g.id, vencido: false });
      continue;
    }

    const inicio = deps.agora();
    const resultado = deps.roda(g);
    const fim = deps.agora();
    const duracaoMs = fim.getTime() - inicio.getTime();

    status = { ...status, [g.id]: proximoStatus(anterior, fim, resultado, duracaoMs) };
    await deps.persiste(status);
    resultados.push({ id: g.id, vencido: true, ok: resultado.ok, duracaoMs, erro: resultado.erro });
  }

  return { status, resultados };
}
