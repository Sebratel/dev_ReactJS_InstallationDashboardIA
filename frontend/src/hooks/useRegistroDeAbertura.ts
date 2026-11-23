// Registra no servidor que esta conta abriu esta aba.
//
// Só a troca efetiva de aba dispara o registro: filtro, prefetch e aquecimento não
// alteram a aba aberta. A API ainda aplica as exclusões e a deduplicação de 30 minutos,
// e uma aba não liberada não é registrada — ela está a caminho de outra.

import { useEffect } from 'react';

export function useRegistroDeAbertura(
  abaAberta: string | null,
  liberada: boolean | null,
  registra: (aba: string) => void,
): void {
  useEffect(() => {
    if (abaAberta && liberada === true) registra(abaAberta);
  }, [abaAberta, liberada, registra]);
}
