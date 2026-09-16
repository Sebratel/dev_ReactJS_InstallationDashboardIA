// Guardas da CASCA, todos lendo a fonte.
//
// Nenhum destes defeitos quebrava a build, aparecia no console ou derrubava um teste
// — e cada um esteve na tela por dias. É o que estes testes existem para pegar: as
// regras que vivem em DOIS arquivos e se desencontram em silêncio.
//
// Todos analisam o código SEM COMENTÁRIO. Sem isso o teste lê a própria explicação:
// o comentário que conta por que `.barra-lateral` saiu contém `.barra-lateral`, e a
// busca por restos acha o texto que documenta a remoção.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const web = path.resolve(import.meta.dirname, '..');
const le = (...p: string[]) => fs.readFileSync(path.join(web, ...p), 'utf8');

/**
 * Tira comentário de bloco e, no TSX, o de linha — sem comer `https://`.
 *
 * **A ORDEM DAS DUAS TROCAS NÃO É INDIFERENTE, e inverter foi um defeito real**
 * (achado em 16/09/2026, ao ligar o login por Firebase). Tirar o bloco primeiro
 * faz um `/*` que mora DENTRO de um comentário de linha abrir um bloco de
 * mentira — e ele só fecha no próximo `*` seguido de `/` do arquivo, comendo
 * tudo no meio.
 *
 * No `Login.tsx` isso acontecia assim: o cabeçalho tem a frase *"quando `App.tsx`
 * detecta 401 em qualquer chamada a /api/(asterisco)"*. Aquele `/` + `*` abria o
 * bloco falso; o `*` + `/` que o fechava era o fim do JSDoc de
 * `carregaScriptGis`, trinta linhas abaixo — e no meio iam embora TODOS OS
 * IMPORTS do arquivo. Efeito prático: o teste de módulo órfão aqui embaixo não
 * enxergava mais nada que o `Login.tsx` importasse, e acusava de órfão um
 * módulo perfeitamente ligado.
 *
 * Tirando o comentário de LINHA primeiro, o `/api/*` some junto com a linha que
 * o contém, e o que sobra para o segundo passo é só bloco de verdade.
 */
function semComentario(fonte: string): string {
  return fonte.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const css = semComentario(le('src', 'estilo.css'));
const appShell = semComentario(le('src', 'componentes', 'AppShell.tsx'));

/** Todos os tokens de pixel do CSS, já sem comentário. */
const TOKENS = new Map(
  [...css.matchAll(/--([\w-]+):\s*(\d+)px/g)].map((m) => [m[1]!, Number(m[2])]),
);
function token(nome: string): number {
  const v = TOKENS.get(nome);
  assert.ok(v !== undefined, 'não achei o token `--' + nome + '` no estilo.css');
  return v!;
}

/* ========================================================================== tema */

test('a classe que o store escreve é a MESMA que o CSS estiliza', () => {
  const store = semComentario(le('src', 'store', 'useThemeStore.ts'));

  const classe = (/const CLASSE = '([^']+)'/.exec(store) ??
    /classList\.(?:toggle|add)\(\s*'([^']+)'/.exec(store))?.[1];
  assert.ok(classe, 'o `useThemeStore` não nomeia classe nenhuma');
  assert.match(store, /classList\.(?:toggle|add)\(/, 'a classe existe mas ninguém a aplica');

  assert.ok(
    css.includes('.' + classe + ' {'),
    'o CSS não tem bloco de tokens `.' + classe + '` — o store escreve uma classe que ' +
      'nenhuma regra atende, e o tema fica ligado no JS e desligado na tela',
  );

  const variante = /@custom-variant dark \(([^)]*)/.exec(css);
  assert.ok(variante, 'sumiu o `@custom-variant dark` do estilo.css');
  assert.ok(
    variante![1]!.includes('.' + classe),
    'o `@custom-variant dark` não aponta para `.' + classe + '`: as utilidades `dark:` ' +
      'do Tailwind não acompanhariam o bloco de tokens',
  );
});

test('todo estado que persiste tem botão que o desliga', () => {
  // Persistir no localStorage sem controle visível TRANCA o usuário: ele recarrega e
  // o estado continua lá. Os dois já estiveram órfãos ao mesmo tempo.
  const casos = [
    { arquivo: ['store', 'useThemeStore.ts'], gatilho: 'toggleTheme' },
    { arquivo: ['modo.tsx'], gatilho: 'alterna' },
  ];
  for (const { arquivo, gatilho } of casos) {
    const nome = arquivo.join('/');
    assert.match(
      le('src', ...arquivo),
      /localStorage\.setItem/,
      nome + ' deveria persistir — se deixou de persistir, revise este teste',
    );
    assert.ok(
      appShell.includes('onClick={' + gatilho + '}'),
      'nenhum botão do AppShell chama `' + gatilho + '`: o estado de ' + nome +
        ' grava no localStorage e sobrevive ao F5, então sem botão não há como sair dele',
    );
  }
});

/* ====================================================================== a conta */

const REGRA = {
  grafico: /\.v-grafico[^{]*\{([^}]*)\}/,
  tabela: /\.v-tabela[^{]*\{([^}]*)\}/,
};

function regra(qual: keyof typeof REGRA): string {
  const m = REGRA[qual].exec(css);
  assert.ok(m, 'não achei a regra de altura de `' + qual + '` no estilo.css');
  return m![1]!;
}

/**
 * O cromo REAL, medido no navegador em 27/08/2026 e igual nas três resoluções de
 * referência: topo 52 + nav 74 + filtros 71 + (rodapé 32 + padding da área 28) = 257.
 *
 * `--h-nav` e `--h-filtros` no `:root` são só o CHÃO — a tela mede as duas faixas e
 * reescreve os tokens (`altura-medida.ts`). Por isso a conta de referência usa as
 * medidas, e não o que está escrito no CSS: usar o CSS aqui foi o que fez a derivação
 * do piso sair errada duas vezes.
 */
const H_NAV_MEDIDO = 74;
const H_FILTROS_MEDIDO = 71;
const cromo = () => token('h-topbar') + H_NAV_MEDIDO + H_FILTROS_MEDIDO + 60;
const utilEm = (vh: number) => vh - cromo();

function numero(texto: string, re: RegExp, oque: string): number {
  const m = re.exec(texto);
  assert.ok(m, 'não consegui ler ' + oque);
  return Number(m![1]);
}

test('as duas frações somam 1 — duas faixas são uma tela', () => {
  const fracao = (q: keyof typeof REGRA) =>
    numero(regra(q), /\*\s*(0?\.\d+)\)/, 'a fração de ' + q);
  assert.equal(fracao('grafico') + fracao('tabela'), 1, 'gráfico + tabela têm de dar 1');
});

/**
 * As duas faixas cabem na resolução de referência ALTA — e a fronteira é sabida.
 *
 * Duas regras disputam a altura do gráfico: a FRAÇÃO, que faz duas faixas darem uma
 * tela exata, e o PISO, que diz onde o visual deixa de comunicar. O piso vence em
 * tela baixa, e aí a página rola de propósito.
 *
 * O que este teste guarda é o outro lado: em 1920x1080 a fração TEM de vencer. Se um
 * piso subir acima dela, a tela que deveria caber passa a rolar — e foi assim que
 * 330px entrou por um dia. Medido no navegador em 27/08/2026: 370 + 443 + 10 = 823 =
 * `--util`, ao pixel.
 */
test('o piso do gráfico não vence a fração ideal em 1920x1080', () => {
  const r = regra('grafico');
  const piso = numero(r, /clamp\((\d+)px/, 'o piso do gráfico');
  const fracao = numero(r, /\*\s*(0?\.\d+)\)/, 'a fração do gráfico');
  const ideal = (utilEm(1080) - token('gap')) * fracao;

  assert.ok(
    piso <= ideal,
    'o piso do gráfico (' + piso + 'px) passou da fração ideal em 1920x1080 (' +
      ideal.toFixed(1) + 'px): a tela que deveria caber volta a rolar',
  );
});

/**
 * E a fronteira abaixo da qual o piso vence continua onde a documentação diz.
 *
 * Não é um limite a evitar — é um número que o `DESIGN-SYSTEM.md` §3 publica, e que
 * decide em quais monitores a tela de duas faixas rola. Se ele se mover sem o
 * documento se mover junto, é o começo do problema que a seção 0 daquele arquivo
 * descreve.
 *
 * A faixa era 900–1000 (~950px). Em 28/08/2026 o piso do gráfico caiu de 309 para
 * 273px e a fronteira foi para 867px — `DESIGN-SYSTEM.md` §3 foi remedido junto.
 */
test('a fronteira em que o piso passa a vencer fica em ~867px de janela', () => {
  const r = regra('grafico');
  const piso = numero(r, /clamp\((\d+)px/, 'o piso do gráfico');
  const fracao = numero(r, /\*\s*(0?\.\d+)\)/, 'a fração do gráfico');
  // `(util - gap) * fracao = piso`  ->  util  ->  soma o cromo de volta.
  const vh = Math.ceil(piso / fracao + token('gap')) + cromo();

  assert.ok(
    vh >= 820 && vh <= 920,
    'a fronteira foi para ' + vh + 'px de altura de janela; o DESIGN-SYSTEM §3 diz ' +
      '~867. Mova o documento junto, ou o próximo a ler acredita no número velho',
  );
});

/* ================================================================ o que sobrou */

test('nenhuma imagem aponta para arquivo que não é servido', () => {
  // `<img src="/assets/logo-sebratel-circular.png">` deu 404 em toda carga por dias:
  // não quebra build, não vira erro de JS, só um ícone quebrado ao lado da marca.
  const publico = path.join(web, 'public');
  const dir = path.join(web, 'src', 'componentes');
  for (const arq of fs.readdirSync(dir)) {
    if (!arq.endsWith('.tsx')) continue;
    const fonte = semComentario(fs.readFileSync(path.join(dir, arq), 'utf8'));
    for (const m of fonte.matchAll(/src="(\/[^"]+)"/g)) {
      assert.ok(
        fs.existsSync(path.join(publico, m[1]!)),
        arq + ' pede `' + m[1] + '`, que não existe em apps/web/public/ — 404 na tela',
      );
    }
  }
});

test('a barra lateral não deixou restos', () => {
  // Ela saiu em 27/08/2026. CSS órfão descreve um layout que ninguém pode abrir, e
  // quem lê depois acredita.
  assert.ok(!css.includes('.barra-lateral'), 'sobrou regra de `.barra-lateral` no CSS');
  assert.ok(!css.includes('--sidebar-w'), 'sobrou o token `--sidebar-w`');
  assert.match(css, /\.nav-telas\s*\{/, 'a faixa de navegação `.nav-telas` sumiu do CSS');
});

/* ============================================================== módulo órfão */

/**
 * NENHUM MÓDULO SEM IMPORTADOR.
 *
 * Este é o teste que teria pego, de uma vez, os **quatro** achados mais caros de
 * 27/08/2026 — todos da mesma forma: código bom, escrito, revisado, e desligado.
 *
 *   `HeaderSebratel.tsx` ......... o cabeçalho com os dois interruptores globais.
 *                                  Sem ele, tema e modo conferência ficaram sem botão.
 *   `Capa.tsx` ................... a capa inteira. Enquanto isso a CAPA gerada da spec
 *                                  desenhava dois cartões de indicador num vazio.
 *   `filtros-padrao.ts` .......... o gap nº1 da auditoria de paridade. A tela abria
 *                                  com 35.166 protocolos onde o relatório mostra 3.238.
 *   `SegmentacaoDataHierarquia` .. o único controle possível para a coluna de data.
 *
 * Nenhum deles quebrava build, teste ou console. `docs/PARIDADE-POWERBI.md` chegou a
 * dizer "✅ RESOLVIDO" sobre um módulo que ninguém chamava — porque "resolvido" num
 * documento é uma afirmação sobre o código, e ela some sem avisar.
 *
 * Se este teste falhar, a pergunta não é "como faço ele passar": é **por que aquilo
 * foi escrito**. Ou liga, ou apaga. Manter no meio é a pior das três.
 */
test('nenhum módulo de apps/web/src ficou sem importador', () => {
  const raiz = path.join(web, 'src');

  /**
   * Os arquivos que não têm (e não podem ter) importador por design:
   * `main.tsx` — o ponto de entrada, chamado pelo `index.html`;
   * `vite-env.d.ts` — declaração ambiente do Vite (dá tipo a
   * `import.meta.env`), lida pelo `tsc` via `include`, nunca por um `import`.
   */
  const ENTRADAS = new Set(['main.tsx', 'vite-env.d.ts']);

  const arquivos: string[] = [];
  const anda = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) anda(p);
      else if (/\.tsx?$/.test(e.name)) arquivos.push(p);
    }
  };
  anda(raiz);

  const fontes = new Map(arquivos.map((f) => [f, semComentario(fs.readFileSync(f, 'utf8'))]));
  const orfaos = arquivos.filter((f) => {
    if (ENTRADAS.has(path.basename(f))) return false;
    // O import cita o arquivo COM extensão (`./api.ts`, `../componentes/Capa.tsx`) —
    // é a convenção deste repositório, e o `tsc` a exige.
    const alvo = '/' + path.basename(f);
    for (const [outro, fonte] of fontes) {
      if (outro === f) continue;
      if (fonte.includes(alvo) || fonte.includes("'" + path.basename(f))) return false;
    }
    return true;
  });

  assert.deepEqual(
    orfaos.map((f) => path.relative(raiz, f).split(path.sep).join('/')),
    [],
    'módulo sem nenhum importador: ou liga no App, ou apaga — no meio ele apodrece ' +
      'enquanto a documentação continua dizendo que a funcionalidade existe',
  );
});
