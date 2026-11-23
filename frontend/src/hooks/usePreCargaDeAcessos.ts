// A aba CONFIGURAÇÕES chega pronta no clique, não depois dele.
//
// A matriz de acessos e os três períodos do cartão "Uso das abas" são buscados antes de
// alguém clicar na aba (`feedback-tudo-pre-carregado`) — só para quem a vê, porque para
// os outros o servidor responderia 403.

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pegaMatriz, pegaUsoDasTelas } from '../services/acessoService.ts';
import { CHAVE_ACESSOS } from '../components/acessos/GestaoDeAcessos.tsx';
import { chaveDoUso, PERIODOS_DE_USO } from '../components/acessos/UsoDasTelas.tsx';

export function usePreCargaDeAcessos(podeGerir: boolean): void {
  const clienteDeConsultas = useQueryClient();

  useEffect(() => {
    if (!podeGerir) return;
    void clienteDeConsultas.prefetchQuery({ queryKey: CHAVE_ACESSOS, queryFn: pegaMatriz });
    // Os três períodos do cartão: trocar o seletor não mostra "Lendo…".
    for (const dias of PERIODOS_DE_USO) {
      void clienteDeConsultas.prefetchQuery({
        queryKey: chaveDoUso(dias),
        queryFn: () => pegaUsoDasTelas(dias),
      });
    }
  }, [podeGerir, clienteDeConsultas]);
}
