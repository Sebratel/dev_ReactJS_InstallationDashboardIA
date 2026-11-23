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
import { juntarClasses } from '../../utils/cn.ts';

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
      {arvore.map((alvo) => {
        const anoAberto = expandidos.has(`a${alvo.ano}`);
        const mesesDoAno = alvo.meses.filter((mes) => sel.meses.includes(mes.nome));
        return (
          <div key={alvo.ano}>
            <NoDaArvore
              aberto={anoAberto}
              temFilhos
              aoExpandir={() => aoAlternarNo(`a${alvo.ano}`)}
              marcado={sel.anos.includes(alvo.ano)}
              parcial={!sel.anos.includes(alvo.ano) && mesesDoAno.length > 0}
              aoMarcar={() => aoAplicar(clicaAno(sel, alvo.ano))}
              rotulo={String(alvo.ano)}
              forte
            />
            {anoAberto &&
              alvo.meses.map((mes) => {
                const mesAberto = expandidos.has(`m${alvo.ano}-${mes.indice}`);
                const diasDoMes = mes.dias.filter((dia) => sel.dias.includes(dia));
                return (
                  <div key={mes.indice} className="pl-[16px]" data-nivel="mes">
                    <NoDaArvore
                      aberto={mesAberto}
                      temFilhos
                      aoExpandir={() => aoAlternarNo(`m${alvo.ano}-${mes.indice}`)}
                      marcado={sel.meses.includes(mes.nome)}
                      parcial={!sel.meses.includes(mes.nome) && diasDoMes.length > 0}
                      aoMarcar={() => aoAplicar(clicaMes(sel, alvo.ano, mes.nome))}
                      rotulo={MESES_CURTOS[mes.indice]!}
                    />
                    {mesAberto && (
                      <div
                        className="grid grid-cols-[repeat(7,1fr)] gap-[2px] pt-[3px] pr-0 pb-[5px] pl-[20px]"
                        data-nivel="dias"
                      >
                        {mes.dias.map((dia) => (
                          <label
                            key={dia}
                            title={`${String(dia).padStart(2, '0')}/${String(mes.indice + 1).padStart(2, '0')}/${alvo.ano}`}
                            className={juntarClasses(
                              'flex cursor-pointer items-center justify-center rounded-[3px] py-[3px] text-[0.66rem] tabular-nums',
                              // Cor CHEIA é fundo, e a letra vem do token do papel: 9,87:1.
                              sel.dias.includes(dia)
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
                              checked={sel.dias.includes(dia)}
                              onChange={() => aoAplicar(clicaDia(sel, alvo.ano, mes.nome, dia))}
                            />
                            {dia}
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
