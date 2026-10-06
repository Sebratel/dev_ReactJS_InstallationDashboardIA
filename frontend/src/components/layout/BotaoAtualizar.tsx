// O botão "Atualizar" do cabeçalho. O que ele faz é `useTempoReal.atualiza`; aqui é só
// o botão, girando enquanto a página busca de novo.

import { RefreshCw } from 'lucide-react';

export function BotaoAtualizar(props: {
  aoClicar: () => void;
  desligado: boolean;
  buscando: boolean;
}) {
  return (
    <button
      className="secundario"
      onClick={props.aoClicar}
      disabled={props.desligado}
      title="Buscar de novo os números desta página"
      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
    >
      <RefreshCw size={14} className={props.buscando ? 'girando' : undefined} aria-hidden="true" />
      Atualizar
    </button>
  );
}
