// Os controles de janela de uma tabela ou matriz.

import { inteiro } from '../formato.ts';
import {
  anteriorDe,
  podeAvancar,
  podeVoltar,
  proximoDe,
  rotuloDaJanela,
  type Janela,
} from '../janela.ts';

export function Paginacao(props: {
  janela: Janela;
  carregando: boolean;
  vaiPara: (de: number) => void;
  /** De quanto anda o "anterior". Ver `LINHAS_VISIVEIS` em `janela.ts`. */
  passo?: number;
}) {
  const { janela: j } = props;
  // Tabela que cabe inteira não ganha botão: dois controles desabilitados ao lado de
  // "43 linhas" só ocupam espaço.
  if (!podeVoltar(j) && !podeAvancar(j)) return null;

  return (
    <div className="paginacao">
      <span className="filtro-nota">{rotuloDaJanela(j, inteiro)}</span>
      <span className="espaco" />
      <button
        className="secundario"
        onClick={() => props.vaiPara(0)}
        disabled={!podeVoltar(j) || props.carregando}
        title="primeira janela"
      >
        ⏮
      </button>
      <button
        className="secundario"
        onClick={() => props.vaiPara(anteriorDe(j, props.passo))}
        disabled={!podeVoltar(j) || props.carregando}
      >
        anterior
      </button>
      <button
        className="secundario"
        onClick={() => props.vaiPara(proximoDe(j))}
        disabled={!podeAvancar(j) || props.carregando}
      >
        {props.carregando ? 'carregando…' : 'próxima'}
      </button>
    </div>
  );
}
