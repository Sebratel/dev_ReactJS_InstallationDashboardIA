// A geração de UM conjunto ao vivo (docs/DECISAO-AO-VIVO.md): busca no SRD e grava o
// snapshot pequeno do período numa pasta. Uma função só para os dois lugares que a rodam
// — o processo filho da API (`filho-ao-vivo.ts`, o caminho de produção) e o teste que a
// roda no próprio processo —, para os dois nunca divergirem no que copiam do snapshot.
//
//   - agenda — o MÊS da tela da Agendamento Field, com a FIELD AGENDA completa (grão
//     relato) e o `Status Protocolo Dia` congelado pela tradução nativa sobre ela;
//     capacidade, clima e hora copiados do snapshot;
//   - ano — produtividade e a PG do ano (`instalacao-do-ano.ts`); o calendário de
//     instalação congelado e o resto copiados do snapshot;
//   - janela — PG, telefonia e a agenda no grão de slot (`janela-de-protocolos.ts`); o
//     resto copiado do snapshot, as calculadas recalculadas.

import path from 'node:path';
import { leVariantesAoVivo } from '../../packages/ao-vivo/src/catalogo.ts';
import { buscaDoAno, CALCULADAS_DO_ANO, QUERIES_DO_ANO, VARIANTE_PG_DO_ANO } from '../../packages/ao-vivo/src/instalacao-do-ano.ts';
import { buscaDaJanela, QUERIES_DA_JANELA } from '../../packages/ao-vivo/src/janela-de-protocolos.ts';
import type { PeriodoAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import {
  buscaDoPeriodo,
  calculadasCongeladas,
  congelaStatusDoDia,
  escreveSnapshotDoPeriodo,
} from '../../packages/ao-vivo/src/snapshot-do-periodo.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import type { ContextoMontado } from './contexto-ao-vivo.ts';
import { queriesPequenas } from './pagina-ao-vivo.ts';

export type ConjuntoAoVivo = 'agenda' | 'ano' | 'janela';

/** O que o processo filho recebe, em JSON. Só caminhos, ids e datas — nada de dado. */
export interface PedidoDeGeracao {
  readonly conjunto: ConjuntoAoVivo;
  /** As páginas pedidas deste conjunto: delas sai o que é copiado do snapshot. */
  readonly paginas: readonly string[];
  readonly periodo: PeriodoAoVivo;
  /** A pasta da geração, já criada e vazia. */
  readonly dir: string;
  /** O snapshot de hoje, de onde vêm as queries copiadas e as calculadas congeladas. */
  readonly snapshotDir: string;
  readonly agoraIso: string;
}

export async function geraConjunto(
  contexto: Pick<ContextoMontado, 'ctx' | 'model'>,
  root: string,
  p: PedidoDeGeracao,
): Promise<{ protocolos: number }> {
  const { ctx, model } = contexto;
  const specsDir = path.join(root, 'backend', 'specs');
  const paginas = loadDashboards(specsDir).filter((d) => p.paginas.includes(d.id));
  const agora = new Date(p.agoraIso);
  const copiadas = (doSrd: readonly string[]) =>
    [...new Set(paginas.flatMap((d) => queriesPequenas(d, model)))].filter((q) => !doSrd.includes(q));

  if (p.conjunto === 'agenda') {
    const agenda = paginas.find((d) => d.id === 'agendamento-field');
    if (!agenda) throw new Error('o conjunto da agenda sem a página agendamento-field');
    // As linhas da busca saem de escopo antes do congelamento, que carrega a pasta de novo:
    // as duas juntas somariam o pico do processo.
    const protocolos = await (async () => {
      const dados = await buscaDoPeriodo(ctx, p.periodo, agora);
      await escreveSnapshotDoPeriodo(p.dir, model, dados, p.agoraIso, { dir: p.snapshotDir, queries: copiadas([]) });
      return dados.protocolos;
    })();
    await congelaStatusDoDia(p.dir, model, agenda, agora, p.agoraIso);
    return { protocolos };
  }
  if (p.conjunto === 'ano') {
    const variante = leVariantesAoVivo(specsDir).get(VARIANTE_PG_DO_ANO);
    if (!variante) throw new Error(`ao-vivo.yaml sem a variante ${VARIANTE_PG_DO_ANO}`);
    const dados = await buscaDoAno(ctx, variante, p.periodo, agora);
    // O calendário de instalação vem congelado do snapshot: nasce da PG inteira (#205).
    const calculadas = await calculadasCongeladas(p.snapshotDir, model, CALCULADAS_DO_ANO);
    await escreveSnapshotDoPeriodo(p.dir, model, { ...dados, calculadas }, p.agoraIso, {
      dir: p.snapshotDir,
      queries: copiadas(QUERIES_DO_ANO),
    });
    return { protocolos: dados.protocolos };
  }
  const dados = await buscaDaJanela(ctx, agora);
  await escreveSnapshotDoPeriodo(p.dir, model, dados, p.agoraIso, { dir: p.snapshotDir, queries: copiadas(QUERIES_DA_JANELA) });
  return { protocolos: dados.protocolos };
}
