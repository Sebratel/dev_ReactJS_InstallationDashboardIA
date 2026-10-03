// Contraste WCAG entre texto e fundo — puro, sem navegador. Quem lê a cor computada na
// página real é `varre.ts`; este arquivo só faz a conta e diz o que é a lista de pares a
// checar, para não inventar hexadecimal solto (regra do CLAUDE.md, §Design System).
//
// A lista vem de grep em `estilo.css` cruzado com os papéis que o CLAUDE.md já
// documenta com hex e razão medidos — cada linha abaixo corresponde a uma regra real do
// CSS (`.cartao-topo`, `.selo`, `.selo.ruim`, `.selo.neutro`, `body`, `.marca-nome`,
// `.btn-icone`, `.marca-sub` etc.), não a um par hipotético.

export const PISO_AA = 4.5;

export interface ParDeContraste {
  rotulo: string;
  fg: string;
  bg: string;
}

/** Nomes de variável CSS (sem `--`) — `varre.ts` resolve o valor computado na página. */
export const PARES: readonly ParDeContraste[] = [
  { rotulo: 'cabeçalho do cartão (texto sobre a primária)', fg: 'pbi-sobre-primary', bg: 'pbi-primary' },
  { rotulo: 'subtítulo sobre a primária', fg: 'pbi-sobre-primary-fraco', bg: 'pbi-primary' },
  { rotulo: 'a primária como letra, sobre o fundo', fg: 'pbi-primary-texto', bg: 'fundo' },
  { rotulo: 'a primária como letra, sobre a superfície', fg: 'pbi-primary-texto', bg: 'superficie' },
  { rotulo: 'dourado como letra, sobre o fundo', fg: 'pbi-gold-600', bg: 'fundo' },
  { rotulo: 'dourado como letra, sobre o aviso (selo/badge)', fg: 'pbi-gold-600', bg: 'pbi-aviso-bg' },
  { rotulo: 'verde como letra, sobre o ok (selo/badge)', fg: 'pbi-green-texto', bg: 'pbi-ok-bg' },
  { rotulo: 'vermelho como letra, sobre o erro (selo/badge)', fg: 'pbi-critico-texto', bg: 'pbi-erro-bg' },
  { rotulo: 'texto padrão sobre o fundo', fg: 'texto', bg: 'fundo' },
  { rotulo: 'texto padrão sobre a superfície', fg: 'texto', bg: 'superficie' },
  { rotulo: 'texto secundário sobre a superfície', fg: 'muted', bg: 'superficie' },
  { rotulo: 'texto secundário sobre o fundo', fg: 'muted', bg: 'fundo' },
];

interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Aceita `#rrggbb`/`#rgb` (como nos testes), `rgb(...)`/`rgba(...)` e `color(srgb r g b)`
 * (0–1 por canal). O terceiro formato é o que o Chromium devolve para qualquer variável
 * que passe por `color-mix()` no CSS — `--pbi-ok-bg`/`--pbi-erro-bg`/`--pbi-aviso-bg` em
 * `estilo.css` são assim — porque o resultado da mistura não é exatamente representável
 * em `rgb()` de 8 bits, e o navegador prefere preservar a precisão a arredondar em silêncio.
 */
export function analisaCor(cor: string): RGB {
  const hex = cor.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = cor.trim().match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) {
    return { r: Number.parseFloat(rgb[1]!), g: Number.parseFloat(rgb[2]!), b: Number.parseFloat(rgb[3]!) };
  }
  const srgb = cor.trim().match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (srgb) {
    return {
      r: Number.parseFloat(srgb[1]!) * 255,
      g: Number.parseFloat(srgb[2]!) * 255,
      b: Number.parseFloat(srgb[3]!) * 255,
    };
  }
  throw new Error(`cor '${cor}' não é hex, rgb() nem color(srgb ...) — não dá para calcular luminância.`);
}

/** Luminância relativa WCAG (0 = preto, 1 = branco). */
export function luminancia(cor: string): number {
  const { r, g, b } = analisaCor(cor);
  const canal = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razão de contraste WCAG entre duas cores — sempre ≥ 1. */
export function razaoDeContraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const clara = Math.max(la, lb);
  const escura = Math.min(la, lb);
  return (clara + 0.05) / (escura + 0.05);
}

export interface ParResolvido extends ParDeContraste {
  corFg: string;
  corBg: string;
}

export interface ProblemaDeContraste {
  rotulo: string;
  razao: number;
}

/** Recebe os pares já com a cor computada (lida na página real) e aponta quem fica abaixo do piso AA. */
export function avaliaContraste(resolvidos: readonly ParResolvido[]): ProblemaDeContraste[] {
  const problemas: ProblemaDeContraste[] = [];
  for (const p of resolvidos) {
    const razao = razaoDeContraste(p.corFg, p.corBg);
    if (razao < PISO_AA) problemas.push({ rotulo: p.rotulo, razao });
  }
  return problemas;
}
