// Sonda da fonte ao vivo (docs/DECISAO-AO-VIVO.md): a consulta COSTURADA devolve as
// mesmas linhas que a ORIGINAL do catálogo, recortada do mesmo jeito?
//
//   npm run probe:ao-vivo -- --desde=2026-10-06 --ate=2026-10-13 [--so=agenda|status-dia]
//
// A página inteira (`--so=pagina`, até 25/10/2026) saiu daqui: desde que o mês da agenda
// traz a FIELD AGENDA completa, a referência teria de ser a agenda completa original de 3
// meses (mais de 20 min de busca). A paridade da página é a de `npm run
// probe:ao-vivo-agenda`, sobre o snapshot em disco.
//
// Para o período pedido (use um período FECHADO — dia que já não muda):
//   1. `field-agenda-slot`: a original (janela inteira de 3 meses) recortada em memória
//      pelos protocolos com horário no período, contra a costurada;
//   2. `protocolos-geral`: a original inteira recortada pelos protocolos da agenda do
//      passo 1, contra a costurada com a mesma lista.
//
// As duas pontas passam pelo MESMO executor (`buscaAoVivo`): mesmo M, mesmas colunas
// calculadas, mesmo instante. A única diferença é o SQL — que é o que se quer provar.
//
// Só leitura (a sessão do pool é `default_transaction_read_only=on`). Imprime contagens,
// tempos e hashes; NUNCA valor de linha (CLAUDE.md, regra 2).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { leAgregadasAoVivo, leCatalogoAoVivo, type Recorte } from '../../../packages/ao-vivo/src/catalogo.ts';
import { buscaRelatosDoDia, statusProtocoloDiaAoVivo } from '../../../packages/ao-vivo/src/status-dia.ts';
import { statusProtocoloDia } from '../../../packages/snapshot/src/nativas.ts';
import { buscaAoVivo, type ContextoAoVivo, type ResultadoAoVivo } from '../../../packages/ao-vivo/src/executor.ts';
import { aplicaRecorte, celula, texto } from '../../../packages/ao-vivo/src/recorte.ts';
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
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import type { Escalar } from '../../../packages/snapshot/src/formato.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');
applyDotEnv(ROOT);

const arg = (nome: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const desde = arg('desde');
const ate = arg('ate');
if (!desde || !ate || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
  console.error('uso: npm run probe:ao-vivo -- --desde=AAAA-MM-DD --ate=AAAA-MM-DD   (ate exclusivo; período FECHADO)');
  process.exit(2);
}
for (const alvo of ['voalle', 'maria'] as const) {
  const falta = missingFor(alvo);
  if (falta.length) {
    console.error(`falta no .env: ${falta.join(', ')}`);
    process.exit(2);
  }
}

const cfg = loadConfig();
// Teto desta sonda, não o do .env (30 s é o teto de pedido de tela): a ORIGINAL da
// agenda leva ~18 s e a dos protocolos ~60 s.
const statementTimeoutMs = 600_000;
const voallePool = await createVoallePool({ ...cfg.voalle, statementTimeoutMs, applicationName: 'analytics-probe-ao-vivo' });
const mariaPool = await createMariaPool({ ...cfg.maria, statementTimeoutMs });
const connectors = new Map<string, Connector>([
  ['dbVoalle', createVoalleConnector(voallePool)],
  ['dbMaria', createMariaConnector(mariaPool)],
]);

const culture =
  (yaml.parse(fs.readFileSync(path.join(SPECS, '_catalog', 'model.yaml'), 'utf8')) as { culture?: string | null })
    .culture ?? null;
const ctx: ContextoAoVivo = {
  registry: QueryRegistry.fromSpecsDir(SPECS),
  model: SemanticModel.fromSpecsDir(SPECS),
  catalogo: leCatalogoAoVivo(SPECS),
  connectors,
  culture,
  reconcilia: reconciliadorDe(leJuncoes(SPECS)),
};
const AGORA = new Date();

const hash = (xs: readonly string[]): string => createHash('sha256').update(xs.join('\n')).digest('hex').slice(0, 10);

/** O recorte final do pacote — o MESMO que quem consome a fonte ao vivo aplica. */
function recorta(r: ResultadoAoVivo, recorte: Recorte, lista: ReadonlySet<string>): Record<string, Escalar>[] {
  return aplicaRecorte(r.linhas, recorte, { desde: desde!, ate: ate!, protocolos: lista });
}

/** Compara duas listas de linhas como multiconjuntos, por linha inteira e por coluna. */
function compara(nome: string, colunas: readonly string[], ref: Record<string, Escalar>[], vivo: Record<string, Escalar>[]): boolean {
  const chave = (l: Record<string, Escalar>) => colunas.map((c) => texto(celula(l, c))).join('\u0001');
  const conta = (ls: Record<string, Escalar>[]) => {
    const m = new Map<string, number>();
    for (const l of ls) m.set(chave(l), (m.get(chave(l)) ?? 0) + 1);
    return m;
  };
  const a = conta(ref);
  const b = conta(vivo);
  let soRef = 0;
  let soVivo = 0;
  for (const [k, n] of a) soRef += Math.max(0, n - (b.get(k) ?? 0));
  for (const [k, n] of b) soVivo += Math.max(0, n - (a.get(k) ?? 0));
  const iguais = soRef === 0 && soVivo === 0;
  console.log(
    `  ${nome}: referência ${ref.length} linha(s), ao vivo ${vivo.length}; ` +
      `só na referência ${soRef}, só ao vivo ${soVivo} → ${iguais ? 'IGUAIS' : 'DIFERENTES'}`,
  );
  if (!iguais) {
    const difere = colunas.filter(
      (c) => hash(ref.map((l) => texto(celula(l, c))).sort()) !== hash(vivo.map((l) => texto(celula(l, c))).sort()),
    );
    console.log(`    colunas cujo multiconjunto difere: ${difere.join(', ') || '(nenhuma — muda só a combinação)'}`);
  }
  return iguais;
}

function tempos(r: ResultadoAoVivo): string {
  const buscas = r.buscas.map((b) => `${b.id} ${(b.msBanco / 1000).toFixed(1)} s/${b.linhas}`).join(', ');
  return `${(r.ms.total / 1000).toFixed(1)} s (M ${(r.ms.m / 1000).toFixed(1)} s, calculadas ${(r.ms.calculadas / 1000).toFixed(1)} s; ${buscas})`;
}

/** O nome de cada conferência que deu diferente — o veredito diz QUAL, não só que houve. */
const falhas: string[] = [];
const confere = (nome: string, ok: boolean): void => {
  if (!ok) falhas.push(nome);
};
try {
  console.log(`período [${desde}, ${ate}) — agora ${AGORA.toISOString()}\n`);

  // 1. Agenda.
  const cAgenda = ctx.catalogo.get('field-agenda-slot')!;
  const refAgenda = await buscaAoVivo(ctx, { query: 'field-agenda-slot', agora: AGORA });
  const vivoAgenda = await buscaAoVivo(ctx, { query: 'field-agenda-slot', params: { desde, ate }, agora: AGORA });
  console.log('field-agenda-slot');
  console.log(`  original ${tempos(refAgenda)}`);
  console.log(`  ao vivo  ${tempos(vivoAgenda)}`);
  if (refAgenda.colunas.join('|') !== vivoAgenda.colunas.join('|')) {
    console.log('  COLUNAS DIFERENTES entre as duas pontas');
    confere('colunas da agenda', false);
  }
  // O MESMO recorte nas duas pontas. A costurada escolhe os protocolos por qualquer
  // `service_desk_slots` no período; a régua é o `Slot Agenda` FINAL (o da view). Um
  // protocolo reagendado para fora do período entra na costurada e sai no recorte — é
  // superconjunto por construção, e quem consome aplica o mesmo `recorta`.
  const vivoRecortado = recorta(vivoAgenda, cAgenda.recorte, new Set());
  console.log(`  ao vivo trouxe ${vivoAgenda.linhas.length - vivoRecortado.length} linha(s) de protocolo reagendado para fora do período (o recorte as tira)`);
  confere('linhas da agenda', compara('linhas', refAgenda.colunas, recorta(refAgenda, cAgenda.recorte, new Set()), vivoRecortado));

  // 3. `Status Protocolo Dia` (`--so=status-dia`). A referência é a regra de nativas.ts
  // sobre a agenda COMPLETA original (grão relato, 3 meses, colunas calculadas pelo DAX
  // — ~4 min e ~640 mil linhas: rode com --max-old-space-size=4096) e os protocolos
  // originais; o lado ao vivo é a mesma regra sobre a agenda no grão de slot, as
  // contagens de `relatos-do-dia` e os protocolos recortados.
  if (arg('so') === 'status-dia') {
    const lista = [...new Set(vivoRecortado.map((l) => texto(celula(l, 'Protocolo'))))];
    const conjunto = new Set(lista);
    const agregada = leAgregadasAoVivo(SPECS).get('relatos-do-dia')!;
    const tRel = Date.now();
    const relatos = await buscaRelatosDoDia(ctx, agregada, { desde: desde!, ate: ate! });
    const msRel = Date.now() - tRel;
    const vivoPg = await buscaAoVivo(ctx, { query: 'protocolos-geral', params: { protocolos: lista }, agora: AGORA });
    const vivoStatus = statusProtocoloDiaAoVivo(vivoRecortado, relatos, aplicaRecorte(vivoPg.linhas, ctx.catalogo.get('protocolos-geral')!.recorte, { protocolos: conjunto }));
    console.log(`\nStatus Protocolo Dia — ao vivo: relatos-do-dia ${(msRel / 1000).toFixed(1)} s/${relatos.length} grupo(s), protocolos ${tempos(vivoPg)}`);

    const refCompleta = await buscaAoVivo(ctx, { query: 'field-agenda', agora: AGORA });
    const refPg = await buscaAoVivo(ctx, { query: 'protocolos-geral', agora: AGORA });
    console.log(`  referência: field-agenda ${tempos(refCompleta)}; protocolos ${tempos(refPg)}`);
    const completaRecortada = aplicaRecorte(refCompleta.linhas, cAgenda.recorte, { desde: desde!, ate: ate! });
    const comoNativa = completaRecortada.map((l) => ({
      protocolo: celula(l, 'Protocolo'),
      'slot agenda': celula(l, 'Slot Agenda'),
      'data relato': celula(l, 'Data Relato'),
      base: celula(l, 'Base'),
      turno: celula(l, 'Turno'),
      rankdataprotocolo: celula(l, 'RankDataProtocolo'),
      'tipo de protocolo': celula(l, 'Tipo de Protocolo'),
      categoriaprodutividade: celula(l, 'CategoriaProdutividade'),
      skill: celula(l, 'Skill'),
    }));
    const pgComoNativa = aplicaRecorte(refPg.linhas, ctx.catalogo.get('protocolos-geral')!.recorte, { protocolos: conjunto }).map((l) => ({
      'n°protocolo': celula(l, 'N°PROTOCOLO'),
      'data instalação': celula(l, 'DATA INSTALAÇÃO'),
    }));
    const refStatus = statusProtocoloDia(comoNativa, pgComoNativa);
    const colunasStatus = ['dia', 'protocolo', 'status', 'base dia', 'turno dia', 'rank protocolo dia', 'tipo protocolo dia'];
    confere('Status Protocolo Dia', compara('Status Protocolo Dia', colunasStatus, refStatus, vivoStatus));
    const porStatus = (ls: Record<string, Escalar>[]) =>
      [...ls.reduce((m, l) => m.set(String(l['status']), (m.get(String(l['status'])) ?? 0) + 1), new Map<string, number>())]
        .sort()
        .map(([s, n]) => `${s} ${n}`)
        .join(', ');
    console.log(`    referência: ${porStatus(refStatus)}\n    ao vivo:    ${porStatus(vivoStatus)}`);
  }

  // 2. Protocolos da agenda (`--so=agenda` pula: a original deles leva minutos).
  if (arg('so') !== 'agenda' && arg('so') !== 'status-dia') {
    const lista = [...new Set(vivoRecortado.map((l) => texto(celula(l, 'Protocolo'))))];
    console.log(`\nprotocolos-geral (${lista.length} protocolo(s) da agenda do período)`);
    const cPg = ctx.catalogo.get('protocolos-geral')!;
    const refPg = await buscaAoVivo(ctx, { query: 'protocolos-geral', agora: AGORA });
    const vivoPg = await buscaAoVivo(ctx, { query: 'protocolos-geral', params: { protocolos: lista }, agora: AGORA });
    console.log(`  original ${tempos(refPg)}`);
    console.log(`  ao vivo  ${tempos(vivoPg)}`);
    if (refPg.colunas.join('|') !== vivoPg.colunas.join('|')) {
      console.log('  COLUNAS DIFERENTES entre as duas pontas');
      confere('colunas dos protocolos', false);
    }
    const conjunto = new Set(lista);
    confere(
      'linhas dos protocolos',
      compara('linhas', refPg.colunas, recorta(refPg, cPg.recorte, conjunto), recorta(vivoPg, cPg.recorte, conjunto)),
    );
  }

  console.log(
    falhas.length === 0
      ? '\nPARIDADE: as consultas costuradas devolvem as mesmas linhas.'
      : `\nHÁ DIFERENÇA em: ${falhas.join(', ')} — ver acima. As duas pontas rodam com segundos de ` +
          'distância: diferença que muda de rodada para rodada (um atendimento em andamento) é o instante, não a costura.',
  );
} finally {
  await voallePool.end();
  await mariaPool.end();
}
process.exit(falhas.length === 0 ? 0 : 1);
