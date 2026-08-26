import { useEffect, useRef, useState } from 'react';
import { pegaValores, type FiltroDaTela, type Valor } from '../api.ts';
import {
  clicaAno,
  clicaDia,
  clicaMes,
  limpaTudo,
  montaArvore,
  resumoDeData,
  selecaoDeData,
  MESES_CURTOS,
  type AnoDaArvore,
  type MudancaDeNivel,
} from '../hierarquia-data.ts';

/** Teto pedido à API: dois anos de datas distintas passam do padrão de 500. */
const TETO_DE_DATAS = 5000;

/**
 * O filtro de data em árvore — Ano > Mês > Dia — no lugar de dois seletores planos.
 *
 * O relatório original filtra data pela hierarquia, e é assim que a operação pensa
 * ("janeiro de 2026", não "ano 2026" e "mês janeiro" em dois controles separados).
 * Com dois seletores planos, escolher o ano não muda a lista de meses e nada na tela
 * diz que março de 2025 não existe na base.
 *
 * A decisão de o que cada clique marca mora em `hierarquia-data.ts`, testada sem DOM.
 */
export function SegmentacaoDataHierarquia(props: {
  pagina: string;
  tabela: string;
  coluna: string;
  rotulo: string;
  filtros: readonly FiltroDaTela[];
  aoMudar: (nivel: string, valores: Valor[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [arvore, setArvore] = useState<AnoDaArvore[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cortado, setCortado] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const sel = selecaoDeData(props.filtros, props.tabela, props.coluna);
  const marcado = sel.anos.length + sel.meses.length + sel.dias.length;

  async function abre(): Promise<void> {
    const vai = !aberto;
    setAberto(vai);
    if (!vai || arvore !== null || carregando) return;
    setCarregando(true);
    setErro(null);
    try {
      // Sem `nivel`: a árvore precisa das datas cruas para saber **quais** meses
      // existem em cada ano. Pedir nível por nível traria três listas soltas, e o
      // cruzamento delas ofereceria mês que aquele ano não tem.
      const r = await pegaValores(props.pagina, props.tabela, props.coluna, undefined, TETO_DE_DATAS);
      const montada = montaArvore(r.valores);
      setArvore(montada);
      setCortado(r.cortado);
      // Um ano só: já aberto, senão o primeiro clique é sempre no mesmo lugar.
      if (montada.length === 1) setExpandidos(new Set([`a${montada[0]!.ano}`]));
      else setExpandidos(new Set(sel.anos.map((a) => `a${a}`)));
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregando(false);
    }
  }

  function aplica(mudancas: MudancaDeNivel[]): void {
    for (const m of mudancas) props.aoMudar(m.nivel, m.valores);
  }

  function alternaNo(chave: string): void {
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  return (
    <div className="relative min-w-[190px]">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1">
        {props.rotulo}
      </span>
      <button
        className={`w-full text-xs font-semibold py-1.5 px-3 rounded-lg border transition-all flex items-center justify-between gap-2 cursor-pointer bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 ${
          marcado
            ? 'border-brand-yellow ring-2 ring-brand-yellow/30 font-bold'
            : 'border-slate-200 dark:border-zinc-700 hover:border-slate-300 dark:hover:border-zinc-600'
        }`}
        onClick={abre}
        aria-expanded={aberto}
      >
        <span className="truncate">{resumoDeData(sel)}</span>
        <span className="text-[10px] opacity-60">▾</span>
      </button>

      {aberto && (
        <div className="absolute z-50 top-[calc(100%+6px)] left-0 w-[260px] max-w-[90vw] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xl p-3 flex flex-col gap-2">
          {carregando && (
            <span className="text-xs text-slate-500 dark:text-zinc-400 italic">Carregando datas...</span>
          )}
          {erro && <div className="text-xs text-red-500 font-semibold">{erro}</div>}

          {arvore && (
            <>
              <div className="max-h-72 overflow-y-auto flex flex-col gap-0.5 pr-1">
                {arvore.map((a) => {
                  const anoAberto = expandidos.has(`a${a.ano}`);
                  const mesesDoAno = a.meses.filter((m) => sel.meses.includes(m.nome));
                  return (
                    <div key={a.ano} className="flex flex-col">
                      <No
                        aberto={anoAberto}
                        temFilhos
                        aoExpandir={() => alternaNo(`a${a.ano}`)}
                        marcado={sel.anos.includes(a.ano)}
                        parcial={!sel.anos.includes(a.ano) && mesesDoAno.length > 0}
                        aoMarcar={() => aplica(clicaAno(sel, a.ano))}
                        rotulo={String(a.ano)}
                        forte
                      />
                      {anoAberto &&
                        a.meses.map((m) => {
                          const mesAberto = expandidos.has(`m${a.ano}-${m.indice}`);
                          const diasDoMes = m.dias.filter((d) => sel.dias.includes(d));
                          return (
                            <div key={m.indice} className="flex flex-col pl-4">
                              <No
                                aberto={mesAberto}
                                temFilhos
                                aoExpandir={() => alternaNo(`m${a.ano}-${m.indice}`)}
                                marcado={sel.meses.includes(m.nome)}
                                parcial={!sel.meses.includes(m.nome) && diasDoMes.length > 0}
                                aoMarcar={() => aplica(clicaMes(sel, a.ano, m.nome))}
                                rotulo={MESES_CURTOS[m.indice]!}
                              />
                              {mesAberto && (
                                <div className="pl-4 grid grid-cols-6 gap-0.5 py-0.5">
                                  {m.dias.map((d) => (
                                    <label
                                      key={d}
                                      title={`${String(d).padStart(2, '0')}/${String(m.indice + 1).padStart(2, '0')}/${String(a.ano % 100).padStart(2, '0')}`}
                                      className={`text-[10px] text-center py-0.5 rounded cursor-pointer transition-colors ${
                                        sel.dias.includes(d)
                                          ? 'bg-brand-yellow text-brand-dark font-bold'
                                          : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="sr-only"
                                        checked={sel.dias.includes(d)}
                                        onChange={() => aplica(clicaDia(sel, a.ano, m.nome, d))}
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
                {arvore.length === 0 && (
                  <span className="text-xs text-slate-400 italic p-2">
                    Nenhuma data nesta coluna.
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800 text-[11px] text-slate-500 dark:text-zinc-400">
                <span>
                  {arvore.length} {arvore.length === 1 ? 'ano' : 'anos'}
                  {/* O corte é dito: uma árvore truncada em silêncio faria concluir
                      que o mês que falta não existe na base. */}
                  {cortado ? ' · lista cortada no teto' : ''}
                </span>
                <button
                  className="px-2 py-1 text-[11px] font-semibold bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 text-slate-700 dark:text-zinc-300 rounded-md cursor-pointer transition-colors"
                  onClick={() => aplica(limpaTudo())}
                  disabled={marcado === 0}
                >
                  Limpar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Uma linha da árvore: seta de expandir, caixa de marcar e rótulo. */
function No(props: {
  aberto: boolean;
  temFilhos: boolean;
  aoExpandir: () => void;
  marcado: boolean;
  /** Filho marcado sem o pai — a caixa fica no estado indeterminado do HTML. */
  parcial: boolean;
  aoMarcar: () => void;
  rotulo: string;
  forte?: boolean;
}) {
  const caixa = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (caixa.current) caixa.current.indeterminate = props.parcial && !props.marcado;
  }, [props.parcial, props.marcado]);

  return (
    <div className="flex items-center gap-1 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-800/80 transition-colors">
      <button
        className="w-4 text-[9px] text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
        onClick={props.aoExpandir}
        aria-label={props.aberto ? 'Recolher' : 'Expandir'}
        aria-expanded={props.aberto}
      >
        {props.temFilhos ? (props.aberto ? '▾' : '▸') : ''}
      </button>
      <label
        className={`flex-1 flex items-center gap-2 px-1 py-1 text-xs cursor-pointer ${
          props.forte
            ? 'font-bold text-slate-800 dark:text-zinc-100'
            : 'text-slate-700 dark:text-zinc-200'
        }`}
      >
        <input
          ref={caixa}
          type="checkbox"
          className="rounded border-slate-300 text-brand-yellow focus:ring-brand-yellow"
          checked={props.marcado}
          onChange={props.aoMarcar}
        />
        <span>{props.rotulo}</span>
      </label>
    </div>
  );
}
