// A página calculada AO VIVO (docs/DECISAO-AO-VIVO.md, fase 1): o snapshot do período
// (`backend/packages/ao-vivo/src/snapshot-do-periodo.ts`) carregado e calculado pelo
// MESMO `carrega` + `calculaPagina` da página de hoje, numa pasta temporária que some
// no fim do pedido.
//
// E a comparação com a página do snapshot, visual a visual — o que o modo sombra
// (`sombra-ao-vivo.ts`) e a sonda (`npm run probe:ao-vivo -- --so=pagina`) leem. Ela
// diz QUAIS visuais divergem e a FORMA da diferença (quantas linhas, quantos bytes),
// nunca o valor: a página tem nome e endereço de cliente (CLAUDE.md, regra 2).

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContextoAoVivo } from '../../packages/ao-vivo/src/executor.ts';
import { decideAoVivo, type PeriodoAoVivo } from '../../packages/ao-vivo/src/periodo.ts';
import {
  buscaDoPeriodo,
  congelaStatusDoDia,
  escreveSnapshotDoPeriodo,
  type CalculadaPronta,
  type DadosDoPeriodo,
} from '../../packages/ao-vivo/src/snapshot-do-periodo.ts';
import { normalizeName, type SemanticModel } from '../../packages/semantic-model/src/model.ts';
import { carrega } from '../../packages/snapshot/src/carrega.ts';
import { planeja } from '../../packages/snapshot/src/plano.ts';
import type { DashboardSpec, FiltroSpec } from '../../packages/widget-engine/src/spec.ts';
import { calculaPagina, type Janela, type PaginaCalculada, type VisualCalculado } from './calcula.ts';
import { mescladoresDe, type OverlayDeTabela } from './overlay-realtime.ts';

/** As queries que vêm do SRD recortadas. As outras da página são pequenas e vêm do snapshot. */
const AO_VIVO = new Set(['field-agenda', 'field-agenda-slot', 'protocolos-geral']);

/** As queries pequenas da página: o que o snapshot do período copia do snapshot de hoje. */
export function queriesPequenas(dash: DashboardSpec, model: SemanticModel): string[] {
  return planeja([dash], model).queries.filter((q) => !AO_VIVO.has(q));
}

export interface CalculoSobrePeriodo {
  readonly model: SemanticModel;
  /** A página inteira — é dela que sai o plano de carga. */
  readonly dash: DashboardSpec;
  /** A do pedido: os visuais pedidos e os filtros (de página e da tela). */
  readonly alvo: DashboardSpec;
  /** Visuais que o ao vivo não responde (`visuaisForaDoAoVivo`): saem do cálculo. */
  readonly fora: ReadonlyMap<string, string>;
  /** As tabelas de grão reduzido que o período traz completas (`Decisao.formaCompleta`). */
  readonly formaCompleta?: readonly string[];
  readonly janela: Janela;
  readonly clicados: readonly { tabela: string; coluna: string }[];
  readonly agora: Date;
  /** As queries buscadas. Uma query pequena da página que venha aqui não é copiada. */
  readonly dados: Pick<DadosDoPeriodo, 'consultas'> & { readonly calculadas?: readonly CalculadaPronta[] };
  /** O snapshot de onde copiar as queries pequenas que `dados` não trouxe. */
  readonly pequenasDe?: string;
  /** Onde criar a pasta temporária. Padrão: `os.tmpdir()`. */
  readonly tmp?: string;
}

export interface PaginaSobrePeriodo {
  readonly pagina: PaginaCalculada;
  readonly linhasPorTabela: ReadonlyMap<string, number>;
  readonly ms: { readonly escrita: number; readonly carga: number; readonly calculo: number };
}

/**
 * Carrega o snapshot de um período já gravado e calcula a página do pedido — o caminho
 * em linha, sem worker. A forma de cada tabela de grão reduzido é a que o período trouxe
 * (`formaCompleta`); os visuais que pediriam uma forma que não veio estão em `fora` e
 * saem do plano.
 */
export async function calculaNoDiretorio(
  c: Pick<CalculoSobrePeriodo, 'model' | 'dash' | 'alvo' | 'fora' | 'formaCompleta' | 'janela' | 'clicados' | 'agora'> & {
    readonly dir: string;
    /** O overlay do tempo real, já com o corte da busca (`overlaySobreBuscaAoVivo`). */
    readonly overlay?: ReadonlyMap<string, OverlayDeTabela>;
  },
): Promise<Omit<PaginaSobrePeriodo, 'ms'> & { readonly ms: { readonly carga: number; readonly calculo: number } }> {
  const semFora = (d: DashboardSpec): DashboardSpec => ({ ...d, visuals: (d.visuals ?? []).filter((v) => !c.fora.has(v.id)) });
  const tCarga = Date.now();
  const carregado = await carrega({
    dir: c.dir,
    model: c.model,
    dashboards: [semFora(c.dash)],
    now: c.agora,
    precisaFormaCompleta: [...(c.formaCompleta ?? [])],
    colunar: true,
    ...(c.overlay && c.overlay.size > 0 ? { overlay: mescladoresDe(c.overlay) } : {}),
  });
  const tCalculo = Date.now();
  const pagina = calculaPagina(semFora(c.alvo), carregado.ev, c.janela, undefined, undefined, c.clicados);
  return {
    pagina,
    linhasPorTabela: carregado.linhasPorTabela,
    ms: { carga: tCalculo - tCarga, calculo: Date.now() - tCalculo },
  };
}

/** Grava o snapshot do período, carrega e calcula. A pasta sai mesmo se algo falhar. */
export async function calculaSobrePeriodo(c: CalculoSobrePeriodo): Promise<PaginaSobrePeriodo> {
  const dir = fs.mkdtempSync(path.join(c.tmp ?? os.tmpdir(), 'ao-vivo-'));
  try {
    const tEscrita = Date.now();
    const buscadas = new Set(c.dados.consultas.map((q) => q.query));
    const copiar = queriesPequenas(c.dash, c.model).filter((q) => !buscadas.has(q));
    await escreveSnapshotDoPeriodo(
      dir,
      c.model,
      c.dados,
      c.agora.toISOString(),
      c.pequenasDe ? { dir: c.pequenasDe, queries: copiar } : undefined,
    );
    // A agenda do período não traz o `Status Protocolo Dia`: congela como o filho da busca.
    const temStatusDia = planeja([c.dash], c.model).calculadas.some((t) => normalizeName(t) === 'status protocolo dia');
    const veioPronto = (c.dados.calculadas ?? []).some((t) => normalizeName(t.tabela) === 'status protocolo dia');
    if (temStatusDia && !veioPronto) await congelaStatusDoDia(dir, c.model, c.dash, c.agora, c.agora.toISOString());
    const escrita = Date.now() - tEscrita;
    const r = await calculaNoDiretorio({ ...c, dir });
    return { ...r, ms: { escrita, ...r.ms } };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A página do pedido montada de duas fontes: os visuais ao vivo e os que o ao vivo não
 * responde (`fora`), calculados pelo snapshot. Na ORDEM de `alvo` — a do relatório —, e
 * com o resumo somado. Um visual que nenhuma das duas trouxe não é inventado: falta.
 */
export function juntaPaginas(alvo: DashboardSpec, vivo: PaginaCalculada, doSnapshot: PaginaCalculada): PaginaCalculada {
  const porId = new Map<string, VisualCalculado>();
  for (const v of doSnapshot.visuais) porId.set(v.id, v);
  for (const v of vivo.visuais) porId.set(v.id, v);
  const visuais = (alvo.visuals ?? []).map((v) => porId.get(v.id)).filter((v): v is VisualCalculado => v !== undefined);
  return {
    ...doSnapshot,
    id: alvo.id,
    visuais,
    resumo: {
      calculados: vivo.resumo.calculados + doSnapshot.resumo.calculados,
      falharam: vivo.resumo.falharam + doSnapshot.resumo.falharam,
      semCalculo: vivo.resumo.semCalculo + doSnapshot.resumo.semCalculo,
    },
    ms: Math.max(vivo.ms, doSnapshot.ms),
  };
}

export interface PedidoDaPaginaAoVivo extends Omit<CalculoSobrePeriodo, 'fora' | 'formaCompleta' | 'dados'> {
  readonly ctx: ContextoAoVivo;
  /** Os filtros da tela (`?filtro=`) — é deles que sai o período. */
  readonly daTela: readonly FiltroSpec[];
}

export type PaginaAoVivo =
  | (PaginaSobrePeriodo & {
      readonly periodo: PeriodoAoVivo;
      readonly fora: ReadonlyMap<string, string>;
      readonly busca: DadosDoPeriodo['ms'];
      readonly protocolos: number;
    })
  | { readonly porque: string };

/** A página do pedido, ao vivo — ou por que este pedido não tem como ser ao vivo. */
export async function calculaPaginaAoVivo(p: PedidoDaPaginaAoVivo): Promise<PaginaAoVivo> {
  const d = decideAoVivo(p.dash, p.daTela, p.model);
  if ('porque' in d) return d;
  const dados = await buscaDoPeriodo(p.ctx, d.periodo, p.agora);
  const r = await calculaSobrePeriodo({ ...p, fora: d.fora, ...(d.formaCompleta ? { formaCompleta: d.formaCompleta } : {}), dados });
  return { ...r, periodo: d.periodo, fora: d.fora, busca: dados.ms, protocolos: dados.protocolos };
}

// ------------------------------------------------------------------ a comparação

export interface VisualDiferente {
  readonly id: string;
  readonly titulo?: string;
  /** A forma da diferença, sem valor nenhum. */
  readonly porque: string;
}

export interface Comparacao {
  readonly comparados: number;
  readonly iguais: number;
  readonly diferentes: readonly VisualDiferente[];
  /**
   * Os MESMOS itens em outra ordem. Separado de `diferentes` porque é o que uma tabela
   * ordenada com empate faz entre duas consultas: a ordem dos empatados segue a ordem em
   * que as linhas chegaram, e a consulta original já a varia de uma rodada para a outra
   * (medido em 23/10/2026: o hash da VISÃO GERAL mudou entre duas buscas da original e
   * não mudou entre duas da costurada). Número nenhum da tela muda.
   */
  readonly soOrdem: readonly VisualDiferente[];
  /** Visuais que o ao vivo não responde e por isso não entram na conta. */
  readonly fora: number;
}

/** O que decide o número na tela. `ms` e `posicao` ficam de fora: não são o resultado. */
function conteudoDe(v: VisualCalculado): string {
  return JSON.stringify([v.conteudo, v.semCalculo ?? null, v.erro ?? null, v.nota ?? null, v.sobDemanda ?? null, v.dados ?? null]);
}

/** A forma de `dados`: o tamanho de cada lista, nunca o que está nela. */
function formaDe(dados: unknown): string {
  if (Array.isArray(dados)) return `[${dados.length}]`;
  if (dados === null || typeof dados !== 'object') return typeof dados;
  const partes = Object.entries(dados as Record<string, unknown>)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}=${(v as unknown[]).length}`);
  return partes.length ? partes.join(' ') : 'objeto';
}

const resumo = (s: string): string => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);

/** Quantos itens de `a` faltam em `b`, como multiconjunto pelo JSON de cada item. */
function soEm(a: readonly unknown[], b: readonly unknown[]): number {
  const conta = new Map<string, number>();
  for (const x of b) {
    const k = JSON.stringify(x);
    conta.set(k, (conta.get(k) ?? 0) + 1);
  }
  let falta = 0;
  for (const x of a) {
    const k = JSON.stringify(x);
    const n = conta.get(k) ?? 0;
    if (n > 0) conta.set(k, n - 1);
    else falta++;
  }
  return falta;
}

/**
 * Onde duas listas de mesmo nome diferem: quantos itens só de um lado, ou só a ordem.
 * Numa tabela (`colunas` com `nome` e `linhas` de listas), também QUAIS colunas — o nome
 * da coluna é do modelo, não do cliente.
 */
function ondeDifere(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const partes: string[] = [];
  for (const [k, va] of Object.entries(a)) {
    const vb = b[k];
    if (!Array.isArray(va) || !Array.isArray(vb) || JSON.stringify(va) === JSON.stringify(vb)) continue;
    const soA = soEm(va, vb);
    const soB = soEm(vb, va);
    if (soA === 0 && soB === 0) {
      partes.push(`${k}: os mesmos ${va.length} em outra ordem`);
      continue;
    }
    let colunas = '';
    const nomes = Array.isArray(a['colunas']) ? (a['colunas'] as { nome?: unknown }[]).map((c) => String(c?.nome ?? '?')) : null;
    if (k === 'linhas' && nomes && va.every(Array.isArray) && vb.every(Array.isArray)) {
      const difere = nomes.filter((_, i) => soEm(va.map((l) => (l as unknown[])[i]), vb.map((l) => (l as unknown[])[i])) > 0);
      colunas = difere.length ? `; colunas com valor diferente: ${difere.join(', ')}` : '; nenhuma coluna sozinha difere — muda a combinação';
    }
    partes.push(`${k}: ${soA} só na referência, ${soB} só ao vivo (de ${va.length} → ${vb.length})${colunas}`);
  }
  return partes;
}

function porqueDifere(ref: VisualCalculado, vivo: VisualCalculado): string {
  if (Boolean(ref.erro) !== Boolean(vivo.erro)) return ref.erro ? 'erro só na referência' : 'erro só ao vivo';
  if (ref.erro) return 'erros diferentes';
  if (ref.conteudo !== vivo.conteudo || ref.semCalculo !== vivo.semCalculo) return 'conteúdo de outro tipo';
  const a = JSON.stringify(ref.dados ?? null);
  const b = JSON.stringify(vivo.dados ?? null);
  const onde =
    ref.dados && vivo.dados && typeof ref.dados === 'object' && typeof vivo.dados === 'object'
      ? ondeDifere(ref.dados as Record<string, unknown>, vivo.dados as Record<string, unknown>)
      : [];
  return (
    `dados ${formaDe(ref.dados)} (${a.length} B, ${resumo(a)}) → ${formaDe(vivo.dados)} (${b.length} B, ${resumo(b)})` +
    (onde.length ? ` — ${onde.join('; ')}` : '')
  );
}

/** Os mesmos dados a menos da ordem das listas de primeiro nível? */
function soMudaAOrdem(ref: VisualCalculado, vivo: VisualCalculado): boolean {
  const a = ref.dados;
  const b = vivo.dados;
  if (conteudoDe({ ...ref, dados: null }) !== conteudoDe({ ...vivo, dados: null })) return false;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && soEm(a, b as unknown[]) === 0;
  const ka = Object.keys(a).sort();
  if (ka.join('\u0000') !== Object.keys(b).sort().join('\u0000')) return false;
  return ka.every((k) => {
    const x = (a as Record<string, unknown>)[k];
    const y = (b as Record<string, unknown>)[k];
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && soEm(x, y) === 0;
    return JSON.stringify(x) === JSON.stringify(y);
  });
}

/** Visual a visual, pelo id. Visual de `fora` não conta; visual que sumiu de um lado é diferente. */
export function comparaPaginas(ref: PaginaCalculada, vivo: PaginaCalculada, fora: ReadonlyMap<string, string>): Comparacao {
  const doVivo = new Map(vivo.visuais.map((v) => [v.id, v]));
  const diferentes: VisualDiferente[] = [];
  const soOrdem: VisualDiferente[] = [];
  let comparados = 0;
  let foraDaConta = 0;
  for (const r of ref.visuais) {
    if (fora.has(r.id)) {
      foraDaConta++;
      continue;
    }
    comparados++;
    const v = doVivo.get(r.id);
    const titulo = r.titulo ? { titulo: r.titulo } : {};
    if (!v) diferentes.push({ id: r.id, ...titulo, porque: 'ausente ao vivo' });
    else if (conteudoDe(r) === conteudoDe(v)) continue;
    else (soMudaAOrdem(r, v) ? soOrdem : diferentes).push({ id: r.id, ...titulo, porque: porqueDifere(r, v) });
  }
  return { comparados, iguais: comparados - diferentes.length - soOrdem.length, diferentes, soOrdem, fora: foraDaConta };
}
