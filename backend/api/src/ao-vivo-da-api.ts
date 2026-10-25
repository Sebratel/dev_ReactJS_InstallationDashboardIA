// A fonte ao vivo montada para a API (docs/DECISAO-AO-VIVO.md): quais páginas saem do SRD
// e de que forma, a partir de `AO_VIVO_PAGINAS` e `AO_VIVO_SOMBRA`. Separada do `index.ts`
// para o teste de ponta a ponta montar EXATAMENTE o que a API monta, sem subir o resto do
// processo (que grava acessos no banco de produção).
//
// Três formas:
//   - Agendamento Field — o MÊS da tela (`periodo.ts`), com a agenda completa (grão
//     relato), buscado uma vez e válido por 5 min (mês corrente) ou 1 h (fechado);
//   - as cinco páginas do ano (Premiação, Diário, Detalhados, Manutenção Inicial,
//     Reincidente) — UM conjunto do ano (`instalacao-do-ano.ts`);
//   - as páginas de protocolos (Visão Geral, Relatórios, Telefonia, dicas) — UM conjunto da
//     janela (`janela-de-protocolos.ts`).
// Os dois conjuntos levam 1–2 min de SRD: valem 10 min, são buscados por baixo, e a
// primeira busca começa na subida (`aquece`). O que não vem do SRD é copiado do snapshot.
//
// **Cada busca roda num processo filho** (`geracao-em-processo.ts`): dentro da API, as
// duas dos conjuntos estouraram o heap do processo na subida. TODAS passam por uma fila
// de UMA busca por vez: é o que mantém o heap autorizado (pai + workers + um filho) dentro
// do `mem_limit` da `api`. O preço: um mês novo da agenda pedido enquanto um conjunto
// grande é buscado espera a vez, e passando de 45 s o pedido sai pelo snapshot.

import path from 'node:path';
import { leVariantesAoVivo } from '../../packages/ao-vivo/src/catalogo.ts';
import { decideDoAno, PAGINAS_DO_ANO, periodoDoAno, VARIANTE_PG_DO_ANO } from '../../packages/ao-vivo/src/instalacao-do-ano.ts';
import { decideDaJanela, PAGINAS_DA_JANELA, periodoDaJanela } from '../../packages/ao-vivo/src/janela-de-protocolos.ts';
import { decideAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import { codificaFiltro, decodificaFiltros } from '../../packages/widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../packages/widget-engine/src/filtros-padrao.ts';
import { loadDashboards } from '../../packages/widget-engine/src/spec.ts';
import { montaContextoAoVivo } from './contexto-ao-vivo.ts';
import type { ConjuntoAoVivo, PedidoDeGeracao } from './geracao-do-conjunto.ts';
import { geraEmProcesso } from './geracao-em-processo.ts';
import type { PaginaServidaAoVivo } from './opcoes-servidor.ts';
import { FilaDeBuscas, PeriodosAoVivo } from './periodos-ao-vivo.ts';
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
  /** Quem gera um conjunto. Padrão: um processo filho por busca. */
  readonly gera?: (pedido: PedidoDeGeracao) => Promise<{ protocolos: number; picoMB?: number }>;
}): Promise<AoVivoDaApi> {
  const registra = o.registra ?? ((linha: string) => console.error(linha));
  for (const p of o.paginasPedidas) {
    if (!SABEM_SER_AO_VIVO.has(p)) registra(`[ao-vivo] '${p}' em AO_VIVO_PAGINAS ainda não sabe ser ao vivo — ignorada`);
  }
  const pedidas = o.paginasPedidas.filter((p) => SABEM_SER_AO_VIVO.has(p));
  const nada = { paginas: new Map(), sombra: null, aquece: () => undefined, prontos: async () => undefined, fecha: async () => undefined };
  if (pedidas.length === 0 && !o.querSombra) return { ...nada, linha: '[ao-vivo] desligado: AO_VIVO_PAGINAS vazia e AO_VIVO_SOMBRA não é 1' };
  // Aqui o contexto valida as specs e serve a sombra; as buscas montam o delas no filho.
  // Os pools nascem sem conexão nenhuma — sem sombra, a API não conecta no SRD.
  const contexto = await montaContextoAoVivo(o.root);
  if ('porque' in contexto) return { ...nada, linha: `[ao-vivo] desligado: ${contexto.porque}` };

  const { model } = contexto;
  const specsDir = path.join(o.root, 'backend', 'specs');
  const paginas = loadDashboards(specsDir);
  const servidas = new Map<string, PaginaServidaAoVivo>();
  const conjuntos: (() => Promise<unknown>)[] = [];
  const gera = o.gera ?? ((pedido: PedidoDeGeracao) => geraEmProcesso(o.root, pedido));
  /** O `gera` de um conjunto para o `PeriodosAoVivo`: o pedido que o filho recebe. */
  const geraDo = (conjunto: ConjuntoAoVivo, ids: readonly string[]) =>
    (periodo: PedidoDeGeracao['periodo'], dir: string, agora: Date) =>
      gera({ conjunto, paginas: ids, periodo, dir, snapshotDir: o.snapshotDir, agoraIso: agora.toISOString() });
  /** Um processo de busca por vez, de qualquer conjunto (ver o cabeçalho). */
  const fila = new FilaDeBuscas(1);

  const agenda = paginas.find((d) => d.id === 'agendamento-field');
  if (agenda && pedidas.includes(agenda.id)) {
    const periodos = new PeriodosAoVivo({
      gera: geraDo('agenda', [agenda.id]),
      dirBase: path.join(o.dirBase, agenda.id),
      // Com a agenda completa, o mês leva ~1 min de busca (132 MB de linha em setembro de
      // 2026; o banco responde em 2 s, o resto é transferência): a renovação a cada 2 min
      // viraria busca sem parar, e a primeira passa do teto do pedido — ela sai pelo
      // snapshot enquanto a busca corre por baixo.
      ttlAbertoMs: 5 * 60_000,
      esperaAPrimeira: false,
      fila,
      registra,
    });
    servidas.set(agenda.id, {
      decide: (dash, daTela) => decideAoVivo(dash, daTela, model),
      obtem: (p) => periodos.obtem(p),
      marca: (p) => periodos.marca(p),
      estado: () => periodos.estado(),
    });
    // O mês com que a tela abre, já na subida.
    conjuntos.push(async () => {
      const d = decideAoVivo(agenda, decodificaFiltros(filtrosPadrao(agenda.id, new Date()).map(codificaFiltro)), model);
      if ('porque' in d) return;
      await periodos.pronto(d.periodo);
    });
  }

  const doAno = paginas.filter((d) => PAGINAS_DO_ANO.includes(d.id) && pedidas.includes(d.id));
  if (doAno.length > 0 && leVariantesAoVivo(specsDir).has(VARIANTE_PG_DO_ANO)) {
    const periodos = new PeriodosAoVivo({
      gera: geraDo('ano', doAno.map((d) => d.id)),
      dirBase: path.join(o.dirBase, 'ano'),
      // O ano é sempre o período "aberto"; 10 min é o frescor combinado para ele.
      ttlAbertoMs: 10 * 60_000,
      maxPeriodos: 2,
      fila,
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
    const periodos = new PeriodosAoVivo({
      gera: geraDo('janela', daJanela.map((d) => d.id)),
      dirBase: path.join(o.dirBase, 'janela'),
      ttlAbertoMs: 10 * 60_000,
      maxPeriodos: 2,
      fila,
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
    ? new SombraAoVivo({ ctx: contexto.ctx, model, snapshotDir: o.snapshotDir, conta: o.conta })
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
