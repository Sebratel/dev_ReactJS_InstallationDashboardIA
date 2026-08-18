// Gráfico moderno e interativo com filtragem cruzada (Cross-Filtering) e Tooltips.

import type { DadosDeGrafico, Valor, VisualCalculado } from '../api.ts';
import { formata, inteiro } from '../formato.ts';
import { Cartao } from './Cartao.tsx';

/** Quantos pontos desenhar. Acima disto a barra fica com 40px e rola na horizontal. */
const MAXIMO_DE_PONTOS = 50;

export function Grafico({
  visual,
  aoFiltrar,
}: {
  visual: VisualCalculado;
  aoFiltrar?: (tabela: string, coluna: string, valor: Valor) => void;
}) {
  const d = visual.dados as DadosDeGrafico;
  const pontos = d.pontos.slice(0, MAXIMO_DE_PONTOS);
  const num = (x: unknown): number => (typeof x === 'number' ? x : 0);

  const maior = Math.max(1, ...pontos.flatMap((p) => p.valores.map((x) => Math.abs(num(x)))));
  const somaTotal = pontos.flatMap((p) => p.valores).reduce<number>((a, b) => a + Math.abs(num(b)), 0);

  const sub = [d.tipo, `${inteiro(d.pontos.length)} pontos`, `${d.series.length} série(s)`];
  if (d.pontos.length > pontos.length) sub.push(`mostrando ${pontos.length}`);

  const clicaItem = (catIndex: number, catValores: Valor[]) => {
    if (!aoFiltrar || !d.chaves || d.chaves.length === 0) return;
    const primeiraChave = d.chaves[catIndex] ?? d.chaves[0];
    if (typeof primeiraChave === 'object' && primeiraChave !== null) {
      const ch = primeiraChave as { table?: string; column?: string; tabela?: string; coluna?: string };
      const t = ch.table ?? ch.tabela;
      const c = ch.column ?? ch.coluna;
      if (t && c && catValores[0] !== undefined) {
        aoFiltrar(t, c, catValores[0]);
      }
    }
  };

  return (
    <Cartao titulo={visual.tipo} sub={sub.join(' · ')} id={visual.id} largo>
      {d.series.length > 1 ? (
        <div className="legenda">
          {d.series.map((s, k) => (
            <span className="chave" key={k}>
              <i className={`ponto s${Math.min(k, 3)}`} />
              <span>
                {s.nome ?? '(sem rótulo)'}
                {s.papel === 'Y2' ? ' · eixo secundário' : ''}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="barras">
        {pontos.map((p, i) => {
          const rot = p.categoria.map((c, j) => formata(c, d.tiposDeChave[j] ?? null).texto).join(' / ');
          const valSomaPonto = p.valores.reduce<number>((a, b) => a + Math.abs(num(b)), 0);
          const pctTotal = somaTotal > 0 ? ((valSomaPonto / somaTotal) * 100).toFixed(1) : '0';

          return (
            <div
              className="barra barra-clicavel"
              key={i}
              onClick={() => clicaItem(0, p.categoria)}
              title={`Clique para filtrar por: ${rot}\nTotal: ${valSomaPonto} (${pctTotal}% do conjunto)`}
            >
              <div className="rot" title={rot}>
                {rot}
              </div>
              <div className="pilha">
                {p.valores.map((valor, k) => {
                  const valNum = Math.abs(num(valor));
                  const pctBarra = (valNum / maior) * 100;
                  return (
                    <div className="trilho" key={k}>
                      <div
                        className={`preenche s${Math.min(k, 3)}`}
                        style={{ width: `${pctBarra}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="n">
                {p.valores.map((valor, k) => (
                  <div key={k} className="valor-item">
                    <span>{formata(valor, d.tiposDeSerie[k] ?? null).texto}</span>
                    <span className="pct-badge">{pctTotal}%</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Cartao>
  );
}
