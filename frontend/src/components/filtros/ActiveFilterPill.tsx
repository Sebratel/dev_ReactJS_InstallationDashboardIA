import type { FiltroDaTela } from '../../services/dashboardService.ts';
import { X } from 'lucide-react';

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
      className="inline-flex items-center gap-[6px] rounded-full border border-pbi-primary bg-pbi-primary-soft px-[8px] py-[2px] text-[0.68rem] font-semibold text-pbi-primary-texto"
      title={`${filtro.coluna}: ${valores}`}
    >
      <span className="font-extrabold">
        {filtro.coluna}
        {filtro.nivel ? `.${filtro.nivel}` : ''}:
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
