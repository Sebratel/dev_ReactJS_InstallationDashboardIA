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

/** Tira comentário de bloco e, no TSX, o de linha — sem comer `https://`. */
function semComentario(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
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

test('o piso do gráfico não vence a fração ideal em 1440x900', () => {
  // Piso acima da fração ideal empurra a soma para fora, e a tela de duas faixas
  // volta a rolar — foi o que 330px fez por um dia.
  const r = regra('grafico');
  const piso = numero(r, /clamp\((\d+)px/, 'o piso do gráfico');
  const fracao = numero(r, /\*\s*(0?\.\d+)\)/, 'a fração do gráfico');

  // `--h-nav` no `:root` é só o chão: quem manda é a medida que o AppShell publica,
  // 74px com as 14 telas em duas linhas. É esse valor que a conta de referência usa.
  const H_NAV_MEDIDO = 74;
  const cromo = token('h-topbar') + H_NAV_MEDIDO + token('h-filtros') + 34;
  const ideal = (900 - cromo - token('gap')) * fracao;

  assert.ok(
    piso <= ideal,
    'o piso do gráfico (' + piso + 'px) passou da fração ideal em 1440x900 (' +
      ideal.toFixed(1) + 'px): a tela de duas faixas volta a rolar',
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
