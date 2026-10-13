import { useMemo, useState } from 'react';
import { useValoresDaSegmentacao } from '../../hooks/useDadosDaTela.ts';
import { type FiltroDaTela, type Valor } from '../../services/dashboardService.ts';
import {
  limpaTudo,
  montaArvore,
  resumoDeData,
  selecaoDeData,
  type MudancaDeNivel,
} from '../../utils/hierarquiaData.ts';
import { Erro } from '../ui/Cartao.tsx';
import { ArvoreDeDatas } from './ArvoreDeDatas.tsx';
import { Botao } from '../ui/Botao.tsx';
import { AcoesDoDialogo, Dialogo } from '../ui/Dialogo.tsx';
import { Nota } from '../ui/Nota.tsx';
import { GatilhoDoFiltro } from './GatilhoDoFiltro.tsx';

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
  // de novo sem fechar o que a pessoa abriu. Ajustada DURANTE o render, como a âncora da
  // `Tabela` — num efeito era um render a mais (fase 5, `set-state-in-effect`). A seleção
  // usada é a do momento em que a árvore chega; mudar o filtro depois não reabre nada.
  const chaveDaArvore = [pagina, tabela, coluna].join(' ');
  const [expandidaPara, setExpandidaPara] = useState('');
  if (arvore !== null && expandidaPara !== chaveDaArvore) {
    setExpandidaPara(chaveDaArvore);
    // Um ano só: já aberto, senão o primeiro clique é sempre no mesmo lugar.
    setExpandidos(
      arvore.length === 1 ? new Set([`a${arvore[0]!.ano}`]) : new Set(sel.anos.map((a) => `a${a}`)),
    );
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
    <GatilhoDoFiltro
      rotulo={props.rotulo}
      resumo={resumoDeData(sel)}
      // O período tem um resumo próprio ("26 · out"); o contador de valores só confundiria.
      marcados={marcado > 0 ? 1 : 0}
      aberto={aberto}
      aoClicar={() => setAberto((a) => !a)}
      title={marcado ? resumoDeData(sel) : `Escolher ${props.rotulo}`}
    >
      {aberto && (
        <Dialogo
          titulo={props.rotulo}
          aoFechar={() => setAberto(false)}
          rodape={
            <>
              <Nota>
                {arvore?.length ?? 0} {(arvore?.length ?? 0) === 1 ? 'ano' : 'anos'}
                {/* O corte é dito: uma árvore truncada em silêncio faria concluir que o
                    mês que falta não existe na base. */}
                {cortado ? ' · lista cortada no teto' : ''}
              </Nota>
              <AcoesDoDialogo>
                <Botao
                  variante="secundario"
                  onClick={() => aplica(limpaTudo())}
                  disabled={marcado === 0}
                >
                  Limpar
                </Botao>
                <Botao variante="primario" onClick={() => setAberto(false)}>
                  Aplicar
                </Botao>
              </AcoesDoDialogo>
            </>
          }
        >
          {/* Os três estados, também aqui: uma árvore em branco sem explicação parece
              "não há datas" quando a busca ainda nem voltou. */}
          {carregando && <Nota>Carregando datas…</Nota>}
          {erro && <Erro>{erro}</Erro>}

          {arvore && arvore.length === 0 && <Nota>Nenhuma data nesta coluna.</Nota>}

          {arvore && arvore.length > 0 && (
            <ArvoreDeDatas
              arvore={arvore}
              sel={sel}
              expandidos={expandidos}
              aoAlternarNo={alternaNo}
              aoAplicar={aplica}
            />
          )}
        </Dialogo>
      )}
    </GatilhoDoFiltro>
  );
}
