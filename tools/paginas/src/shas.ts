#!/usr/bin/env node
// `npm run paginas:shas` — a impressão digital do relatório inteiro, um SHA por visual.
//
// ─────────────────────────────────────────────────────────────────────────────
// PARA QUE SERVE
//
// Uma campanha de desempenho vive de uma pergunta só: *o número continua o mesmo?*
// `npm run paginas` responde "calculou" ou "falhou" — e um visual que calcula pode
// calcular errado, como a própria saída dele avisa. `npm test` responde sobre
// unidades, não sobre o relatório contra o snapshot de hoje.
//
// Este programa fecha esse vão. Ele calcula as 14 páginas e imprime, para cada
// visual, o SHA-256 do conteúdo. Otimização que não muda resultado não muda nenhum
// SHA. Se mudar um, o diff diz QUAL visual, e aí a mudança ou é um defeito ou é uma
// divergência que alguém tem de decidir — mas ela não passa calada.
//
//   npm run paginas:shas > antes.txt
//   ... mexe no motor ...
//   npm run paginas:shas > depois.txt
//   diff antes.txt depois.txt
//
// ⚠ **Não é paridade com o Power BI.** É equivalência com o que ESTE código produzia
// há cinco minutos. Serve para provar que uma otimização é inócua; não prova que o
// número está certo. Para isso, `specs/_catalog/paridade-janela.yaml`.
//
// ⚠ **Ele muda quando o SNAPSHOT muda, e isso é o esperado.** Compare sempre os dois
// lados contra o mesmo snapshot em disco — uma rematerialização no meio invalida a
// comparação inteira, e ela não tem como perceber sozinha.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Só id, tipo, contagem e o hash — que
// é justamente o jeito de falar sobre o conteúdo sem mostrá-lo. As tabelas trazem
// nome, endereço e CPF de cliente, e a saída daqui precisa ser segura para colar em
// ticket. O hash é de mão única; o que ele revela é só "mudou" ou "não mudou".
//
// Uso:
//   npm run paginas:shas
//   npm run paginas:shas -- --pagina=agendamento-field
//   npm run paginas:shas -- --pagina=visao-geral,relatorio-do-mes

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { carrega, todaFormaCompleta } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { calculaPagina, type VisualCalculado } from '../../../apps/api/src/calcula.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const args = process.argv.slice(2);
const pedidas = args
  .filter((a) => a.startsWith('--pagina='))
  .flatMap((a) => a.slice('--pagina='.length).split(',').map((s) => s.trim()))
  .filter(Boolean);
for (const a of args) {
  if (!a.startsWith('--pagina=')) {
    console.error(`argumento desconhecido: ${a}`);
    process.exit(2);
  }
}

/**
 * O "agora" da execução inteira, tirado uma vez.
 *
 * 25 das 121 expressões chamam `TODAY()`. Sem isto, duas execuções que caíssem em
 * lados diferentes da meia-noite dariam SHAs diferentes sem ninguém ter mexido em
 * nada — e o programa passaria a acusar mudança onde não houve.
 *
 * ⚠ Ele **não** congela a data entre execuções: rodar o "antes" hoje e o "depois"
 * amanhã compara dois dias. Rode os dois lados juntos.
 */
const AGORA = new Date();

const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));
const todas = loadDashboards(path.join(ROOT, 'specs'));
const invalidas = pedidas.filter((p) => !todas.some((d) => d.id === p));
if (invalidas.length) {
  console.error(`páginas que não existem: ${invalidas.join(', ')}`);
  process.exit(2);
}
const alvo = pedidas.length ? todas.filter((d) => pedidas.includes(d.id)) : todas;

/**
 * Serialização estável do conteúdo de um visual.
 *
 * `JSON.stringify` cru não serve: a ordem das chaves de um objeto é a de inserção, e
 * duas execuções do mesmo cálculo podem montar o mesmo objeto por caminhos
 * diferentes — o SHA acusaria mudança onde não houve. Chave ordenada torna o hash
 * função do CONTEÚDO, que é o que se quer comparar.
 *
 * Array **não** é ordenado: em tabela e gráfico a ordem das linhas é resultado, e
 * ordenar aqui esconderia exatamente a classe de regressão que mais importa.
 */
function estavel(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estavel);
  if (v === null || typeof v !== 'object') {
    // `Date` e `undefined` viram forma explícita: `JSON.stringify` descarta a
    // segunda dentro de objeto, e aí "campo sumiu" e "campo virou undefined" dariam
    // o mesmo hash.
    // Sentinela em ASCII puro, e de proposito: um marcador com byte NUL dentro
    // deixaria ESTE arquivo ilegivel para o `grep` (ver o aviso do CLAUDE.md sobre
    // `incremental.ts`). Colisao com um valor real de mesma grafia e teorica e
    // inofensiva: ela so acusaria mudanca onde nao houve, nunca o contrario.
    return v === undefined ? '<<ausente>>' : v;
  }
  if (v instanceof Date) return `<<data>>${v.toISOString()}`;
  const fora: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).sort()) {
    fora[k] = estavel((v as Record<string, unknown>)[k]);
  }
  return fora;
}

function sha(v: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(estavel(v))).digest('hex').slice(0, 16);
}

/** Quantas linhas o visual devolveu, quando dá para dizer sem olhar o conteúdo. */
function tamanho(v: VisualCalculado): string {
  const d = v.dados as { linhas?: unknown[]; pontos?: unknown[] } | undefined;
  if (d && Array.isArray(d.linhas)) return `${d.linhas.length} linha(s)`;
  if (d && Array.isArray(d.pontos)) return `${d.pontos.length} ponto(s)`;
  return '';
}

let visuais = 0;
let comConteudo = 0;

for (const dash of alvo) {
  const c = await carrega({
    dir: path.join(ROOT, DIRETORIO_PADRAO),
    model,
    dashboards: [dash],
    now: AGORA,
    precisaFormaCompleta: todaFormaCompleta(model),
  });
  const p = calculaPagina(dash, c.ev, { de: 0, linhas: 1 });

  // Ordem fixa por id: `calculaPagina` devolve na ordem do spec, e um diff que
  // dependesse dela acusaria mudança quando alguém só reordenasse o YAML.
  for (const v of [...p.visuais].sort((a, b) => a.id.localeCompare(b.id))) {
    visuais++;
    let marca: string;
    if (v.erro) marca = `ERRO      ${sha(v.erro)}`;
    else if (v.conteudo === null) marca = `sem-calc  ${'-'.repeat(16)}`;
    else {
      comConteudo++;
      marca = `${v.conteudo.padEnd(9)} ${sha(v.dados)}`;
    }
    console.log(`${dash.id.padEnd(24)} ${v.id.slice(0, 8)}  ${v.tipo.padEnd(30)} ${marca}  ${tamanho(v)}`);
  }
}

console.error(
  `\n${alvo.length} página(s), ${visuais} visuais, ${comConteudo} com conteúdo hasheado.\n` +
    'Compare com um paginas:shas do MESMO snapshot. Isto não é paridade com o Power BI.',
);
