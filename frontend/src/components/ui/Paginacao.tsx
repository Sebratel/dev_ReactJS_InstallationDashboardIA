// Os controles de janela de uma tabela ou matriz.

import { inteiro } from '../../utils/formato.ts';
import {
  anteriorDe,
  podeAvancar,
  podeVoltar,
  proximoDe,
  rotuloDaJanela,
  type Janela,
} from '../../utils/janela.ts';
import { Botao } from './Botao.tsx';
import { Nota } from './Nota.tsx';

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
      <Nota>{rotuloDaJanela(j, inteiro)}</Nota>
      <span className="espaco" />
      <Botao
        variante="secundario"
        onClick={() => props.vaiPara(0)}
        disabled={!podeVoltar(j) || props.carregando}
        title="primeira janela"
      >
        ⏮
      </Botao>
      <Botao
        variante="secundario"
        onClick={() => props.vaiPara(anteriorDe(j, props.passo))}
        disabled={!podeVoltar(j) || props.carregando}
      >
        anterior
      </Botao>
      <Botao
        variante="secundario"
        onClick={() => props.vaiPara(proximoDe(j))}
        disabled={!podeAvancar(j) || props.carregando}
      >
        {props.carregando ? 'carregando…' : 'próxima'}
      </Botao>
    </div>
  );
}
