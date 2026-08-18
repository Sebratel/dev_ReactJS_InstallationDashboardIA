// A matriz (tabela dinâmica): chaves de linha, chaves de coluna e medidas no cruzamento.

import type { DadosDeMatriz, FiltroDaTela, VisualCalculado } from '../api.ts';
import { formata, inteiro } from '../formato.ts';
import { Cartao, Erro } from './Cartao.tsx';
import { Paginacao } from './Paginacao.tsx';
import { usaJanela } from './usaJanela.ts';

export function Matriz(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
}) {
  const janela = usaJanela(props.pagina, props.visual, props.filtros);
  const visual = janela.visual;
  const d = visual.dados as DadosDeMatriz;

  const semEixoDeColuna = d.colunas.length === 1 && d.colunas[0]?.length === 0;

  const partes = [`${inteiro(d.linhasTotais)} × ${inteiro(d.colunas.length)}`];
  if (d.descartadas.linhas || d.descartadas.colunas) {
    partes.push(`${d.descartadas.linhas + d.descartadas.colunas} posição(ões) vazia(s) podada(s)`);
  }

  const exportarCSV = () => {
    if (!d.linhas || !d.chavesDeLinha) return;

    const cabecalhoLinha = d.chavesDeLinha.map((c) => c.nome ?? c.coluna).join(' / ');
    const cabecalhosColunas = d.colunas.flatMap((c) =>
      d.medidas.map((m) =>
        semEixoDeColuna
          ? (m ?? '—')
          : c.map((x, i) => formata(x, d.tiposDeColuna[i] ?? null).texto).join(' / ') +
            (d.medidas.length > 1 ? ` · ${m ?? ''}` : ''),
      ),
    );

    const cabecalho = [`"${cabecalhoLinha.replace(/"/g, '""')}"`, ...cabecalhosColunas.map((x) => `"${x.replace(/"/g, '""')}"`)].join(';');

    const corpo = d.linhas
      .map((linha, i) => {
        const rotuloLinha = linha.map((x, j) => formata(x, d.tiposDeLinha[j] ?? null).texto).join(' / ');
        const celulasLinha = (d.celulas[i] ?? []).flatMap((celula) =>
          celula.map((valor, mi) => formata(valor, d.tiposDeMedida[mi] ?? null).texto),
        );
        return [`"${rotuloLinha.replace(/"/g, '""')}"`, ...celulasLinha.map((x) => `"${x.replace(/"/g, '""')}"`)].join(';');
      })
      .join('\n');

    const conteudo = `\uFEFF${cabecalho}\n${corpo}`;
    const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${props.pagina}_${props.visual.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Cartao titulo={visual.tipo} sub={partes.join(' · ')} id={visual.id} largo>
      <div className="cartao-acoes">
        <button className="secundario btn-exportar" onClick={exportarCSV} title="Exportar matriz em formato CSV">
          📥 Exportar CSV
        </button>
      </div>
      {janela.erro ? <Erro>{janela.erro}</Erro> : null}
      <div className="rolagem">
        <table className="dados">
          <thead>
            <tr>
              <th>{d.chavesDeLinha.map((c) => c.nome ?? c.coluna).join(' / ')}</th>
              {d.colunas.flatMap((c, ci) =>
                d.medidas.map((m, mi) => (
                  <th key={`${ci}-${mi}`} className="num">
                    {semEixoDeColuna
                      ? (m ?? '—')
                      : c.map((x, i) => formata(x, d.tiposDeColuna[i] ?? null).texto).join(' / ') +
                        (d.medidas.length > 1 ? ` · ${m ?? ''}` : '')}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {d.linhas.map((linha, i) => (
              <tr key={i}>
                <td>{linha.map((x, j) => formata(x, d.tiposDeLinha[j] ?? null).texto).join(' / ')}</td>
                {(d.celulas[i] ?? []).flatMap((celula, ci) =>
                  celula.map((valor, mi) => {
                    const f = formata(valor, d.tiposDeMedida[mi] ?? null);
                    return (
                      <td key={`${ci}-${mi}`} className={`num${f.vazio ? ' sem' : ''}`}>
                        {f.texto}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginacao
        janela={{ de: d.de, mostradas: d.linhas.length, total: d.linhasTotais }}
        carregando={janela.carregando}
        vaiPara={janela.vaiPara}
      />
    </Cartao>
  );
}
