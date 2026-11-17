// Sonda das páginas do ANO ao vivo (docs/DECISAO-AO-VIVO.md, fase 3): a Premiação e o
// Diário calculados sobre o conjunto do ano que vem do SRD dão os mesmos números que
// sobre as tabelas inteiras?
//
//   npm run probe:ao-vivo-ano
//
// A produtividade e as tabelas pequenas são buscadas UMA vez e entram iguais nos dois
// lados; a PROTOCOLOS GERAL vem inteira (a referência, como o refresh a grava) e do ano
// (a variante `protocolos-geral-criados-desde`), as duas AO MESMO TEMPO. A única diferença
// entre as pontas é a PG — que é o que se quer provar. Cada página é calculada com o
// filtro com que abre e com outro mês, pelo mesmo `carrega` + `calculaPagina` da API
// (o corte da página por DATA CRIADO incluso), e comparada visual a visual.
//
// Só leitura. Imprime contagens, tempos e a forma das diferenças; NUNCA valor de linha.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { leCatalogoAoVivo, leVariantesAoVivo } from '../../../packages/ao-vivo/src/catalogo.ts';
import { buscaAoVivo, type ContextoAoVivo } from '../../../packages/ao-vivo/src/executor.ts';
import {
  CALCULADAS_DO_ANO,
  periodoDoAno,
  PAGINAS_DO_ANO,
  QUERIES_DO_ANO,
  VARIANTE_PG_DO_ANO,
} from '../../../packages/ao-vivo/src/instalacao-do-ano.ts';
import { aplicaRecorte } from '../../../packages/ao-vivo/src/recorte.ts';
import {
  escreveSnapshotDoPeriodo,
  type CalculadaPronta,
  type TabelaDoPeriodo,
} from '../../../packages/ao-vivo/src/snapshot-do-periodo.ts';
import { carrega } from '../../../packages/snapshot/src/carrega.ts';
import type { Escalar } from '../../../packages/snapshot/src/formato.ts';
import type { DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { applyDotEnv, loadConfig, missingFor } from '../../../packages/query-engine/src/config.ts';
import {
  createMariaConnector,
  createMariaPool,
  createVoalleConnector,
  createVoallePool,
} from '../../../packages/query-engine/src/connectors-sql.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import type { Connector } from '../../../packages/query-engine/src/types.ts';
import { leJuncoes, reconciliadorDe } from '../../../packages/semantic-model/src/juncoes.ts';
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { codificaFiltro, decodificaFiltros, type FiltroDeTela } from '../../../packages/widget-engine/src/filtro-url.ts';
import { filtrosPadrao } from '../../../packages/widget-engine/src/filtros-padrao.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { LINHAS_MAXIMO } from '../../../api/src/calcula.ts';
import { calculaSobrePeriodo, comparaPaginas, queriesPequenas } from '../../../api/src/pagina-ao-vivo.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
applyDotEnv(ROOT);
for (const alvo of ['voalle', 'maria'] as const) {
  const falta = missingFor(alvo);
  if (falta.length) {
    console.error(`falta no .env: ${falta.join(', ')}`);
    process.exit(2);
  }
}

const cfg = loadConfig();
// A PG inteira leva ~1–2 min e a produtividade ~1 min: teto desta sonda, não o do .env.
const statementTimeoutMs = 900_000;
const voallePool = await createVoallePool({ ...cfg.voalle, poolMax: 8, statementTimeoutMs, applicationName: 'analytics-probe-ao-vivo' });
const mariaPool = await createMariaPool({ ...cfg.maria, statementTimeoutMs });
const ctx: ContextoAoVivo = {
  registry: QueryRegistry.fromSpecsDir(SPECS),
  model: SemanticModel.fromSpecsDir(SPECS),
  catalogo: leCatalogoAoVivo(SPECS),
  connectors: new Map<string, Connector>([
    ['dbVoalle', createVoalleConnector(voallePool)],
    ['dbMaria', createMariaConnector(mariaPool)],
  ]),
  culture:
    (yaml.parse(fs.readFileSync(path.join(SPECS, '_catalog', 'model.yaml'), 'utf8')) as { culture?: string | null }).culture ?? null,
  reconcilia: reconciliadorDe(leJuncoes(SPECS)),
};
const AGORA = new Date();
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** O CALENDARIO INSTALADO como o refresh o congela: DAX sobre a PG inteira, sem corte. */
async function calendarioCongelado(consultas: TabelaDoPeriodo[], paginas: DashboardSpec[]): Promise<CalculadaPronta[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-vivo-ano-cal-'));
  try {
    await escreveSnapshotDoPeriodo(dir, ctx.model, { consultas }, AGORA.toISOString());
    // Duas páginas: o carregador não aplica corte de página (`carrega.ts`).
    const c = await carrega({ dir, model: ctx.model, dashboards: paginas, now: AGORA, lerCalculadas: false });
    const t = ctx.model.table(CALCULADAS_DO_ANO[0]!)!;
    const linhas = c.ev.dataset.rows(t.name) as unknown as Record<string, Escalar>[];
    for (const col of t.columns.filter((x) => x.calculated && x.dax)) {
      const chave = normalizeName(col.name);
      for (const l of linhas) l[chave] = (c.ev.columnValue(t.name, col.name, l as never) ?? null) as Escalar;
    }
    return [{ tabela: t.name, linhas }];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

let diferentes = 0;
try {
  const paginas = loadDashboards(SPECS).filter((d) => PAGINAS_DO_ANO.includes(d.id));
  const periodo = periodoDoAno(ctx.model, paginas[0]!.id, AGORA);
  const variante = leVariantesAoVivo(SPECS).get(VARIANTE_PG_DO_ANO)!;
  console.log(`ano [${periodo.desde}, ${periodo.ate}) — agora ${AGORA.toISOString()}\n`);

  const busca = async (rotulo: string, f: () => Promise<{ colunas: string[]; linhas: Record<string, unknown>[] }>) => {
    const t = Date.now();
    const r = await f();
    console.log(`  ${rotulo.padEnd(34)} ${s(Date.now() - t).padStart(7)}  ${r.linhas.length} linhas`);
    return r;
  };
  const pequenasDasPaginas = [...new Set(paginas.flatMap((d) => queriesPequenas(d, ctx.model)))].filter((q) => !QUERIES_DO_ANO.includes(q));
  const [pp, pgInteira, pgDoAno, ...pequenas] = await Promise.all([
    busca('protocolos-produtividade', () => buscaAoVivo(ctx, { query: 'protocolos-produtividade', agora: AGORA })),
    busca('protocolos-geral INTEIRA (referência)', () => buscaAoVivo(ctx, { query: 'protocolos-geral', agora: AGORA })),
    busca('protocolos-geral DO ANO (ao vivo)', async () => {
      const r = await buscaAoVivo(
        { ...ctx, catalogo: new Map([[variante.query, variante]]) },
        { query: variante.query, params: { desde: periodo.desde, ate: periodo.ate }, agora: AGORA },
      );
      return { colunas: r.colunas, linhas: aplicaRecorte(r.linhas, variante.recorte, periodo) };
    }),
    ...pequenasDasPaginas.map((q) => busca(q, () => buscaAoVivo(ctx, { query: q, agora: AGORA }))),
  ]);
  const comuns: TabelaDoPeriodo[] = [
    { query: 'protocolos-produtividade', colunas: pp!.colunas, linhas: pp!.linhas as never },
    ...pequenasDasPaginas.map((q, i) => ({ query: q, colunas: pequenas[i]!.colunas, linhas: pequenas[i]!.linhas as never })),
  ];
  const ref = [...comuns, { query: 'protocolos-geral', colunas: pgInteira!.colunas, linhas: pgInteira!.linhas as never }];
  const vivo = [...comuns, { query: 'protocolos-geral', colunas: pgDoAno!.colunas, linhas: pgDoAno!.linhas as never }];

  // O CALENDARIO INSTALADO congelado, como o refresh o grava: calculado sobre a PG
  // INTEIRA, sem o corte da página (carga de duas páginas não corta). Entra igual nos dois
  // lados — na API ele vem do snapshot (`calculadasCongeladas`). Sem isto as duas pontas o
  // calculariam sobre a PG cortada e errariam IGUAL, e a comparação passaria (ACHADOS #205).
  const calendario = await calendarioCongelado(ref, paginas);
  console.log(`  CALENDARIO INSTALADO congelado: ${calendario[0]!.linhas.length} dias`);

  const tela = (fs: FiltroDeTela[]) => decodificaFiltros(fs.map(codificaFiltro));
  const mes = (d: Date) => [
    { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', nivel: 'Ano', valores: [d.getFullYear()] },
    { tabela: 'CALENDARIO INSTALADO', coluna: 'DATA INSTALADO', nivel: 'Mês', valores: [MESES[d.getMonth()]!] },
  ];
  for (const dash of paginas) {
    const cenarios: [string, FiltroDeTela[]][] = [
      ['como a página abre', filtrosPadrao(dash.id, AGORA)],
      ['mês corrente', mes(AGORA)],
    ];
    for (const [nome, filtros] of cenarios) {
      const daTela = tela(filtros);
      const comum = {
        model: ctx.model,
        dash,
        alvo: { ...dash, filters: [...(dash.filters ?? []), ...daTela] },
        fora: new Map<string, string>(),
        janela: { de: 0, linhas: LINHAS_MAXIMO },
        clicados: [],
        agora: AGORA,
      };
      const pRef = await calculaSobrePeriodo({ ...comum, dados: { consultas: ref, calculadas: calendario } });
      const pVivo = await calculaSobrePeriodo({ ...comum, dados: { consultas: vivo, calculadas: calendario } });
      const c = comparaPaginas(pRef.pagina, pVivo.pagina, new Map());
      const erros = (p: typeof pRef) => p.pagina.resumo.falharam;
      console.log(
        `\n${dash.id} — ${nome}${daTela.length ? '' : ' (sem filtro de data)'}: ${c.comparados} visuais, ${c.iguais} iguais, ` +
          `${c.soOrdem.length} só na ordem, ${c.diferentes.length} diferentes; erros ${erros(pRef)} na referência, ${erros(pVivo)} ao vivo`,
      );
      const pg = (p: typeof pRef) => p.linhasPorTabela.get('PROTOCOLOS GERAL') ?? 0;
      console.log(`  PROTOCOLOS GERAL depois do corte: ${pg(pRef)} na referência, ${pg(pVivo)} ao vivo`);
      for (const d of [...c.soOrdem, ...c.diferentes]) console.log(`    ${(d.titulo ?? d.id).slice(0, 40).padEnd(40)} ${d.porque}`);
      diferentes += c.diferentes.length + erros(pVivo);
    }
  }
  console.log(`\n${diferentes === 0 ? 'PARIDADE: o conjunto do ano dá os mesmos números.' : 'HÁ DIFERENÇA — ver acima.'}`);
} finally {
  await voallePool.end();
  await mariaPool.end();
}
process.exit(diferentes === 0 ? 0 : 1);
