import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
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

/**
 * O filtro de data em árvore — Ano > Mês > Dia — no lugar de dois seletores planos.
 *
 * O relatório original filtra data pela hierarquia, e é assim que a operação pensa
 * ("janeiro de 2026", não "ano 2026" e "mês janeiro" em dois controles separados).
 * Com dois seletores planos, escolher o ano não muda a lista de meses e nada na tela
 * diz que março de 2025 não existe na base.
 *
 * A decisão de o que cada clique marca mora em `hierarquia-data.ts`, testada sem DOM.
 *
 * **É o único controle possível para esta coluna.** O motor marca a segmentação de
 * `DATA INSTALADO` como `naoFiltra`, e a razão está na própria spec: *"segmentação de
 * hierarquia com 3 níveis ativos (Ano/Mês/Dia). Ela é um controle de drill, e a
 * escolha ali é um caminho, não um conjunto de valores de um nível"*. Sem esta
 * árvore a barra desenha aquele controle morto — ele diz "todos" com a página
 * filtrada — e é isso que ele substitui.
 *
 * **Esteve morto de `0aae15c` (26/08) até 27/08/2026**: existia, tinha
 * `hierarquia-data.ts` testado ao lado, e nunca foi montado. Nesse tempo ficou com
 * três problemas de forma, todos corrigidos aqui:
 *   1. `brand-yellow` e `brand-dark` — cores que não existem no `estilo.css`, logo
 *      seleção sem destaque nenhum;
 *   2. `slate-*` / `zinc-*` do Tailwind em vez dos tokens de papel, o que fazia o
 *      controle não parecer da mesma barra que os outros dez;
 *   3. **popover `position: absolute` dentro da barra sticky.** O padrão desta casa
 *      é explícito: gatilho dentro de contêiner com `overflow` pede diálogo com
 *      portal no `body`, senão a borda do contêiner recorta o painel. É o que o
 *      `Segmentacao.tsx` já faz, e agora este também.
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
      const r = await pegaValores(props.pagina, props.tabela, props.coluna, undefined);
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
    <div className="filtro">
      <span className="filtro-rotulo">{props.rotulo}</span>
      <button
        className={`filtro-botao${marcado ? ' marcado' : ''}`}
        onClick={abre}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title={marcado ? resumoDeData(sel) : `Escolher ${props.rotulo}`}
      >
        <span className="filtro-resumo">{resumoDeData(sel)}</span>
        {marcado > 0 && <span className="filtro-conta">{marcado}</span>}
        <ChevronDown size={12} />
      </button>

      {aberto &&
        createPortal(
          <div
            className="fundo-dialogo"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) setAberto(false);
            }}
          >
            <div className="dialogo" role="dialog" aria-modal="true" aria-label={props.rotulo}>
              <div className="dialogo-topo">
                <h3>{props.rotulo}</h3>
                <button className="btn-icone" onClick={() => setAberto(false)} title="Fechar">
                  <X size={13} />
                </button>
              </div>

              <div className="dialogo-corpo">
                {/* Os três estados, também aqui: uma árvore em branco sem explicação
                    parece "não há datas" quando a busca ainda nem voltou. */}
                {carregando && <span className="filtro-nota">Carregando datas…</span>}
                {erro && <div className="erro">{erro}</div>}

                {arvore && arvore.length === 0 && (
                  <span className="filtro-nota">Nenhuma data nesta coluna.</span>
                )}

                {arvore && arvore.length > 0 && (
                  <div className="arvore">
                    {arvore.map((a) => {
                      const anoAberto = expandidos.has(`a${a.ano}`);
                      const mesesDoAno = a.meses.filter((m) => sel.meses.includes(m.nome));
                      return (
                        <div key={a.ano}>
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
                                <div key={m.indice} className="arvore-nivel">
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
                  </div>
                )}
              </div>

              <div className="dialogo-rodape">
                <span className="filtro-nota">
                  {arvore?.length ?? 0} {(arvore?.length ?? 0) === 1 ? 'ano' : 'anos'}
                  {/* O corte é dito: uma árvore truncada em silêncio faria concluir
                      que o mês que falta não existe na base. */}
                  {cortado ? ' · lista cortada no teto' : ''}
                </span>
                <div className="filtro-botoes-acao">
                  <button
                    className="secundario"
                    onClick={() => aplica(limpaTudo())}
                    disabled={marcado === 0}
                  >
                    Limpar
                  </button>
                  <button className="primario" onClick={() => setAberto(false)}>
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
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
    <div className="arvore-linha">
      <button
        className="arvore-seta"
        onClick={props.aoExpandir}
        aria-label={props.aberto ? 'Recolher' : 'Expandir'}
        aria-expanded={props.aberto}
      >
        {props.temFilhos ? (props.aberto ? '▾' : '▸') : ''}
      </button>
      <label className={`arvore-rotulo${props.forte ? ' forte' : ''}`}>
        <input ref={caixa} type="checkbox" checked={props.marcado} onChange={props.aoMarcar} />
        <span>{props.rotulo}</span>
      </label>
    </div>
  );
}
