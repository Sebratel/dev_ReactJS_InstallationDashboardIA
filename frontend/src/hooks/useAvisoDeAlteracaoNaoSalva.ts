// Alteração de permissão por salvar não some calada num recarregar ou fechar de aba do
// navegador.
//
// Trocar de aba DENTRO do relatório não perde nada (o rascunho mora na store) — por
// isso o aviso só vale para a saída do navegador.

import { useEffect } from 'react';

export function useAvisoDeAlteracaoNaoSalva(alteracoesPendentes: number): void {
  useEffect(() => {
    if (alteracoesPendentes === 0) return;
    const pedeConfirmacao = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener('beforeunload', pedeConfirmacao);
    return () => window.removeEventListener('beforeunload', pedeConfirmacao);
  }, [alteracoesPendentes]);
}
