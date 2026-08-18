// A segmentação de dados — o `slicer` do Power BI, que até aqui era uma caixa morta.
//
// **A lista de valores só é buscada quando o painel abre.** Uma página de
// `visao-geral` tem 10 segmentações; buscar as dez na abertura pagaria dez varreduras
// do dataset por uma lista que talvez ninguém abra — e a régua da DECISAO-DESEMPENHO é
// abrir em menos de 2 s.

import { useState } from 'react';
import {
  pegaValores,
  type Segmentacao as SegmentacaoSpec,
  type TipoDeValor,
  type Valor,
} from '../api.ts';
import { formata, inteiro } from '../formato.ts';

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

  // Segmentação que não sabe filtrar aparece desabilitada **com o motivo**. Um
  // controle que parece funcionar e não muda número nenhum é pior que controle
  // nenhum: ele faz a pessoa acreditar num número que não foi filtrado.
  if (props.spec.naoFiltra) {
    // O motivo inteiro fica no `title`, não no corpo: são duas destas em
    // `visao-geral`, e o texto solto empurrava as oito segmentações que funcionam
    // para fora da primeira linha — o aviso escondia justamente o que ele explica.
    return (
      <div className="filtro">
        <span className="filtro-rotulo">{props.spec.rotulo}</span>
        <div className="filtro-desabilitado" title={props.spec.naoFiltra}>
          não filtra ⓘ
        </div>
      </div>
    );
  }

  async function abre(): Promise<void> {
    const vai = !aberto;
    setAberto(vai);
    if (!vai || opcoes !== null || carregando) return;
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

  // O tipo da coluna, tirado da lista quando ela já veio. Sem ela o resumo mostra o
  // valor cru — que é o certo: inventar 'date' para um ISO não conferido é a mesma
  // adivinhação que o tipo explícito existe para evitar.
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
        aria-expanded={aberto}
      >
        <span className="filtro-resumo">{resumo}</span>
        {props.selecao.length ? <span className="filtro-conta">{props.selecao.length}</span> : null}
        <span aria-hidden>▾</span>
      </button>

      {aberto ? (
        <div className="filtro-painel">
          {carregando ? <span className="filtro-nota">carregando valores…</span> : null}
          {erro ? <div className="erro">{erro}</div> : null}

          {opcoes ? (
            <>
              <input
                className="filtro-busca"
                placeholder="filtrar a lista…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              <div className="filtro-lista">
                {visiveis.map((o, i) => {
                  const marcado = props.selecao.some((x) => mesmoValor(x, o.valor));
                  const f = formata(o.valor, o.tipo);
                  return (
                    <label className="filtro-opcao" key={i}>
                      <input type="checkbox" checked={marcado} onChange={() => alterna(o.valor)} />
                      {/* BLANK marcado como "(vazio)": é um valor que dá para escolher,
                          e escondê-lo faria a soma das partes não fechar com o total. */}
                      <span className={o.valor === null ? 'vazio' : ''}>
                        {o.valor === null ? '(vazio)' : f.texto}
                      </span>
                    </label>
                  );
                })}
                {visiveis.length === 0 ? <span className="filtro-nota">nada com esse texto.</span> : null}
              </div>
              <div className="filtro-acoes">
                <span className="filtro-nota">
                  {inteiro(visiveis.length)} de {inteiro(opcoes.length)}
                  {cortado ? ' · lista cortada no teto' : ''}
                </span>
                <div className="filtro-botoes-acao">
                  <button
                    className="secundario"
                    onClick={() => {
                      const novos = [...new Set([...props.selecao, ...visiveis.map((o) => o.valor)])];
                      props.aoMudar(novos);
                    }}
                    disabled={visiveis.length === 0}
                  >
                    Marcar Todos
                  </button>
                  <button
                    className="secundario"
                    onClick={() => props.aoMudar([])}
                    disabled={props.selecao.length === 0}
                  >
                    Limpar
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Rótulo curto de um valor, para o resumo do botão e para a busca da lista. */
function rotulo(v: Valor, tipo: TipoDeValor): string {
  return v === null ? '(vazio)' : formata(v, tipo).texto;
}

/**
 * Igualdade de valor de filtro.
 *
 * `===` basta porque tudo que chega aqui já veio serializado do JSON: data é string
 * ISO, número é número. Comparar `Date` com `===` compararia referências e nenhuma
 * marcação persistiria — o motivo de a serialização acontecer no servidor.
 */
function mesmoValor(a: Valor, b: Valor): boolean {
  return a === b;
}
