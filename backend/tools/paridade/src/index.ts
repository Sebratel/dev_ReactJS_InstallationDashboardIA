#!/usr/bin/env node
// `npm run paridade` — o número da plataforma bate com o da tela do Power BI?
//
// **É a pergunta que faltava responder.** `npm run paginas` prova que a conta
// *termina*; ele não sabe se ela está *certa*. Um visual que calcula pode calcular
// errado, e a única testemunha do valor correto é a tela do Power BI aberta na frente
// de alguém. Este programa é o lugar onde esse alguém dita os números, uma vez, e onde
// toda execução seguinte confere sozinha.
//
// **Depois da regra 9, o trabalho dele mudou de nome.** Não é mais "provar que é
// idêntico ao Power BI" — é **provar que é o pretendido**. Igual onde quisemos igual, e
// diferente onde `backend/specs/_catalog/divergencias.yaml` diz que decidimos diferente. Um
// número que difere sem divergência declarada é falha; um que difere **com** ela é o
// sistema funcionando, e um que **não** difere apesar dela também é falha — quer dizer
// que a divergência não chegou ao resultado.
//
// **Só card, e de propósito.** Card é um número, sem agrupamento, sem paginação, sem
// ordenação: ditar o valor da tela é inequívoco. Matriz e tabela exigiriam ditar
// célula por célula, e a primeira versão útil deste harness não pode depender de uma
// tarde de digitação. Quando os cards fecharem, o passo seguinte tem base.
//
// REGRA DE SAÍDA: nunca imprime valor de linha. Card é agregado — nome de cliente e
// endereço não passam por aqui. A saída é segura para colar em ticket.
//
// Uso:
//   npm run paridade                              # confere tudo que tem gabarito
//   npm run paridade -- --pagina=visao-geral
//   npm run paridade -- --esqueleto=visao-geral   # gera o gabarito em branco

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { loadDashboards, type DashboardSpec } from '../../../packages/widget-engine/src/spec.ts';
import { carrega, todaFormaCompleta } from '../../../packages/snapshot/src/carrega.ts';
import { DIRETORIO_PADRAO } from '../../../packages/snapshot/src/manifesto.ts';
import { calculaPagina } from '../../../api/src/calcula.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DIR_GABARITOS = path.join(ROOT, 'backend', 'specs', 'paridade');

/** Um número ditado da tela do Power BI. */
export interface CardEsperado {
  visual: string;
  /** Rótulo do card. Só para quem lê o arquivo — a comparação é por id. */
  rotulo?: string | null;
  /**
   * O valor que aparece na tela. `null` = ainda não conferido, e o programa diz isso
   * em vez de comparar com nada.
   */
  powerbi: number | null;
  /**
   * Id de `divergencias.yaml`, quando este card **deve** dar diferente.
   *
   * Preenchido, inverte a expectativa: bater vira falha. É o que impede uma
   * divergência de ser decidida, documentada, e nunca chegar ao número.
   */
  divergente?: string | null;
  observacao?: string | null;
}

export interface Gabarito {
  pagina: string;
  conferido_em?: string;
  por?: string;
  /** Diferença relativa aceita. Padrão 0,5% — arredondamento de tela, não de conta. */
  tolerancia?: number;
  cards: CardEsperado[];
}

const TOLERANCIA_PADRAO = 0.005;

export type Veredito =
  | 'bate'
  | 'difere'
  | 'divergencia-confirmada'
  | 'divergencia-nao-aplicada'
  | 'sem-gabarito'
  | 'nao-calculou';

export interface Resultado {
  pagina: string;
  visual: string;
  rotulo: string | null;
  esperado: number | null;
  obtido: number | null;
  erro?: string;
  veredito: Veredito;
  /** Diferença relativa, quando os dois lados são número. */
  delta?: number;
}

/**
 * Compara um card. Toda a lógica de veredito mora aqui, sem I/O, para ter teste.
 *
 * A regra que não é óbvia é a da divergência declarada: ali, **bater é falha**. Se
 * `peso-instalado-fim-de-semana` mudou o peso do sábado, um card que depende disso
 * *tem* que dar outro número — e se der o mesmo, ou a divergência não chegou ao
 * cálculo, ou o card não dependia dela e a anotação está errada. Nos dois casos alguém
 * precisa olhar.
 */
export function confere(
  esperado: CardEsperado,
  obtido: number | null,
  erro: string | undefined,
  tolerancia: number,
): { veredito: Veredito; delta?: number } {
  if (erro !== undefined || obtido === null) return { veredito: 'nao-calculou' };
  if (esperado.powerbi === null || esperado.powerbi === undefined) {
    return { veredito: 'sem-gabarito' };
  }

  const base = Math.abs(esperado.powerbi);
  // Divisão por zero: quando o esperado é 0, "relativo" não quer dizer nada e a
  // comparação vira exata. É o certo — um zero que virou 0,3 não é arredondamento.
  const delta = base === 0 ? (obtido === 0 ? 0 : 1) : Math.abs(obtido - esperado.powerbi) / base;
  const igual = delta <= tolerancia;

  if (esperado.divergente) {
    return { veredito: igual ? 'divergencia-nao-aplicada' : 'divergencia-confirmada', delta };
  }
  return { veredito: igual ? 'bate' : 'difere', delta };
}

/** O número de um card já calculado, ou `null` se ele não produziu número. */
function valorDoCard(dados: unknown): number | null {
  const d = dados as { valor?: unknown; tipoDoValor?: string } | undefined;
  if (!d || typeof d.valor !== 'number' || !Number.isFinite(d.valor)) return null;
  return d.valor;
}

function leGabaritos(pedidas: readonly string[]): Gabarito[] {
  if (!fs.existsSync(DIR_GABARITOS)) return [];
  return fs
    .readdirSync(DIR_GABARITOS)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => parseYaml(fs.readFileSync(path.join(DIR_GABARITOS, f), 'utf8')) as Gabarito)
    .filter((g) => pedidas.length === 0 || pedidas.includes(g.pagina));
}

// ---------------------------------------------------------------------------
// Esqueleto
// ---------------------------------------------------------------------------

/**
 * Escreve o gabarito em branco de uma página: um item por card, `powerbi: null`.
 *
 * Existe porque a alternativa é alguém abrir o PBIP e transcrever ids de visual à mão.
 * A parte cara desta conferência é o tempo de quem tem o Power BI aberto — o programa
 * tem de gastar o dele para poupar o dela.
 */
function esqueleto(dash: DashboardSpec): string {
  const cards = (dash.visuals ?? []).filter((v) => v.type === 'card' || v.type === 'multiRowCard');
  const linhas = cards.map((v) => {
    const campo = (v.fields ?? []).find((c) => c.role === 'Values');
    const rotulo = campo?.name ?? campo?.property ?? null;
    return [
      `  - visual: ${v.id}`,
      `    rotulo: ${JSON.stringify(rotulo)}`,
      `    powerbi: null   # <-- o número que aparece na tela`,
    ].join('\n');
  });

  return [
    '# MANTIDO POR HUMANOS — gabarito de paridade.',
    '#',
    '# Abra a página no Power BI e escreva em `powerbi:` o número que aparece em cada',
    '# card. `null` significa "ainda não conferido", e o programa diz isso em vez de',
    '# fingir que passou.',
    '#',
    '# Quando o número DEVE dar diferente porque a gente decidiu assim, ponha o id da',
    '# entrada de `backend/specs/_catalog/divergencias.yaml` em `divergente:`. Aí bater vira',
    '# falha — é o que impede uma divergência de ficar só no papel.',
    '',
    `pagina: ${dash.id}`,
    `conferido_em: null`,
    `por: null`,
    `tolerancia: ${TOLERANCIA_PADRAO}`,
    '',
    `cards:`,
    ...(linhas.length ? linhas : ['  [] # esta página não tem card']),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

const SIMBOLO: Record<Veredito, string> = {
  bate: '  OK  ',
  difere: 'DIFERE',
  'divergencia-confirmada': ' DIV  ',
  'divergencia-nao-aplicada': '!DIV!!',
  'sem-gabarito': '  ??  ',
  'nao-calculou': ' ERRO ',
};

async function principal(): Promise<number> {
  const args = process.argv.slice(2);
  const pedidas = args
    .filter((a) => a.startsWith('--pagina='))
    .flatMap((a) => a.slice('--pagina='.length).split(',').map((s) => s.trim()))
    .filter(Boolean);
  const gerar = args.find((a) => a.startsWith('--esqueleto='))?.slice('--esqueleto='.length);
  for (const a of args) {
    if (!a.startsWith('--pagina=') && !a.startsWith('--esqueleto=')) {
      console.error(`argumento desconhecido: ${a}`);
      return 2;
    }
  }

  const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'backend', 'specs'));
  const dashboards = loadDashboards(path.join(ROOT, 'backend', 'specs'));

  if (gerar) {
    const dash = dashboards.find((d) => d.id === gerar);
    if (!dash) {
      console.error(`página '${gerar}' não existe. As ${dashboards.length}: ${dashboards.map((d) => d.id).join(', ')}`);
      return 2;
    }
    fs.mkdirSync(DIR_GABARITOS, { recursive: true });
    const arq = path.join(DIR_GABARITOS, `${gerar}.yaml`);
    if (fs.existsSync(arq)) {
      console.error(`${arq} já existe. Apague-o antes de regerar — ele tem número ditado por gente.`);
      return 2;
    }
    fs.writeFileSync(arq, esqueleto(dash), 'utf8');
    console.log(`gabarito em branco: ${path.relative(ROOT, arq)}`);
    return 0;
  }

  const gabaritos = leGabaritos(pedidas);
  if (gabaritos.length === 0) {
    // Distinguir "não há gabarito nenhum" de "não há gabarito DESTA página": quem
    // digitou o nome errado precisa saber que digitou errado, e não concluir que o
    // harness não existe.
    if (pedidas.length > 0) {
      console.error(`Nenhum gabarito para: ${pedidas.join(', ')}.`);
      const existem = fs.existsSync(DIR_GABARITOS)
        ? fs.readdirSync(DIR_GABARITOS).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''))
        : [];
      console.error(existem.length ? `Existem: ${existem.join(', ')}` : 'Não há gabarito nenhum ainda.');
      return 2;
    }
    console.log('Nenhum gabarito em backend/specs/paridade/.');
    console.log('Gere um com: npm run paridade -- --esqueleto=<pagina>');
    return 0;
  }

  // **Confere TODOS os gabaritos antes de tocar em disco.**
  //
  // A versão anterior conferia dentro do laço, e isso é diferente do que parece:
  // carregar `agendamento-field` custa minutos, então um id errado no gabarito da
  // terceira página só apareceria depois de duas cargas. Erro de digitação tem de
  // custar um segundo, não uma tarde. (Aprendido hoje, do jeito caro.)
  const declaradas = new Set(model.divergencias.map((a) => a.divergencia.id));
  const problemas: string[] = [];
  for (const g of gabaritos) {
    const dash = dashboards.find((d) => d.id === g.pagina);
    if (!dash) {
      problemas.push(`gabarito aponta para página inexistente: '${g.pagina}'`);
      continue;
    }
    const idsDaPagina = new Set((dash.visuals ?? []).map((v) => v.id));
    for (const c of g.cards ?? []) {
      if (!idsDaPagina.has(c.visual)) {
        problemas.push(
          `${g.pagina}/${c.visual}: este visual não existe na página. A spec pode ter ` +
            `sido regerada — confira o id antes de apagar a linha, o número ditado é caro.`,
        );
      }
      if (c.divergente && !declaradas.has(c.divergente)) {
        problemas.push(
          `${g.pagina}/${c.visual}: 'divergente: ${c.divergente}' não existe em ` +
            `backend/specs/_catalog/divergencias.yaml. Ou a divergência foi removida sem revisar ` +
            `o gabarito, ou o id está errado.`,
        );
      }
    }
  }
  if (problemas.length > 0) {
    // Todos de uma vez: consertar um por execução, cada uma custando uma carga, é o
    // que faz alguém desistir da conferência.
    for (const p of problemas) console.error(p);
    return 1;
  }

  const agora = new Date();
  const resultados: Resultado[] = [];

  for (const g of gabaritos) {
    const dash = dashboards.find((d) => d.id === g.pagina)!;
    const { ev } = await carrega({
      dir: path.join(ROOT, DIRETORIO_PADRAO),
      model,
      dashboards: [dash],
      now: agora,
      precisaFormaCompleta: todaFormaCompleta(model),
    });
    const pagina = calculaPagina(dash, ev, { de: 0, linhas: 1 });
    const porId = new Map(pagina.visuais.map((v) => [v.id, v]));
    const tol = g.tolerancia ?? TOLERANCIA_PADRAO;

    for (const c of g.cards ?? []) {
      const v = porId.get(c.visual);
      const obtido = v ? valorDoCard(v.dados) : null;
      const { veredito, delta } = confere(c, obtido, v?.erro ?? (v ? undefined : 'visual não existe na página'), tol);
      resultados.push({
        pagina: g.pagina, visual: c.visual, rotulo: c.rotulo ?? null,
        esperado: c.powerbi ?? null, obtido, erro: v?.erro, veredito, delta,
      });
    }
  }

  for (const r of resultados) {
    const delta = r.delta === undefined ? '' : ` (${(r.delta * 100).toFixed(2)}%)`;
    const nums = r.veredito === 'nao-calculou'
      ? (r.erro ?? 'sem número')
      : `PBI=${r.esperado ?? '—'} nós=${r.obtido ?? '—'}${delta}`;
    console.log(`[${SIMBOLO[r.veredito]}] ${r.pagina}/${r.visual}  ${r.rotulo ?? ''}  ${nums}`);
  }

  const conta = (v: Veredito): number => resultados.filter((r) => r.veredito === v).length;
  console.log(
    `\n${resultados.length} card(s): ${conta('bate')} batem, ${conta('difere')} diferem, ` +
      `${conta('divergencia-confirmada')} divergem como decidido, ` +
      `${conta('divergencia-nao-aplicada')} deveriam divergir e não divergem, ` +
      `${conta('nao-calculou')} não calcularam, ${conta('sem-gabarito')} sem número ditado.`,
  );

  const ruins = conta('difere') + conta('divergencia-nao-aplicada') + conta('nao-calculou');
  if (conta('sem-gabarito') > 0 && ruins === 0) {
    console.log('\nAinda há card sem número ditado — isto NÃO é paridade provada.');
  }
  return ruins > 0 ? 1 : 0;
}

process.exit(await principal());
