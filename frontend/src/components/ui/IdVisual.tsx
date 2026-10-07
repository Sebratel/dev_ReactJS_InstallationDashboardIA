// O id do visual na spec (modo conferência): a chave de `backend/specs/paridade`.
// `data-id-visual` é o gancho de `backend/tools/tela/src/varre.ts`.

import { cn } from '../../utils/cn.ts';

export function IdVisual(props: { id: string; title?: string; className?: string }) {
  return (
    <span
      data-id-visual
      title={props.title}
      className={cn(
        'font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[0.62rem] text-pbi-muted select-all',
        props.className,
      )}
    >
      {props.id}
    </span>
  );
}
