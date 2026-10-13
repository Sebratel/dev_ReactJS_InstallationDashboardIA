// O botão "Atualizar" do topo — o `.icon-btn` com o giro do COM. O que ele faz é
// `useTempoReal.atualiza`; aqui é só o botão, girando enquanto a página busca de novo.

import { RefreshCw } from 'lucide-react';
import { BotaoDeIcone } from '../ui/BotaoDeIcone.tsx';

export function BotaoAtualizar(props: {
  aoClicar: () => void;
  desligado: boolean;
  buscando: boolean;
}) {
  return (
    <BotaoDeIcone
      onClick={props.aoClicar}
      disabled={props.desligado}
      title="Atualizar agora"
      aria-label="Atualizar agora"
    >
      <RefreshCw size={15} className={props.buscando ? 'girando' : undefined} aria-hidden="true" />
    </BotaoDeIcone>
  );
}
