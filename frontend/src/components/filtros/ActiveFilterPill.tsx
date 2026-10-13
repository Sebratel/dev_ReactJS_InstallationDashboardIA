import type { FiltroDaTela } from '../../services/dashboardService.ts';
import { X } from 'lucide-react';
import { rotuloDeCampo } from '../../utils/rotulos.ts';

export function ActiveFilterPill({
  filtro,
  aoRemover,
}: {
  filtro: FiltroDaTela;
  aoRemover: () => void;
}) {
  const valores = filtro.valores.map((v) => (v === null ? '(vazio)' : String(v))).join(', ');
  return (
    <span
      className="inline-flex h-[30px] items-center gap-[6px] rounded-[8px] border border-pbi-primary-texto bg-pbi-primary-soft px-[10px] text-[12.5px] text-pbi-primary-texto"
      title={`${filtro.coluna}: ${valores}`}
    >
      <span className="font-semibold">
        {rotuloDeCampo(filtro.nivel ? `${filtro.coluna} ${filtro.nivel}` : filtro.coluna)}
      </span>
      <span className="max-w-[220px] truncate">{valores}</span>
      <button
        className="ml-[2px] cursor-pointer border-0 bg-transparent p-0 leading-[0] text-pbi-primary-texto hover:text-pbi-critico-texto"
        title="Remover este filtro"
        onClick={aoRemover}
      >
        <X size={11} />
      </button>
    </span>
  );
}
