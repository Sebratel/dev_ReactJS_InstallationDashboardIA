// A árvore Ano > Mês > Dia dentro do diálogo de período (`SegmentacaoDataHierarquia`).
// O que cada clique marca é `utils/hierarquiaData.ts`; aqui é só o desenho.

import {
  clicaAno,
  clicaDia,
  clicaMes,
  MESES_CURTOS,
  type AnoDaArvore,
  type MudancaDeNivel,
  type SelecaoDeData,
} from '../../utils/hierarquiaData.ts';
import { NoDaArvore } from './NoDaArvore.tsx';

export function ArvoreDeDatas(props: {
  arvore: readonly AnoDaArvore[];
  sel: SelecaoDeData;
  /** Os nós abertos: `a2026` para ano, `m2026-6` para mês. */
  expandidos: ReadonlySet<string>;
  aoAlternarNo: (chave: string) => void;
  aoAplicar: (mudancas: MudancaDeNivel[]) => void;
}) {
  const { arvore, sel, expandidos, aoAlternarNo, aoAplicar } = props;
  return (
    <div className="arvore">
      {arvore.map((a) => {
        const anoAberto = expandidos.has(`a${a.ano}`);
        const mesesDoAno = a.meses.filter((m) => sel.meses.includes(m.nome));
        return (
          <div key={a.ano}>
            <NoDaArvore
              aberto={anoAberto}
              temFilhos
              aoExpandir={() => aoAlternarNo(`a${a.ano}`)}
              marcado={sel.anos.includes(a.ano)}
              parcial={!sel.anos.includes(a.ano) && mesesDoAno.length > 0}
              aoMarcar={() => aoAplicar(clicaAno(sel, a.ano))}
              rotulo={String(a.ano)}
              forte
            />
            {anoAberto &&
              a.meses.map((m) => {
                const mesAberto = expandidos.has(`m${a.ano}-${m.indice}`);
                const diasDoMes = m.dias.filter((d) => sel.dias.includes(d));
                return (
                  <div key={m.indice} className="arvore-nivel">
                    <NoDaArvore
                      aberto={mesAberto}
                      temFilhos
                      aoExpandir={() => aoAlternarNo(`m${a.ano}-${m.indice}`)}
                      marcado={sel.meses.includes(m.nome)}
                      parcial={!sel.meses.includes(m.nome) && diasDoMes.length > 0}
                      aoMarcar={() => aoAplicar(clicaMes(sel, a.ano, m.nome))}
                      rotulo={MESES_CURTOS[m.indice]!}
                    />
                    {mesAberto && (
                      <div className="arvore-dias">
                        {m.dias.map((d) => (
                          <label
                            key={d}
                            title={`${String(d).padStart(2, '0')}/${String(m.indice + 1).padStart(2, '0')}/${a.ano}`}
                            className={`arvore-dia${sel.dias.includes(d) ? ' marcado' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={sel.dias.includes(d)}
                              onChange={() => aoAplicar(clicaDia(sel, a.ano, m.nome, d))}
                            />
                            {d}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
