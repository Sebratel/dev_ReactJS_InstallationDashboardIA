// A fonte ao vivo montada para a API (docs/DECISAO-AO-VIVO.md): quais páginas saem do SRD
// e de que forma, a partir de `AO_VIVO_PAGINAS` e `AO_VIVO_SOMBRA`. Separada do `index.ts`
// para o teste de ponta a ponta montar EXATAMENTE o que a API monta, sem subir o resto do
// processo (que grava acessos no banco de produção).
//
// Três formas:
//   - Agendamento Field — o MÊS da tela (`periodo.ts`), buscado uma vez e válido por 2 min
//     (mês corrente) ou 1 h (fechado);
//   - as cinco páginas do ano (Premiação, Diário, Detalhados, Manutenção Inicial,
//     Reincidente) — UM conjunto do ano (`instalacao-do-ano.ts`);
//   - as páginas de protocolos (Visão Geral, Relatórios, Telefonia, dicas) — UM conjunto da
//     janela (`janela-de-protocolos.ts`).
// Os dois conjuntos levam 1–2 min de SRD: valem 10 min, são buscados por baixo, e a
// primeira busca começa na subida (`aquece`). O que não vem do SRD é copiado do snapshot.

import path from 'node:path';
import { leVariantesAoVivo } from '../../packages/ao-vivo/src/catalogo.ts';
import {
  buscaDoAno,
  CALCULADAS_DO_ANO,
  decideDoAno,
  PAGINAS_DO_ANO,
  periodoDoAno,
  QUERIES_DO_ANO,
  VARIANTE_PG_DO_ANO,
} from '../../packages/ao-vivo/src/instalacao-do-ano.ts';
import {
  buscaDaJanela,
  decideDaJanela,
  PAGINAS_DA_JANELA,
  periodoDaJanela,
  QUERIES_DA_JANELA,
} from '../../packages/ao-vivo/src/janela-de-protocolos.ts';
import { decideAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import {
  buscaDoPeriodo,
  calculadasCongeladas,
  escreveSnapshotDoPeriodo,
} from '../../packages/ao-vivo/src/snapshot-do-periodo.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import { montaContextoAoVivo } from './contexto-ao-vivo.ts';
import type { PaginaServidaAoVivo } from './opcoes-servidor.ts';
import { queriesPequenas } from './pagina-ao-vivo.ts';
import { PeriodosAoVivo } from './periodos-ao-vivo.ts';
import { SombraAoVivo } from './sombra-ao-vivo.ts';

/** As páginas que sabem ser servidas ao vivo. Outra em `AO_VIVO_PAGINAS` é ignorada, com aviso. */
export const SABEM_SER_AO_VIVO: ReadonlySet<string> = new Set(['agendamento-field', ...PAGINAS_DO_ANO, ...PAGINAS_DA_JANELA]);

export interface AoVivoDaApi {
  readonly paginas: ReadonlyMap<string, PaginaServidaAoVivo>;
  readonly sombra: SombraAoVivo | null;
  /** A linha de log que diz o que ficou ligado, ou por que nada ficou. */
  readonly linha: string;
  /** Começa a primeira busca de cada conjunto — ela passa do teto de um pedido. */
  aquece(): void;
  /** Espera cada conjunto ficar pronto (para teste; a API não espera). */
  prontos(): Promise<void>;
  fecha(): Promise<void>;
}

export async function montaAoVivoDaApi(o: {
  readonly root: string;
  /** O snapshot de hoje: de onde vêm as queries copiadas e as calculadas congeladas. */
  readonly snapshotDir: string;
  readonly paginasPedidas: readonly string[];
  readonly querSombra: boolean;
  /** Onde ficam as pastas dos períodos — fora do snapshot, que só o refresh grava. */
  readonly dirBase: string;
  readonly conta: (nome: string, quanto: number) => void;
  readonly registra?: (linha: string) => void;
}): Promise<AoVivoDaApi> {
  const registra = o.registra ?? ((linha: string) => console.error(linha));
  for (const p of o.paginasPedidas) {
    if (!SABEM_SER_AO_VIVO.has(p)) registra(`[ao-vivo] '${p}' em AO_VIVO_PAGINAS ainda não sabe ser ao vivo — ignorada`);
  }
  const pedidas = o.paginasPedidas.filter((p) => SABEM_SER_AO_VIVO.has(p));
  const nada = { paginas: new Map(), sombra: null, aquece: () => undefined, prontos: async () => undefined, fecha: async () => undefined };
  if (pedidas.length === 0 && !o.querSombra) return { ...nada, linha: '[ao-vivo] desligado: AO_VIVO_PAGINAS vazia e AO_VIVO_SOMBRA não é 1' };
  const contexto = await montaContextoAoVivo(o.root);
  if ('porque' in contexto) return { ...nada, linha: `[ao-vivo] desligado: ${contexto.porque}` };

  const { ctx, model, relatosDoDia } = contexto;
  const specsDir = path.join(o.root, 'backend', 'specs');
  const paginas = loadDashboards(specsDir);
  const servidas = new Map<string, PaginaServidaAoVivo>();
  const conjuntos: (() => Promise<unknown>)[] = [];

  const agenda = paginas.find((d) => d.id === 'agendamento-field');
  if (agenda && pedidas.includes(agenda.id)) {
    // As queries pequenas (capacidade, clima, hora) vêm do snapshot de hoje.
    const pequenas = queriesPequenas(agenda, model);
    const periodos = new PeriodosAoVivo({
      busca: (periodo, agora) => buscaDoPeriodo(ctx, relatosDoDia, periodo, agora),
      grava: (dir, dados, geradoEm) => escreveSnapshotDoPeriodo(dir, model, dados, geradoEm, { dir: o.snapshotDir, queries: pequenas }),
      dirBase: path.join(o.dirBase, agenda.id),
      registra,
    });
    servidas.set(agenda.id, {
      decide: (dash, daTela) => decideAoVivo(dash, daTela, model),
      obtem: (p) => periodos.obtem(p),
      marca: (p) => periodos.marca(p),
      estado: () => periodos.estado(),
    });
  }

  const doAno = paginas.filter((d) => PAGINAS_DO_ANO.includes(d.id) && pedidas.includes(d.id));
  const variante = leVariantesAoVivo(specsDir).get(VARIANTE_PG_DO_ANO);
  if (doAno.length > 0 && variante) {
    // Produtividade e protocolos do SRD; o resto do snapshot, e o calendário de instalação
    // congelado dele (nasce da PG inteira, ACHADOS #205).
    const copiadas = [...new Set(doAno.flatMap((d) => queriesPequenas(d, model)))].filter((q) => !QUERIES_DO_ANO.includes(q));
    const periodos = new PeriodosAoVivo({
      busca: (periodo, agora) => buscaDoAno(ctx, variante, periodo, agora),
      grava: async (dir, dados, geradoEm) =>
        escreveSnapshotDoPeriodo(
          dir,
          model,
          { ...dados, calculadas: await calculadasCongeladas(o.snapshotDir, model, CALCULADAS_DO_ANO) },
          geradoEm,
          { dir: o.snapshotDir, queries: copiadas },
        ),
      dirBase: path.join(o.dirBase, 'ano'),
      // O ano é sempre o período "aberto"; 10 min é o frescor combinado para ele.
      ttlAbertoMs: 10 * 60_000,
      maxPeriodos: 2,
      // A busca do ano (~70 s) passa do teto do pedido: enquanto a primeira corre, o
      // pedido sai na hora pelo snapshot em vez de esperar 45 s por ela.
      esperaAPrimeira: false,
      registra,
    });
    for (const d of doAno) {
      servidas.set(d.id, {
        decide: (dash, _daTela, agora) => decideDoAno(model, dash.id, agora),
        obtem: (p) => periodos.obtem(p),
        marca: (p) => periodos.marca(p),
        estado: () => periodos.estado(),
      });
    }
    conjuntos.push(() => periodos.pronto(periodoDoAno(model, doAno[0]!.id, new Date())));
  } else if (doAno.length > 0) {
    registra(`[ao-vivo] ao-vivo.yaml sem a variante ${VARIANTE_PG_DO_ANO} — ${doAno.map((d) => d.id).join(', ')} seguem pelo snapshot`);
  }

  const daJanela = paginas.filter((d) => PAGINAS_DA_JANELA.includes(d.id) && pedidas.includes(d.id));
  if (daJanela.length > 0) {
    // PG, telefonia e agenda (no grão de slot) do SRD; backlog, capacidade, clima,
    // consolidado, feriados e hora do snapshot. As calculadas são recalculadas.
    const copiadas = [...new Set(daJanela.flatMap((d) => queriesPequenas(d, model)))].filter((q) => !QUERIES_DA_JANELA.includes(q));
    const periodos = new PeriodosAoVivo({
      busca: (_periodo, agora) => buscaDaJanela(ctx, agora),
      grava: (dir, dados, geradoEm) => escreveSnapshotDoPeriodo(dir, model, dados, geradoEm, { dir: o.snapshotDir, queries: copiadas }),
      dirBase: path.join(o.dirBase, 'janela'),
      ttlAbertoMs: 10 * 60_000,
      maxPeriodos: 2,
      esperaAPrimeira: false,
      registra,
    });
    for (const d of daJanela) {
      servidas.set(d.id, {
        decide: (dash, _daTela, agora) => decideDaJanela(dash, model, agora),
        obtem: (p) => periodos.obtem(p),
        marca: (p) => periodos.marca(p),
        estado: () => periodos.estado(),
      });
    }
    conjuntos.push(() => periodos.pronto(periodoDaJanela(new Date())));
  }

  const sombra = o.querSombra
    ? new SombraAoVivo({ ctx, model, relatosDoDia, snapshotDir: o.snapshotDir, conta: o.conta })
    : null;
  return {
    paginas: servidas,
    sombra,
    linha: `[ao-vivo] servidas do SRD: ${[...servidas.keys()].join(', ') || 'nenhuma'}; sombra ${sombra ? 'ligada' : 'desligada'}`,
    aquece: () => {
      for (const c of conjuntos) c().catch(() => undefined);
    },
    prontos: async () => {
      await Promise.all(conjuntos.map((c) => c()));
    },
    fecha: async () => {
      await sombra?.emCurso;
      await contexto.fecha();
    },
  };
}
