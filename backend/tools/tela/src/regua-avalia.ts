// A conta da régua de estilo (`regua.ts`): compara duas medições do mesmo roteiro e diz
// que elemento mudou de estilo computado, e em que propriedade. Puro, sem navegador.
//
// O elemento é identificado pela POSIÇÃO na árvore (`body/div0/main1/...`), não pela
// classe: a refatoração que a régua confere troca classe de propósito.

/** [caminho, tag.classes, estilo, ::before, ::after] — estilos como hash em `estilos`. */
export type Linha = [string, string, string, string, string];

export interface Medicao {
  linhas: Linha[];
  /** [caminho, estilo] da subárvore de cada elemento clicável com `:hover` forçado. */
  hover: [string, string][];
}

export interface Diferenca {
  n: number;
  props: Set<string>;
  onde: Set<string>;
}

export interface Comparacao {
  elementos: number;
  iguais: number;
  /** Por "classe antes → classe depois", para agrupar o mesmo componente. */
  diferencas: Map<string, Diferenca>;
  estrutura: string[];
}

export function propriedades(estilo: string): Map<string, string> {
  const m = new Map<string, string>();
  if (!estilo) return m;
  for (const p of estilo.split(';')) {
    const i = p.indexOf(':');
    m.set(p.slice(0, i), p.slice(i + 1));
  }
  return m;
}

/**
 * Equivalências conhecidas, que dão o mesmo desenho com outro valor computado:
 * `rounded-full` é raio "infinito" (`3.35544e+07px`), e o `999px` de antes dava a mesma
 * pílula em qualquer elemento mais baixo que 999px.
 */
function equivalente(prop: string, a: string | undefined, b: string | undefined): boolean {
  return /radius$/.test(prop) && a === '999px' && /e\+\d+px$/.test(b ?? '');
}

/** As propriedades que diferem entre dois estilos; com `valores`, "prop: a → b". */
export function difereEm(a: string, b: string, valores = false): string[] {
  if (a === b) return [];
  const pa = propriedades(a);
  const pb = propriedades(b);
  const out: string[] = [];
  // `background: transparent` (atalho) e `bg-transparent` (só a cor) deixam posições de
  // fundo diferentes; sem imagem de fundo dos dois lados, a posição não desenha nada.
  const semImagem = pa.get('background-image') === 'none' && pb.get('background-image') === 'none';
  for (const k of new Set([...pa.keys(), ...pb.keys()])) {
    const x = pa.get(k);
    const y = pb.get(k);
    if (x === y || equivalente(k, x, y)) continue;
    if (semImagem && k.startsWith('background-position')) continue;
    out.push(valores ? `${k}: ${x} → ${y}` : k);
  }
  return out;
}

export function novaComparacao(): Comparacao {
  return { elementos: 0, iguais: 0, diferencas: new Map(), estrutura: [] };
}

function anota(c: Comparacao, chave: string, props: string[], onde: string): void {
  const d = c.diferencas.get(chave) ?? { n: 0, props: new Set(), onde: new Set() };
  d.n++;
  props.forEach((p) => d.props.add(p));
  d.onde.add(onde);
  c.diferencas.set(chave, d);
}

/** Acumula em `c` a comparação de uma medição (`nome`) antes (`a`) e depois (`b`). */
export function comparaMedicao(
  c: Comparacao,
  nome: string,
  a: Medicao,
  b: Medicao,
  estilosA: Record<string, string>,
  estilosB: Record<string, string>,
  valores = false,
): void {
  const est = (e: Record<string, string>, h: string) => (h ? (e[h] ?? '') : '');
  const porCaminho = new Map(b.linhas.map((l) => [l[0], l]));
  const caminhosA = new Set(a.linhas.map((l) => l[0]));
  const soA = a.linhas.filter((l) => !porCaminho.has(l[0])).length;
  const soB = b.linhas.filter((l) => !caminhosA.has(l[0])).length;
  if (soA || soB) c.estrutura.push(`${nome}: ${soA} elementos só antes, ${soB} só depois`);

  for (const la of a.linhas) {
    const lb = porCaminho.get(la[0]);
    if (!lb) continue;
    c.elementos++;
    const props: string[] = [];
    for (const [i, rotulo] of [
      [2, ''],
      [3, '::before'],
      [4, '::after'],
    ] as const) {
      for (const p of difereEm(est(estilosA, la[i]), est(estilosB, lb[i]), valores))
        props.push(rotulo + p);
    }
    if (props.length) anota(c, `${la[1]} → ${lb[1]}`, props, nome);
    else c.iguais++;
  }

  // O hover registra a SUBÁRVORE de cada elemento em hover, então o mesmo caminho aparece
  // várias vezes, em estados diferentes (a célula sob a linha em hover, a célula em hover).
  // Casar por caminho num mapa cruza estados; compara-se par a par, na ordem.
  if (a.hover.length !== b.hover.length)
    c.estrutura.push(`${nome}: ${a.hover.length} registros de hover antes, ${b.hover.length} depois`);
  const rotulo = new Map(b.linhas.map((l) => [l[0], l[1]]));
  const rotuloA = new Map(a.linhas.map((l) => [l[0], l[1]]));
  for (let i = 0; i < Math.min(a.hover.length, b.hover.length); i++) {
    const [ca, ha] = a.hover[i]!;
    const [cb, hb] = b.hover[i]!;
    if (ca !== cb) {
      c.estrutura.push(`${nome}: o hover ${i} caiu em ${ca} antes e em ${cb} depois`);
      break;
    }
    const props = difereEm(est(estilosA, ha), est(estilosB, hb), valores);
    if (props.length) anota(c, `:hover ${rotuloA.get(ca)} → ${rotulo.get(cb)}`, props, nome);
  }
}

interface PaginaGravada {
  visuais: { id: string; sobDemanda?: string[] }[];
}
interface LayoutGravado {
  faixas: { colunas: { visual: string }[] }[];
}

/**
 * A resposta de abertura recortada para forçar os estados que a abertura de hoje não
 * mostra (ela pede todos os visuais de uma vez): os visuais da segunda metade das faixas
 * saem — viram `VisualNaDobra`, que se busca ao rolar — e o primeiro da primeira faixa
 * vira sob demanda (`SobDemanda`, que se busca ao montar).
 */
export function recortaAbertura<P extends PaginaGravada>(pagina: P, layout: LayoutGravado): P {
  const fora = new Set(
    layout.faixas.slice(Math.ceil(layout.faixas.length / 2)).flatMap((f) => f.colunas.map((c) => c.visual)),
  );
  const sobDemanda = layout.faixas[0]?.colunas[0]?.visual;
  return {
    ...pagina,
    visuais: pagina.visuais
      .filter((v) => !fora.has(v.id))
      .map((v) => (v.id === sobDemanda ? { ...v, sobDemanda: ['TABELA DA RÉGUA'] } : v)),
  };
}
