import { useEffect, useState } from 'react';

/**
 * A hora de agora, que se atualiza sozinha a cada `intervaloMs`.
 *
 * Existe para texto relativo ("há 23min", "próxima ~10:20"). Calculado com `Date.now()`
 * direto no render, ele só anda quando a tela redesenha por outro motivo — e a capa
 * parada ficava com a idade congelada até alguém clicar em "Atualizar agora" (Erick,
 * 22/10/2026). Com este relógio a idade anda sozinha; o dado em si continua chegando
 * pelo `useSaude` (a cada 2 min) e pelos eventos do servidor.
 */
export function useAgora(intervaloMs = 30_000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return agora;
}
