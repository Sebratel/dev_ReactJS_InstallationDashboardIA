// Os botões do canto do topo: copiar o link, modo conferência, tema, as ações da página
// (o "Atualizar") e sair.
//
// **OS DOIS INTERRUPTORES GLOBAIS MORAM AQUI, e não numa tela.** Tema e modo gravam no
// localStorage e sobrevivem ao F5 — de propósito, mas isso os torna ARMADILHA quando não
// há botão: os dois estavam órfãos, ligados por código e desligáveis por ninguém. Quem
// caísse em conferência ou no escuro ficava lá.

import { useState, type ReactNode } from 'react';
import { Check, Eye, LogOut, Moon, Share2, Sun, Wrench } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore.ts';
import { useModo } from '../../context/ModoContext.tsx';
import { cn } from '../../utils/cn.ts';

export function AcoesDoCabecalho(props: { acoes?: ReactNode; aoSair: () => void }) {
  const { isDark, toggleTheme } = useThemeStore();
  const { conferencia, alterna } = useModo();
  const [copiado, setCopiado] = useState(false);

  const copiaLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      });
    }
  };

  return (
    <div className="grupo-acoes-cabecalho">
      <button
        className={cn('btn-icone', copiado && 'ativo')}
        onClick={copiaLink}
        aria-label="Copiar link com filtros aplicados"
        title={copiado ? 'Link copiado com sucesso!' : 'Copiar link com filtros aplicados'}
      >
        {copiado ? <Check size={15} /> : <Share2 size={15} />}
      </button>

      <button
        className={cn('btn-icone', conferencia && 'ativo')}
        onClick={alterna}
        aria-pressed={conferencia}
        title={
          conferencia
            ? 'Modo conferência: id do visual, origem DAX e faixa de cálculo à vista. Clique para apresentar.'
            : 'Modo apresentação. Clique para conferir contra o Power BI.'
        }
      >
        {conferencia ? <Wrench size={15} /> : <Eye size={15} />}
      </button>

      <button
        className="btn-icone"
        onClick={toggleTheme}
        aria-pressed={isDark}
        title={isDark ? 'Tema escuro. Clique para o claro.' : 'Tema claro. Clique para o escuro.'}
      >
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      {props.acoes}

      <button className="btn-icone" onClick={props.aoSair} title="Sair">
        <LogOut size={15} />
      </button>
    </div>
  );
}
