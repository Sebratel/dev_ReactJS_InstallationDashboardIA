// O topo da tela: 52px, e é isso que a conta de altura assume.
//
// A altura aqui não é estética: `--h-topbar` entra em `--chrome`, e `--chrome` decide
// a altura de todo card da página. Mudar este número sem mudar o token faz os cards
// passarem da tela — o defeito que a conta existe para evitar.

import type { ReactNode } from 'react';
import { useThemeStore } from '../../store/useThemeStore.ts';
import { Sun, Moon, Wrench, Eye } from 'lucide-react';

export function HeaderSebratel({
  titulo,
  sub,
  conferencia,
  alternaModo,
  dataMaisRecente = '—',
  horaMaisRecente = '—',
  acoesAdicionais,
}: {
  titulo: string;
  sub: string;
  conferencia: boolean;
  alternaModo: () => void;
  dataMaisRecente?: string;
  horaMaisRecente?: string;
  acoesAdicionais?: ReactNode;
}) {
  const { isDark, toggleTheme } = useThemeStore();

  return (
    <header className="cabecalho">
      <span className="cabecalho-titulo">{titulo}</span>
      <span className="cabecalho-sub">
        {/* NÃO é "Instalação Gerencial": esse é outro relatório. */}
        {sub || 'Relatório Instalação — Sebratel Field Service'}
      </span>

      <div className="grupo-acoes-cabecalho">
        <div className="carimbo-cabecalho">
          <span className="rot">Última atualização</span>
          <span className="val">{dataMaisRecente}</span>
        </div>
        <div className="carimbo-cabecalho">
          <span className="rot">Horário</span>
          <span className="val">{horaMaisRecente}</span>
        </div>

        <button
          className={`btn-icone${conferencia ? ' ativo' : ''}`}
          onClick={alternaModo}
          title={conferencia ? 'Modo conferência ativo' : 'Modo apresentação ativo'}
        >
          {conferencia ? <Wrench size={15} /> : <Eye size={15} />}
        </button>

        <button className="btn-icone" onClick={toggleTheme} title="Alternar tema">
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {acoesAdicionais}
      </div>
    </header>
  );
}
