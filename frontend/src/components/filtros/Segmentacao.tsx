// Uma segmentação: o botão na barra de filtros e o diálogo que escolhe os valores.
//
// **DIÁLOGO, NÃO POPOVER.** O painel era `position: absolute` ancorado no botão. Isso
// não funciona quando o gatilho vive dentro de uma barra que rola de lado (é o caso:
// `.filtros` tem `overflow-x`) — a borda do contêiner corta o painel, e com a lista
// interna rolando dentro dele o usuário empilha três recortes para marcar um item.
// A regra do padrão: gatilho dentro de área com `overflow`, ou lista com mais de ~10
// itens, pede diálogo centralizado com portal no `body`. Nada recorta, cabe grade de
// 2 colunas, e há busca e rodapé de confirmação.
//
// **CARREGA AO MONTAR, NÃO AO CLICAR.** Carregar no clique (`abre()`) fazia a pessoa
// pagar a espera do fetch bem no primeiro clique de cada filtro — e como cada
// `Segmentacao` só monta uma vez por carregamento da página (a lista de segmentações
// não muda de identidade quando o filtro muda, só quando a página troca), não há
// vantagem em adiar: o clique só ficaria mais rápido, nunca instantâneo. A lista de
// valores também não depende do filtro corrente (`valores()` em `servidor.ts` não lê
// `filtros` — vem do dataset inteiro da página, cacheado por tabela+coluna+nível), então
// buscar cedo nunca busca "errado". Pedido do usuário em 09/09/2026: os filtros
// tinham de abrir instantâneos, sem esperar o primeiro clique. Mesmo padrão de
// `SegmentacaoChips.tsx`.

import { useState } from 'react';
import { useValoresDaSegmentacao } from '../../hooks/useDadosDaTela.ts';
import { createPortal } from 'react-dom';
import {
  type Segmentacao as SegmentacaoSpec,
  type TipoDeValor,
  type Valor,
} from '../../services/dashboardService.ts';
import { formata, inteiro } from '../../utils/formato.ts';
import { X, ChevronDown } from 'lucide-react';

export function Segmentacao(props: {
  pagina: string;
  spec: SegmentacaoSpec;
  selecao: readonly Valor[];
  aoMudar: (valores: Valor[]) => void;
  /** O mouse parou numa opção: a seleção que o clique nela daria (pré-carregamento). */
  aoPrever?: (valores: Valor[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const { pagina, spec } = props;
  const { opcoes, cortado, erro } = useValoresDaSegmentacao(pagina, spec.tabela, spec.coluna, spec.nivel);

  const carregando = opcoes === null && erro === null;

  /** A seleção depois de clicar em `v` — a mesma conta para o clique e para a previsão. */
  function proxima(v: Valor): Valor[] {
    const marcado = props.selecao.some((x) => mesmoValor(x, v));
    return marcado ? props.selecao.filter((x) => !mesmoValor(x, v)) : [...props.selecao, v];
  }

  function alterna(v: Valor): void {
    props.aoMudar(proxima(v));
  }

  const visiveis = (opcoes ?? []).filter((o) =>
    busca === '' ? true : rotulo(o.valor, o.tipo).toLowerCase().includes(busca.toLowerCase()),
  );

  const tipoDaColuna: TipoDeValor = opcoes?.find((o) => o.tipo !== null)?.tipo ?? null;

  const resumo =
    props.selecao.length === 0
      ? 'todos'
      : props.selecao.length === 1
        ? rotulo(props.selecao[0]!, tipoDaColuna)
        : `${props.selecao.length} selecionados`;

  return (
    <div className="filtro">
      <span className="filtro-rotulo">{props.spec.rotulo}</span>
      <button
        className={`filtro-botao${props.selecao.length ? ' marcado' : ''}`}
        onClick={() => setAberto(true)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title={props.selecao.length ? resumo : `Escolher ${props.spec.rotulo}`}
      >
        <span className="filtro-resumo">{resumo}</span>
        {props.selecao.length > 0 && <span className="filtro-conta">{props.selecao.length}</span>}
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
            <div className="dialogo" role="dialog" aria-modal="true" aria-label={props.spec.rotulo}>
              <div className="dialogo-topo">
                <h3>{props.spec.rotulo}</h3>
                <button className="btn-icone" onClick={() => setAberto(false)} title="Fechar">
                  <X size={13} />
                </button>
              </div>

              <div className="dialogo-corpo">
                {/* Os três estados, também aqui: uma lista em branco sem explicação
                    parece "não há valores" quando na verdade a busca ainda nem voltou. */}
                {carregando && <span className="filtro-nota">Carregando valores…</span>}
                {erro && <div className="erro">{erro}</div>}

                {opcoes && (
                  <>
                    <input
                      className="filtro-busca"
                      placeholder="Filtrar opções…"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      autoFocus
                    />
                    {visiveis.length === 0 ? (
                      <span className="filtro-nota">Nenhum resultado para esta busca.</span>
                    ) : (
                      <div className="filtro-lista">
                        {visiveis.map((o, i) => {
                          const marcado = props.selecao.some((x) => mesmoValor(x, o.valor));
                          const f = formata(o.valor, o.tipo);
                          return (
                            <label key={i} className="filtro-opcao" onMouseEnter={() => props.aoPrever?.(proxima(o.valor))}>
                              <input type="checkbox" checked={marcado} onChange={() => alterna(o.valor)} />
                              <span className={o.valor === null ? 'vazio' : ''}>
                                {o.valor === null ? '(vazio)' : f.texto}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="dialogo-rodape">
                <span className="filtro-nota">
                  {inteiro(visiveis.length)} de {inteiro(opcoes?.length ?? 0)}
                  {cortado ? ' · limite atingido' : ''}
                </span>
                <div className="filtro-botoes-acao">
                  <button
                    className="secundario"
                    onClick={() => props.aoMudar([...new Set([...props.selecao, ...visiveis.map((o) => o.valor)])])}
                    disabled={visiveis.length === 0}
                  >
                    Todos
                  </button>
                  <button className="secundario" onClick={() => props.aoMudar([])} disabled={props.selecao.length === 0}>
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

function rotulo(v: Valor, tipo: TipoDeValor): string {
  return v === null ? '(vazio)' : formata(v, tipo).texto;
}

function mesmoValor(a: Valor, b: Valor): boolean {
  return a === b;
}
