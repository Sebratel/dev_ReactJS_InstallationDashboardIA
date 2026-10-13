// Uma segmentação: o botão na barra de filtros e o diálogo que escolhe os valores.
//
// **DIÁLOGO, NÃO POPOVER.** O painel era `position: absolute` ancorado no botão. Isso
// não funciona quando o gatilho vive dentro de uma barra que rola de lado (é o caso:
// `.filtros` tem `overflow-x`) — a borda do contêiner corta o painel, e com a lista
// interna rolando dentro dele o usuário empilha três recortes para marcar um item.
// A regra do padrão: gatilho dentro de área com `overflow`, ou lista com mais de ~10
// itens, pede diálogo centralizado com portal no `body`. Nada recorta, cabe grade de
// 2 colunas, e há busca e rodapé de confirmação (`ui/Dialogo`).
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

import { rotuloDeCampo } from '../../utils/rotulos.ts';
import { useState } from 'react';
import { useValoresDaSegmentacao } from '../../hooks/useDadosDaTela.ts';
import {
  type Segmentacao as SegmentacaoSpec,
  type TipoDeValor,
  type Valor,
} from '../../services/dashboardService.ts';
import { formata, inteiro } from '../../utils/formato.ts';
import { Erro } from '../ui/Cartao.tsx';
import { Botao } from '../ui/Botao.tsx';
import { AcoesDoDialogo, Dialogo } from '../ui/Dialogo.tsx';
import { Nota } from '../ui/Nota.tsx';
import { GatilhoDoFiltro } from './GatilhoDoFiltro.tsx';

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
  const { opcoes, cortado, erro } = useValoresDaSegmentacao(
    pagina,
    spec.tabela,
    spec.coluna,
    spec.nivel,
  );

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
    <GatilhoDoFiltro
      rotulo={props.spec.rotulo}
      resumo={resumo}
      marcados={props.selecao.length}
      aberto={aberto}
      aoClicar={() => setAberto(true)}
      title={props.selecao.length ? resumo : `Escolher ${rotuloDeCampo(props.spec.rotulo)}`}
    >
      {aberto && (
        <Dialogo
          titulo={rotuloDeCampo(props.spec.rotulo)}
          aoFechar={() => setAberto(false)}
          rodape={
            <>
              <Nota>
                {inteiro(visiveis.length)} de {inteiro(opcoes?.length ?? 0)}
                {cortado ? ' · limite atingido' : ''}
              </Nota>
              <AcoesDoDialogo>
                <Botao
                  variante="secundario"
                  onClick={() =>
                    props.aoMudar([...new Set([...props.selecao, ...visiveis.map((o) => o.valor)])])
                  }
                  disabled={visiveis.length === 0}
                >
                  Todos
                </Botao>
                <Botao
                  variante="secundario"
                  onClick={() => props.aoMudar([])}
                  disabled={props.selecao.length === 0}
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
          {/* Os três estados, também aqui: uma lista em branco sem explicação parece
              "não há valores" quando na verdade a busca ainda nem voltou. */}
          {carregando && <Nota>Carregando valores…</Nota>}
          {erro && <Erro>{erro}</Erro>}

          {opcoes && (
            <>
              <input
                className="w-full"
                placeholder="Filtrar opções…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                autoFocus
              />
              {visiveis.length === 0 ? (
                <Nota>Nenhum resultado para esta busca.</Nota>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-[2px]">
                  {visiveis.map((o, i) => {
                    const marcado = props.selecao.some((x) => mesmoValor(x, o.valor));
                    const f = formata(o.valor, o.tipo);
                    return (
                      <label
                        key={i}
                        className="flex cursor-pointer items-center gap-[8px] rounded-[2px] px-[8px] py-[5px] text-[0.74rem] hover:bg-pbi-primary-soft"
                        onMouseEnter={() => props.aoPrever?.(proxima(o.valor))}
                      >
                        {/* `accent-color` pinta o PREENCHIMENTO da caixa: a primária é
                            fundo, não letra — o navegador escolhe o visto com contraste. */}
                        <input
                          type="checkbox"
                          className="w-auto p-0 accent-pbi-primary"
                          checked={marcado}
                          onChange={() => alterna(o.valor)}
                        />
                        <span className={o.valor === null ? 'text-pbi-neutro italic' : ''}>
                          {o.valor === null ? '(vazio)' : f.texto}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Dialogo>
      )}
    </GatilhoDoFiltro>
  );
}

function rotulo(v: Valor, tipo: TipoDeValor): string {
  return v === null ? '(vazio)' : formata(v, tipo).texto;
}

function mesmoValor(a: Valor, b: Valor): boolean {
  return a === b;
}
