// Os controles do canto do topo: copiar o link, o perfil Google, tema, ações da página
// (o "Atualizar") e sair. O avatar ocupa o espaço que antes expunha o modo técnico de
// conferência, para o cabeçalho seguir o padrão do dashboard Comercial.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, LogOut, Moon, Share2, Sun } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore.ts';
import { BotaoDeIcone } from '../ui/BotaoDeIcone.tsx';

export function AcoesDoCabecalho(props: {
  acoes?: ReactNode;
  aoSair: () => void;
  usuario?: string;
  nome?: string;
  foto?: string;
}) {
  const { isDark, toggleTheme } = useThemeStore();
  const [copiado, setCopiado] = useState(false);
  const [fotoFalhou, setFotoFalhou] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuAberto) return undefined;
    const fechaAoClicarFora = (evento: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(evento.target as Node)) setMenuAberto(false);
    };
    document.addEventListener('mousedown', fechaAoClicarFora);
    return () => document.removeEventListener('mousedown', fechaAoClicarFora);
  }, [menuAberto]);

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
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuAberto((aberto) => !aberto)}
            className="flex min-h-[36px] cursor-pointer items-center gap-[8px] rounded-full border border-pbi-grid bg-pbi-superficie py-[3px] pr-[10px] pl-[3px] font-sans text-[12.5px] text-pbi-ink enabled:hover:bg-pbi-hover"
            title={props.usuario}
            aria-expanded={menuAberto}
            aria-haspopup="menu"
          >
            {props.foto && !fotoFalhou ? (
              <img
                src={props.foto}
                alt={`Foto de ${props.nome ?? props.usuario}`}
                className="size-[28px] rounded-full object-cover"
                referrerPolicy="no-referrer"
                onError={() => setFotoFalhou(true)}
              />
            ) : (
              <span className="grid size-[28px] place-items-center rounded-full bg-pbi-primary text-[12px] font-bold text-pbi-sobre-primary">
                {(props.nome ?? props.usuario).trim().charAt(0).toUpperCase()}
              </span>
            )}
            {props.nome ? <span>{props.nome.split(' ')[0]}</span> : null}
          </button>

          {menuAberto ? (
            <div
              role="menu"
              className="absolute top-[calc(100%+6px)] right-0 z-[70] min-w-[230px] overflow-hidden rounded-[10px] border border-pbi-grid bg-pbi-superficie shadow-[0_10px_26px_rgba(0,0,0,0.18)]"
            >
              <div className="border-b border-pbi-grid px-[13px] py-[11px]">
                <b className="block text-[13px] text-pbi-ink">{props.nome ?? props.usuario}</b>
                <span className="text-[11.5px] text-pbi-muted">{props.usuario}</span>
              </div>
              <button
                type="button"
                role="menuitem"
                className="block w-full cursor-pointer border-0 border-t border-pbi-grid bg-transparent px-[13px] py-[9px] text-left font-sans text-[13px] text-pbi-critico-texto hover:bg-pbi-hover"
                onClick={props.aoSair}
              >
                Sair
              </button>
            </div>
          ) : null}
        </div>
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
