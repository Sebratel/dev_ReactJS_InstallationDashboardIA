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
import { cn } from '../../utils/cn.ts';

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
    <div className="flex flex-col gap-[1px]">
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
                  <div key={m.indice} className="pl-[16px]" data-nivel="mes">
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
                      <div
                        className="grid grid-cols-[repeat(7,1fr)] gap-[2px] pt-[3px] pr-0 pb-[5px] pl-[20px]"
                        data-nivel="dias"
                      >
                        {m.dias.map((d) => (
                          <label
                            key={d}
                            title={`${String(d).padStart(2, '0')}/${String(m.indice + 1).padStart(2, '0')}/${a.ano}`}
                            className={cn(
                              'flex cursor-pointer items-center justify-center rounded-[3px] py-[3px] text-[0.66rem] tabular-nums',
                              // Cor CHEIA é fundo, e a letra vem do token do papel: 9,87:1.
                              sel.dias.includes(d)
                                ? 'bg-pbi-primary font-bold text-pbi-sobre-primary'
                                : 'text-pbi-ink hover:bg-pbi-primary-soft',
                            )}
                          >
                            {/* A caixa some, mas continua sendo ela quem carrega o estado
                                para o teclado e o leitor de tela — `display: none` tiraria
                                o controle do foco. */}
                            <input
                              className="absolute m-[-1px] size-px overflow-hidden border-0 p-0 whitespace-nowrap [clip:rect(0_0_0_0)]"
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
