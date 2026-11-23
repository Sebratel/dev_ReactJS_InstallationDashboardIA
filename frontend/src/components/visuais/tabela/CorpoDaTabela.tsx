// O `<table>` da tabela de detalhe: cabeçalho ordenável e as linhas visíveis, com barra
// de dados dentro da célula e selo de status. O estado (ordem, janela, busca) é da
// `Tabela.tsx`; aqui é só o desenho.

import type { DadosDeTabela, Valor } from '../../../services/dashboardService.ts';
import { formata, razaoComoPercentual } from '../../../utils/formato.ts';
import { larguraDaBarra } from '../../../utils/magnitude.ts';
import { seloDeStatus } from '../../../utils/tabelaDados.ts';
import { SetaDeOrdem } from '../../ui/icones.tsx';
import { BadgeDeStatus } from '../../ui/Selo.tsx';

/** O texto da célula — porcentagem quando a API marcou a coluna (`percentual`). */
export function textoDaCelula(
  valor: unknown,
  coluna: DadosDeTabela['colunas'][number] | undefined,
) {
  // Sem `percentual`, `casas` são as do número comum (`"0.0"` → uma casa).
  const formatado = formata(valor, coluna?.tipo ?? null, {
    casas: coluna?.percentual ? null : (coluna?.casas ?? null),
  });
  return coluna?.percentual && !formatado.vazio
    ? { ...formatado, texto: razaoComoPercentual(valor, coluna.casas) }
    : formatado;
}

function ConteudoDaCelula(props: {
  valor: unknown;
  coluna: DadosDeTabela['colunas'][number] | undefined;
}) {
  const formatado = textoDaCelula(props.valor, props.coluna);
  if (formatado.vazio) return <span className="sem">{formatado.texto}</span>;
  const textoLimpo = formatado.texto.trim();
  const selo = seloDeStatus(textoLimpo);
  return selo ? <BadgeDeStatus tom={selo}>{textoLimpo}</BadgeDeStatus> : <>{formatado.texto}</>;
}

/**
 * As classes de uma linha: clicável, e — quando há seleção por clique cruzado — se ela
 * é a selecionada ou uma das apagadas.
 */
function classeDaLinha(estado: {
  clicavel: boolean;
  haSelecao: boolean;
  selecionada: boolean;
}): string {
  const classes = [];
  if (estado.clicavel) classes.push('linha-clicavel');
  if (estado.haSelecao) classes.push(estado.selecionada ? 'linha-selecionada' : 'linha-apagada');
  return classes.join(' ');
}

export function CorpoDaTabela(props: {
  colunas: DadosDeTabela['colunas'];
  linhas: readonly Valor[][];
  escalas: ReadonlyMap<number, number>;
  colOrdenada: number | null;
  ordemDesc: boolean;
  aoOrdenar: (coluna: number) => void;
  /** Clicar numa linha filtra a página — `undefined` quando não dá. A coluna é `Tabela.tsx` quem escolhe. */
  aoClicarLinha?: (linha: readonly Valor[]) => void;
  /** Há uma linha selecionada? Então as outras esmaecem. */
  haSelecao: boolean;
  estaSelecionada: (linha: readonly Valor[]) => boolean;
}) {
  const { colunas, escalas, aoClicarLinha } = props;
  return (
    <div className="rolagem">
      <table className="dados">
        <thead>
          <tr>
            {colunas.map((coluna, indice) => (
              <th
                key={indice}
                className={`th-clicavel ${coluna.tipo === 'number' || coluna.tipo === 'date' ? 'num' : ''}`}
                onClick={() => props.aoOrdenar(indice)}
                title="Clique para ordenar"
              >
                {coluna.nome ?? '—'}
                <SetaDeOrdem ativa={props.colOrdenada === indice} desc={props.ordemDesc} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.linhas.map((linha, posicao) => (
            <tr
              key={posicao}
              className={classeDaLinha({
                clicavel: aoClicarLinha !== undefined,
                haSelecao: props.haSelecao,
                selecionada: props.haSelecao && props.estaSelecionada(linha),
              })}
              onClick={aoClicarLinha ? () => aoClicarLinha(linha) : undefined}
              title={
                aoClicarLinha ? 'Clique para filtrar a página inteira a este registro' : undefined
              }
            >
              {linha.map((valor, indice) => {
                const filtro = textoDaCelula(valor, colunas[indice]);
                const escala = escalas.get(indice);
                const temBarra = escala !== undefined && typeof valor === 'number';
                return (
                  <td
                    key={indice}
                    className={`${filtro.numerico ? 'num' : ''}${temBarra ? ' barra-dado' : ''}`}
                    title={filtro.texto}
                  >
                    {temBarra ? (
                      <i
                        className="fundo-barra"
                        style={{ width: `${larguraDaBarra(valor as number, escala!)}%` }}
                      />
                    ) : null}
                    <span>
                      <ConteudoDaCelula valor={valor} coluna={colunas[indice]} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
