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
    <span className="pill-filtro" title={`${filtro.coluna}: ${valores}`}>
      <span className="pill-rotulo">
        {filtro.coluna}
        {filtro.nivel ? `.${filtro.nivel}` : ''}:
      </span>
      <span className="pill-valores">{valores}</span>
      <button className="btn-remover-pill" title="Remover este filtro" onClick={aoRemover}>
        <X size={11} />
      </button>
    </span>
  );
}
