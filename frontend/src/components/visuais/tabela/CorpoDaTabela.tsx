// O `<table>` da tabela de detalhe: cabeçalho ordenável e as linhas visíveis, com barra
// de dados dentro da célula e selo de status. O estado (ordem, janela, busca) é da
// `Tabela.tsx`; aqui é só o desenho.

import type { DadosDeTabela, Valor } from '../../../services/dashboardService.ts';
import { formata } from '../../../utils/formato.ts';
import { larguraDaBarra } from '../../../utils/magnitude.ts';
import { seloDeStatus } from '../../../utils/tabelaDados.ts';
import { SetaDeOrdem } from '../../ui/icones.tsx';

function ConteudoDaCelula(props: { valor: unknown; tipo: DadosDeTabela['colunas'][number]['tipo'] | null }) {
  const f = formata(props.valor, props.tipo);
  if (f.vazio) return <span className="sem">{f.texto}</span>;
  const txt = f.texto.trim();
  const selo = seloDeStatus(txt);
  return selo ? <span className={`badge-status ${selo}`}>{txt}</span> : <>{f.texto}</>;
}

export function CorpoDaTabela(props: {
  colunas: DadosDeTabela['colunas'];
  linhas: readonly Valor[][];
  escalas: ReadonlyMap<number, number>;
  colOrdenada: number | null;
  ordemDesc: boolean;
  aoOrdenar: (coluna: number) => void;
  /** Clicar numa linha filtra a página pela PRIMEIRA coluna dela — `undefined` quando não dá. */
  aoClicarLinha?: (valor: Valor) => void;
  /** Há uma linha selecionada? Então as outras esmaecem. */
  haSelecao: boolean;
  estaSelecionada: (valor: Valor) => boolean;
}) {
  const { colunas, escalas, aoClicarLinha } = props;
  return (
    <div className="rolagem">
      <table className="dados">
        <thead>
          <tr>
            {colunas.map((c, i) => (
              <th
                key={i}
                className={`th-clicavel ${c.tipo === 'number' || c.tipo === 'date' ? 'num' : ''}`}
                onClick={() => props.aoOrdenar(i)}
                title="Clique para ordenar"
              >
                {c.nome ?? '—'}
                <SetaDeOrdem ativa={props.colOrdenada === i} desc={props.ordemDesc} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.linhas.map((linha, i) => (
            <tr
              key={i}
              className={
                (aoClicarLinha ? 'linha-clicavel' : '') +
                (props.haSelecao ? (props.estaSelecionada(linha[0] as Valor) ? ' linha-selecionada' : ' linha-apagada') : '')
              }
              onClick={aoClicarLinha ? () => aoClicarLinha(linha[0] as Valor) : undefined}
              title={aoClicarLinha ? 'Clique para filtrar a página inteira a este registro' : undefined}
            >
              {linha.map((valor, j) => {
                const f = formata(valor, colunas[j]?.tipo ?? null);
                const escala = escalas.get(j);
                const temBarra = escala !== undefined && typeof valor === 'number';
                return (
                  <td key={j} className={`${f.numerico ? 'num' : ''}${temBarra ? ' barra-dado' : ''}`} title={f.texto}>
                    {temBarra ? <i className="fundo-barra" style={{ width: `${larguraDaBarra(valor as number, escala!)}%` }} /> : null}
                    <span>
                      <ConteudoDaCelula valor={valor} tipo={colunas[j]?.tipo ?? null} />
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
