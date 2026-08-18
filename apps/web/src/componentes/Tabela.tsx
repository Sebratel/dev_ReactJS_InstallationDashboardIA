// A tabela de detalhe. O corte é dito, nunca silencioso — e agora é navegável e exportável.

import { useMemo, useState } from 'react';
import type { DadosDeTabela, FiltroDaTela, VisualCalculado } from '../api.ts';
import { formata } from '../formato.ts';
import { Cartao, Erro } from './Cartao.tsx';
import { Paginacao } from './Paginacao.tsx';
import { usaJanela } from './usaJanela.ts';

export function Tabela(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
}) {
  const janela = usaJanela(props.pagina, props.visual, props.filtros);
  const d = janela.visual.dados as DadosDeTabela;

  const [colOrdenada, setColOrdenada] = useState<number | null>(null);
  const [ordemDesc, setOrdemDesc] = useState<boolean>(false);

  const alternarOrdem = (index: number) => {
    if (colOrdenada === index) {
      if (ordemDesc) {
        setColOrdenada(null);
        setOrdemDesc(false);
      } else {
        setOrdemDesc(true);
      }
    } else {
      setColOrdenada(index);
      setOrdemDesc(false);
    }
  };

  const linhasExibidas = useMemo(() => {
    if (colOrdenada === null || !d.linhas) return d.linhas;
    const copia = [...d.linhas];
    copia.sort((a, b) => {
      const vA = a[colOrdenada];
      const vB = b[colOrdenada];
      if (vA === null || vA === undefined) return 1;
      if (vB === null || vB === undefined) return -1;
      if (typeof vA === 'number' && typeof vB === 'number') {
        return ordemDesc ? vB - vA : vA - vB;
      }
      const valA = vA as unknown;
      const valB = vB as unknown;
      if (valA instanceof Date && valB instanceof Date) {
        return ordemDesc ? valB.getTime() - valA.getTime() : valA.getTime() - valB.getTime();
      }
      const sA = String(vA).toLowerCase();
      const sB = String(vB).toLowerCase();
      if (sA < sB) return ordemDesc ? 1 : -1;
      if (sA > sB) return ordemDesc ? -1 : 1;
      return 0;
    });
    return copia;
  }, [d.linhas, colOrdenada, ordemDesc]);

  const exportarCSV = () => {
    if (!d.colunas || !d.linhas) return;
    const cabecalho = d.colunas.map((c) => `"${(c.nome ?? '').replace(/"/g, '""')}"`).join(';');
    const corpo = d.linhas
      .map((linha) =>
        linha
          .map((v, colIdx) => {
            const f = formata(v, d.colunas[colIdx]?.tipo ?? null);
            return `"${f.texto.replace(/"/g, '""')}"`;
          })
          .join(';'),
      )
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

  const estado = { de: d.de, mostradas: d.linhas.length, total: d.linhasTotais };

  return (
    <Cartao titulo={props.visual.tipo} id={props.visual.id} largo>
      <div className="cartao-acoes">
        <button className="secundario btn-exportar" onClick={exportarCSV} title="Exportar dados da tabela em formato CSV">
          📥 Exportar CSV
        </button>
      </div>
      {janela.erro ? <Erro>{janela.erro}</Erro> : null}
      <div className="rolagem">
        <table className="dados">
          <thead>
            <tr>
              {d.colunas.map((c, i) => {
                const ativa = colOrdenada === i;
                return (
                  <th
                    key={i}
                    className={`th-clicavel ${c.tipo === 'number' || c.tipo === 'date' ? 'num' : ''}`}
                    onClick={() => alternarOrdem(i)}
                    title="Clique para ordenar"
                  >
                    {c.nome ?? '—'}
                    <span className="icone-ordem">
                      {ativa ? (ordemDesc ? ' ▼' : ' ▲') : ' ⇅'}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {linhasExibidas.map((linha, i) => (
              <tr key={i}>
                {linha.map((valor, j) => {
                  const f = formata(valor, d.colunas[j]?.tipo ?? null);
                  return (
                    <td key={j} className={`${f.numerico ? 'num' : ''}${f.vazio ? ' sem' : ''}`}>
                      {f.texto}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginacao janela={estado} carregando={janela.carregando} vaiPara={janela.vaiPara} />
    </Cartao>
  );
}
