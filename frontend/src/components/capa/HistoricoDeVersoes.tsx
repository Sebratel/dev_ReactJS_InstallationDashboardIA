// O histórico de versões do painel, recolhido no pé da capa. As versões: `capaVersoes.ts`.

import { VERSOES } from '../../utils/capaVersoes.ts';

export function HistoricoDeVersoes() {
  return (
    <details className="capa-versoes">
      <summary>Histórico de versões do painel</summary>
      <ol className="capa-tempo">
        {VERSOES.map((v, i) => (
          <li key={v.versao}>
            <div className="capa-trilho">
              <span className={v.marco ? 'capa-ponto marco' : 'capa-ponto'} />
              {i < VERSOES.length - 1 && <span className="capa-fio" />}
            </div>
            <div className="conteudo">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={v.marco ? 'capa-selo-versao marco' : 'capa-selo-versao'}>
                  v{v.versao}
                </span>
                <span className="data">{v.data}</span>
                {v.marco && <span className="marco-rot">Marco</span>}
              </div>
              <p className="alteracao">{v.alteracao}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
