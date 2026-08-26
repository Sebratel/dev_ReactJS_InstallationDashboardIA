// Uma segmentação: o botão na barra de filtros e o diálogo que escolhe os valores.
//
// **DIÁLOGO, NÃO POPOVER.** O painel era `position: absolute` ancorado no botão. Isso
// não funciona quando o gatilho vive dentro de uma barra que rola de lado (é o caso:
// `.filtros` tem `overflow-x`) — a borda do contêiner corta o painel, e com a lista
// interna rolando dentro dele o usuário empilha três recortes para marcar um item.
// A regra do padrão: gatilho dentro de área com `overflow`, ou lista com mais de ~10
// itens, pede diálogo centralizado com portal no `body`. Nada recorta, cabe grade de
// 2 colunas, e há busca e rodapé de confirmação.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  pegaValores,
  type Segmentacao as SegmentacaoSpec,
  type TipoDeValor,
  type Valor,
} from '../api.ts';
import { formata, inteiro } from '../formato.ts';
import { X, ChevronDown } from 'lucide-react';

export function Segmentacao(props: {
  pagina: string;
  spec: SegmentacaoSpec;
  selecao: readonly Valor[];
  aoMudar: (valores: Valor[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<{ valor: Valor; tipo: TipoDeValor }[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [cortado, setCortado] = useState(false);

  async function abre(): Promise<void> {
    setAberto(true);
    if (opcoes !== null || carregando) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await pegaValores(
        props.pagina,
        props.spec.tabela,
        props.spec.coluna,
        props.spec.nivel,
      );
      setOpcoes(r.valores);
      setCortado(r.cortado);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregando(false);
    }
  }

  function alterna(v: Valor): void {
    const marcado = props.selecao.some((x) => mesmoValor(x, v));
    props.aoMudar(marcado ? props.selecao.filter((x) => !mesmoValor(x, v)) : [...props.selecao, v]);
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
        onClick={abre}
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
                            <label key={i} className="filtro-opcao">
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
