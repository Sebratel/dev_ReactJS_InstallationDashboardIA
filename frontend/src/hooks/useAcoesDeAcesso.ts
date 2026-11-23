// As gravações da aba Configurações, num lugar só.
//
// Estavam dentro do corpo da `GestaoDeAcessos`, junto do estado da tela e de 400 linhas
// de JSX. Aqui ficam as quatro ações e a regra que vale para todas: **o que grava já
// devolve a matriz relida do banco**, e é essa resposta que entra no cache — a tela
// nunca remonta o estado à mão a partir do que mandou gravar.

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { aplicaOperacao, dispensaPedido, type MatrizDeAcesso } from '../services/acessoService.ts';
import { chavesDeConsulta } from '../services/dashboardService.ts';
import { useRascunhoDeAcessos } from '../store/rascunhoDeAcessosStore.ts';
import { semOperacao, type OperacaoDeAcesso } from '../utils/rascunhoDeAcessos.ts';
import { CHAVE_SESSOES } from '../components/acessos/SessoesAtivas.tsx';

/** A matriz pessoa × aba no cache do React Query. */
export const CHAVE_ACESSOS = ['acessos'] as const;

/** O histórico de alterações de acesso. */
const CHAVE_HISTORICO = ['acessos-historico'] as const;

export interface AcoesDeAcesso {
  /** Grava o rascunho inteiro, uma operação por vez. */
  salva: UseMutationResult<void, Error, OperacaoDeAcesso[]>;
  /** Dispensa um pedido de acesso pendente. */
  dispensa: UseMutationResult<MatrizDeAcesso, Error, string>;
  /** Aplica uma ação de clique (perfil, suspensão, situação) a cada pessoa selecionada. */
  emMassa: UseMutationResult<void, Error, (email: string) => Promise<MatrizDeAcesso>>;
  /** Põe no cache a matriz que o servidor acabou de devolver. */
  aoAtualizar: (nova: MatrizDeAcesso) => void;
}

export function useAcoesDeAcesso(
  emailsSelecionados: ReadonlySet<string>,
  aoTerminarEmMassa: () => void,
): AcoesDeAcesso {
  const clienteDeConsultas = useQueryClient();
  const { muda, descarta } = useRascunhoDeAcessos();

  // As abas de QUEM ESTÁ LOGADO podem ter mudado junto, e remover pessoa derruba as
  // sessões dela no servidor (S2). O histórico também: a gravação acabou de entrar nele,
  // e sem isto ele só aparecia com F5 (22/10/2026). A matriz não — ela já vem na
  // resposta de cada gravação.
  const releConsultasLigadas = () => {
    void clienteDeConsultas.invalidateQueries({ queryKey: chavesDeConsulta.dashboards });
    void clienteDeConsultas.invalidateQueries({ queryKey: CHAVE_SESSOES });
    void clienteDeConsultas.invalidateQueries({ queryKey: CHAVE_HISTORICO });
  };

  const aoAtualizar = (nova: MatrizDeAcesso) => {
    clienteDeConsultas.setQueryData(CHAVE_ACESSOS, nova);
    releConsultasLigadas();
  };

  // Um pedido por vez, na ordem de `operacoesDoRascunho`. O que gravou sai do rascunho
  // na hora: se o terceiro falhar, os dois primeiros ficam gravados e só o resto
  // continua pendente na tela.
  const salva = useMutation({
    mutationFn: async (operacoes: OperacaoDeAcesso[]) => {
      try {
        for (const operacao of operacoes) {
          const matrizRelida = await aplicaOperacao(operacao);
          clienteDeConsultas.setQueryData(CHAVE_ACESSOS, matrizRelida);
          muda((rascunho) => semOperacao(rascunho, operacao));
        }
      } finally {
        releConsultasLigadas();
      }
    },
    onSuccess: descarta,
  });

  // Dispensar um pedido não mexe no acesso de ninguém: basta a matriz nova no cache.
  const dispensa = useMutation({
    mutationFn: dispensaPedido,
    onSuccess: (nova: MatrizDeAcesso) => clienteDeConsultas.setQueryData(CHAVE_ACESSOS, nova),
  });

  // Um pedido por pessoa, em ordem; o que gravou fica, mesmo se um falhar.
  const emMassa = useMutation({
    mutationFn: async (aplica: (email: string) => Promise<MatrizDeAcesso>) => {
      for (const email of emailsSelecionados) aoAtualizar(await aplica(email));
    },
    onSuccess: aoTerminarEmMassa,
  });

  return { salva, dispensa, emMassa, aoAtualizar };
}
