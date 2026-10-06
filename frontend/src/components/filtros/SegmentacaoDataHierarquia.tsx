import { useEffect, useMemo, useRef, useState } from 'react';
import { useValoresDaSegmentacao } from '../../hooks/useDadosDaTela.ts';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { type FiltroDaTela, type Valor } from '../../services/dashboardService.ts';
import { limpaTudo, montaArvore, resumoDeData, selecaoDeData, type MudancaDeNivel } from '../../utils/hierarquiaData.ts';
import { ArvoreDeDatas } from './ArvoreDeDatas.tsx';

/**
 * O filtro de data em árvore — Ano > Mês > Dia — no lugar de dois seletores planos.
 *
 * O relatório original filtra data pela hierarquia, e é assim que a operação pensa
 * ("janeiro de 2026", não "ano 2026" e "mês janeiro" em dois controles separados).
 * Com dois seletores planos, escolher o ano não muda a lista de meses e nada na tela
 * diz que março de 2025 não existe na base.
 *
 * A decisão de o que cada clique marca mora em `hierarquiaData.ts`, testada sem DOM.
 *
 * **É o único controle possível para esta coluna.** O motor marca a segmentação de
 * `DATA INSTALADO` como `naoFiltra`, e a razão está na própria spec: *"segmentação de
 * hierarquia com 3 níveis ativos (Ano/Mês/Dia). Ela é um controle de drill, e a
 * escolha ali é um caminho, não um conjunto de valores de um nível"*. Sem esta
 * árvore a barra desenha aquele controle morto — ele diz "todos" com a página
 * filtrada — e é isso que ele substitui.
 *
 * **Esteve morto de `0aae15c` (26/08) até 27/08/2026**: existia, tinha
 * `hierarquiaData.ts` testado ao lado, e nunca foi montado. Nesse tempo ficou com
 * três problemas de forma, todos corrigidos aqui:
 *   1. `brand-yellow` e `brand-dark` — cores que não existem no `estilo.css`, logo
 *      seleção sem destaque nenhum;
 *   2. `slate-*` / `zinc-*` do Tailwind em vez dos tokens de papel, o que fazia o
 *      controle não parecer da mesma barra que os outros dez;
 *   3. **popover `position: absolute` dentro da barra sticky.** O padrão desta casa
 *      é explícito: gatilho dentro de contêiner com `overflow` pede diálogo com
 *      portal no `body`, senão a borda do contêiner recorta o painel. É o que o
 *      `Segmentacao.tsx` já faz, e agora este também.
 *
 * **Carrega ao montar, não ao clicar** — mesmo motivo e mesma mudança de
 * `Segmentacao.tsx` (09/09/2026): é o primeiro filtro da barra, o mais provável de
 * ser o primeiro clique de todos, e era exatamente aí que a pessoa esperava o fetch.
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
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const { pagina, tabela, coluna } = props;
  // Sem `nivel`: a árvore precisa das datas cruas para saber **quais** meses
  // existem em cada ano. Pedir nível por nível traria três listas soltas, e o
  // cruzamento delas ofereceria mês que aquele ano não tem.
  const { opcoes, cortado, erro } = useValoresDaSegmentacao(pagina, tabela, coluna, null);
  const arvore = useMemo(() => (opcoes === null ? null : montaArvore(opcoes)), [opcoes]);

  const sel = selecaoDeData(props.filtros, props.tabela, props.coluna);
  const marcado = sel.anos.length + sel.meses.length + sel.dias.length;
  const carregando = arvore === null && erro === null;

  // A expansão inicial, uma vez por ÁRVORE (página + coluna): o "Atualizar" traz a lista
  // de novo sem fechar o que a pessoa abriu.
  const arvoreExpandida = useRef('');
  useEffect(() => {
    if (arvore === null) return;
    const chave = [pagina, tabela, coluna].join(' ');
    if (arvoreExpandida.current === chave) return;
    arvoreExpandida.current = chave;
    // Um ano só: já aberto, senão o primeiro clique é sempre no mesmo lugar.
    if (arvore.length === 1) setExpandidos(new Set([`a${arvore[0]!.ano}`]));
    else setExpandidos(new Set(sel.anos.map((a) => `a${a}`)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sel` é só a expansão
    // inicial (a seleção da URL no momento em que a árvore chega); não deve reabrir
    // a árvore a cada mudança de filtro.
  }, [arvore, pagina, tabela, coluna]);

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
        onClick={() => setAberto((a) => !a)}
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
                  <ArvoreDeDatas arvore={arvore} sel={sel} expandidos={expandidos} aoAlternarNo={alternaNo} aoAplicar={aplica} />
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
