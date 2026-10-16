// Os controles do canto do topo: copiar o link, o perfil Google, tema, ações da página
// (o "Atualizar") e sair. O avatar ocupa o espaço que antes expunha o modo técnico de
// conferência, para o cabeçalho seguir o padrão do dashboard Comercial.

import { useState, type ReactNode } from 'react';
import { Check, LogOut, Moon, Share2, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore.ts';
import { BotaoDeIcone } from '../ui/BotaoDeIcone.tsx';

export function AcoesDoCabecalho(props: {
  acoes?: ReactNode;
  aoSair: () => void;
  usuario?: string;
  foto?: string;
}) {
  const { isDark, toggleTheme } = useThemeStore();
  const [copiado, setCopiado] = useState(false);
  const [fotoFalhou, setFotoFalhou] = useState(false);

  const copiaLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      });
    }
  };

  return (
    <div className="ml-auto flex items-center gap-[8px]">
      <BotaoDeIcone
        ativo={copiado}
        onClick={copiaLink}
        aria-label="Copiar link com filtros aplicados"
        title={copiado ? 'Link copiado com sucesso!' : 'Copiar link com filtros aplicados'}
      >
        {copiado ? <Check size={15} /> : <Share2 size={15} />}
      </BotaoDeIcone>

      {props.usuario ? (
        <span
          className="inline-flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-pbi-borda bg-pbi-primary-soft text-[12px] font-bold text-pbi-primary-texto"
          title={`Conta Google: ${props.usuario}`}
        >
          {props.foto && !fotoFalhou ? (
            <img
              src={props.foto}
              alt={`Foto de ${props.usuario}`}
              className="size-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setFotoFalhou(true)}
            />
          ) : (
            props.usuario.trim().charAt(0).toUpperCase()
          )}
        </span>
      ) : null}

      <BotaoDeIcone
        onClick={toggleTheme}
        aria-pressed={isDark}
        title={isDark ? 'Tema escuro. Clique para o claro.' : 'Tema claro. Clique para o escuro.'}
      >
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </BotaoDeIcone>

      {props.acoes}

      <BotaoDeIcone onClick={props.aoSair} title="Sair">
        <LogOut size={15} />
      </BotaoDeIcone>
    </div>
  );
}
