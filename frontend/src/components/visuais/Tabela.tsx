// A tabela de detalhe. O corte é dito, nunca silencioso — e agora é navegável e exportável.
//
// Regras de tabela do padrão de dashboards: cabeçalho na primária, numérico à direita
// com `tabular-nums`, ordenação clicável com indicador de direção, e **barra de dados
// dentro da célula** em vez de um gráfico ao lado — é o que o Power BI faz, e economiza
// um visual inteiro. A barra só aparece onde ela significa magnitude: ver `ehMagnitude`.
// As contas estão em `utils/tabelaDados.ts`; o `<table>`, em `tabela/CorpoDaTabela.tsx`.

import { useMemo } from 'react';
import type {
  DadosDeTabela,
  FiltroDaTela,
  Valor,
  VisualCalculado,
} from '../../services/dashboardService.ts';
import { escalasDaTabela, ordenaLinhas } from '../../utils/tabelaDados.ts';
import { Cartao, Erro } from '../ui/Cartao.tsx';
import { Paginacao } from '../ui/Paginacao.tsx';
import { useJanela } from '../../hooks/useJanela.ts';
import { tituloDeTabela } from '../../utils/rotulos.ts';
import { Download } from 'lucide-react';
import { LINHAS_VISIVEIS } from '../../utils/janela.ts';
import { selecaoDe, type AoFiltrar } from '../../utils/rota.ts';
import { CorpoDaTabela, textoDaCelula } from './tabela/CorpoDaTabela.tsx';
import { useOrdemDaTabela } from '../../hooks/useOrdemDaTabela.ts';
import { useBuscaComEspera } from '../../hooks/useBuscaComEspera.ts';
import { useExportacaoCsv } from '../../hooks/useExportacaoCsv.ts';
import { usePaginacaoLocal } from '../../hooks/usePaginacaoLocal.ts';
import { MensagemDeEstado } from '../ui/Estado.tsx';

export function Tabela(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
  clicados?: readonly { tabela: string; coluna: string }[];
  aoFiltrar?: AoFiltrar;
}) {
  // Duas velocidades: o que está escrito e o que já virou pedido (`useBuscaComEspera`).
  const busca = useBuscaComEspera();
  const termoAplicado = busca.aplicado;

  // A ordem sai das colunas da PRIMEIRA resposta, e não das da janela: as colunas não
  // mudam de uma janela para outra, e o `useJanela` precisa da ordem para montar o
  // pedido — pegar as colunas dele aqui seria circular.
  const colunasIniciais = (props.visual.dados as DadosDeTabela | undefined)?.colunas ?? [];
  const ordem = useOrdemDaTabela(colunasIniciais.findIndex((coluna) => coluna.tipo === 'date'));
  const colOrdenada = ordem.coluna;
  const ordemDesc = ordem.desc;
  // **A ordem escolhida vai ao SERVIDOR (QA D-17).** Só a que sai do padrão: a de
  // abertura é a mesma que `ordenaPorDataPadrao` já aplicou sobre a consulta inteira, e
  // mandá-la de volta custaria um pedido a mais em toda tabela que abre. `coluna` nula é
  // o terceiro estado do cabeçalho ("nenhuma"), que também é a ordem natural do servidor.
  const ordemParaServidor =
    ordem.foraDoPadrao && colOrdenada !== null ? { coluna: colOrdenada, desc: ordemDesc } : null;

  const janela = useJanela(
    props.pagina,
    props.visual,
    props.filtros,
    termoAplicado,
    ordemParaServidor,
    props.clicados,
  );
  const exportacao = useExportacaoCsv({
    pagina: props.pagina,
    visual: props.visual,
    filtros: props.filtros,
    clicados: props.clicados,
    busca: termoAplicado,
    ordem: { coluna: colOrdenada, desc: ordemDesc },
    escreveCelula: (valor, coluna) => textoDaCelula(valor as Valor, coluna).texto,
  });

  const dadosDaTabela = janela.visual.dados as DadosDeTabela | undefined;
  const temDados = !!dadosDaTabela && !!dadosDaTabela.colunas && !!dadosDaTabela.linhas;
  const colunas = useMemo(
    () => (temDados ? dadosDaTabela!.colunas : []),
    [temDados, dadosDaTabela],
  );
  const linhas = useMemo(() => (temDados ? dadosDaTabela!.linhas : []), [temDados, dadosDaTabela]);

  // TODOS os hooks antes do `return` de "sem dados" (fase 4): eles estavam depois dele,
  // e uma tabela que perdesse os dados entre dois quadros derrubaria a árvore.

  // **Ordenar aqui virou redundância, e fica como rede.** A busca saiu daqui em
  // 16/09/2026 e a ordenação em 16/11/2026 (QA D-17): as duas valem sobre o resultado
  // inteiro, no servidor. A fatia que chega JÁ vem ordenada, então este `sort` não
  // reordena nada — ele só garante que, contra uma API mais velha que a tela, a fatia
  // visível continue na ordem que o cabeçalho anuncia.
  const ordenadas = useMemo(
    () => ordenaLinhas(linhas, colOrdenada, ordemDesc),
    [linhas, colOrdenada, ordemDesc],
  );
  const escalas = useMemo(() => escalasDaTabela(colunas, linhas), [colunas, linhas]);

  // A janela de 20 linhas dentro da fatia de 200 (`usePaginacaoLocal`).
  const paginacao = usePaginacaoLocal({
    deDaFatia: dadosDaTabela?.de,
    linhasNaFatia: dadosDaTabela?.linhas.length ?? 0,
    ancoraDoConjunto: `${termoAplicado}|${String(colOrdenada)}|${String(ordemDesc)}`,
    pedeFatia: janela.vaiPara,
  });

  if (!dadosDaTabela || !dadosDaTabela.colunas || !dadosDaTabela.linhas) {
    return (
      <Cartao
        titulo={tituloDeTabela(props.visual, dadosDaTabela?.colunas ?? [])}
        id={props.visual.id}
        altura="tabela"
      >
        <MensagemDeEstado>Sem dados disponíveis para a tabela.</MensagemDeEstado>
      </Cartao>
    );
  }

  const totalLocal = ordenadas.length;
  const inicio = Math.min(paginacao.inicioLocal, Math.max(0, totalLocal - 1));
  const visiveis = ordenadas.slice(inicio, inicio + LINHAS_VISIVEIS);

  // A paginação é SEMPRE sobre a consulta inteira, e `de` é o índice global da primeira
  // linha. Até 16/11/2026 havia um segundo modo, "universo local", para quando a ordem
  // saía do padrão: a tela ordenava a fatia e tinha de paginar só dentro dela. Com a
  // ordem no servidor (D-17) esse modo deixou de existir — e com ele a nota que avisava
  // "vale sobre as N linhas desta fatia", que era a confissão do defeito.
  const estado = {
    de: dadosDaTabela.de + inicio,
    mostradas: visiveis.length,
    total: dadosDaTabela.linhasTotais,
    totalSemBusca: dadosDaTabela.totalSemBusca,
  };

  /**
   * O CLIQUE NUMA LINHA filtra pela PRIMEIRA coluna QUE TEM ORIGEM — no relatório de
   * origem é ela que identifica o registro (PROTOCOLO), então recorta a página inteira
   * para ESTE registro sem amarrar um filtro por coluna. Sem nenhuma, o clique não filtra.
   *
   * **Não é `colunas[0]`.** Seis tabelas abrem com uma contagem (o `.` de
   * `COUNT(Protocolo)`), que não tem origem: filtrar por ela mandava `Protocolo = 1`, e
   * a página inteira caía no guarda de espécie (14/10/2026). A API devolve
   * tabela/coluna `null` em campo calculado justamente para ele ser pulado aqui.
   */
  const iDoClique = dadosDaTabela.colunas.findIndex(
    (colunaAtual) => !!colunaAtual.tabela && !!colunaAtual.coluna,
  );
  const colunaDoClique = iDoClique >= 0 ? dadosDaTabela.colunas[iDoClique]! : null;
  const podeClicarNaLinha = props.aoFiltrar !== undefined && colunaDoClique !== null;
  const selecaoDaLinha = colunaDoClique
    ? selecaoDe(props.filtros, colunaDoClique.tabela!, colunaDoClique.coluna!, colunaDoClique.nivel)
    : [];
  const clicaNaLinha = (linha: readonly Valor[]) => {
    const valor = linha[iDoClique];
    if (valor === null || valor === undefined) return;
    props.aoFiltrar!([
      {
        tabela: colunaDoClique!.tabela!,
        coluna: colunaDoClique!.coluna!,
        nivel: colunaDoClique!.nivel ?? null,
        valor,
      },
    ]);
  };

  return (
    <Cartao
      titulo={tituloDeTabela(props.visual, dadosDaTabela.colunas)}
      id={props.visual.id}
      largo
      altura="tabela"
      acoes={
        <>
          <input
            type="text"
            className="tabela-busca-input"
            placeholder="Filtrar…"
            value={busca.termo}
            onChange={(evento) => busca.escreve(evento.target.value)}
          />
          <button
            onClick={() => void exportacao.exporta(dadosDaTabela)}
            disabled={exportacao.exportando}
            title="Exportar todas as linhas do período filtrado em formato CSV"
          >
            <Download size={12} /> {exportacao.rotuloDoBotao}
          </button>
        </>
      }
    >
      {janela.erro ? <Erro>{janela.erro}</Erro> : null}
      {exportacao.erro ? <Erro>{exportacao.erro}</Erro> : null}
      {totalLocal === 0 ? (
        <MensagemDeEstado>
          {busca.termo ? 'Nenhuma linha para esta busca.' : 'Nenhuma linha para os filtros atuais.'}
        </MensagemDeEstado>
      ) : (
        <CorpoDaTabela
          colunas={dadosDaTabela.colunas}
          linhas={visiveis}
          escalas={escalas}
          colOrdenada={colOrdenada}
          ordemDesc={ordemDesc}
          aoOrdenar={ordem.alterna}
          aoClicarLinha={podeClicarNaLinha ? clicaNaLinha : undefined}
          haSelecao={selecaoDaLinha.length > 0}
          estaSelecionada={(linha) =>
            selecaoDaLinha.some((valor) => Object.is(valor, linha[iDoClique]))
          }
        />
      )}
      <Paginacao
        janela={estado}
        carregando={janela.carregando}
        vaiPara={paginacao.vaiParaLinha}
        passo={LINHAS_VISIVEIS}
      />
    </Cartao>
  );
}
