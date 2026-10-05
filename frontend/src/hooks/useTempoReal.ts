// O tempo real da tela: o aviso do servidor, o relógio de segurança e o "Atualizar".
//
// Os três fazem a mesma coisa — invalidar no React Query o que mudou, para a consulta
// que está na tela buscar de novo MANTENDO o número atual até o novo chegar — e
// registram a hora disso, que o cabeçalho mostra.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chavesDeConsulta } from '../services/dashboardService.ts';
import { assinaEventos } from '../services/eventosService.ts';

/** De quanto em quanto a página aberta busca de novo sozinha, além do aviso do
 *  servidor — a rede de segurança para um aviso perdido numa reconexão do SSE.
 *  Fixo: era um seletor por pessoa ("Auto") até 05/10/2026. */
const ATUALIZA_SOZINHA_S = 60;

export interface TempoReal {
  /** Horário da última atualização (aviso do servidor, relógio ou "Atualizar"). */
  horaRealtime: string | null;
  /**
   * **O botão "Atualizar", e ele não recalcula nada no servidor** (Erick, 05/10/2026).
   * Busca de novo o que o servidor já tem pronto — a página (abertura e visuais abaixo
   * da dobra), as listas dos filtros e a saúde. O antigo "Recalcular" mandava
   * `?recalcula=1`: refazia a conta e regravava o cache de TODO MUNDO por um clique.
   */
  atualiza: () => void;
}

/** Só existe com sessão: a `DashboardPage` só monta logada (ver `App.tsx`). */
export function useTempoReal(atual: string | null): TempoReal {
  const qc = useQueryClient();
  const [horaRealtime, setHoraRealtime] = useState<string | null>(null);

  const marcaHora = useCallback(() => {
    setHoraRealtime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }, []);

  // O efeito do SSE roda uma vez por sessão de login — ler `atual` fresco de um ref
  // evita reabrir a conexão a cada troca de aba (perderia evento no meio da troca).
  const atualRef = useRef(atual);
  useEffect(() => {
    atualRef.current = atual;
  }, [atual]);

  // AUTO-REFRESH PERIÓDICO EM SEGUNDO PLANO: invalidar a página aberta faz a abertura E
  // os visuais abaixo da dobra buscarem de novo, mantendo o número atual na tela.
  useEffect(() => {
    if (!atual) return;
    const interval = setInterval(() => {
      if (!atualRef.current) return;
      marcaHora();
      void qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina(atualRef.current) });
      void qc.invalidateQueries({ queryKey: chavesDeConsulta.saude });
    }, ATUALIZA_SOZINHA_S * 1000);
    return () => clearInterval(interval);
  }, [atual, qc, marcaHora]);

  // ACHADOS #89/#90 — poller de quase-realtime: o servidor empurra por SSE quando
  // detecta mudança no Voalle. Nenhum dado chega pelo evento em si (só o id da
  // página). Toda combinação daquela página fica velha; a que está na tela busca de
  // novo na hora, e as outras quando voltarem a ser abertas.
  useEffect(() => {
    return assinaEventos((afetados) => {
      for (const id of afetados) void qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina(id) });
      if (atualRef.current && afetados.includes(atualRef.current)) {
        marcaHora();
        void qc.invalidateQueries({ queryKey: chavesDeConsulta.saude });
      }
    });
  }, [qc, marcaHora]);

  const atualiza = useCallback(() => {
    if (!atual) return;
    marcaHora();
    void qc.invalidateQueries({ queryKey: chavesDeConsulta.pagina(atual) });
    void qc.invalidateQueries({ queryKey: chavesDeConsulta.valores(atual) });
    void qc.invalidateQueries({ queryKey: chavesDeConsulta.saude });
  }, [atual, qc, marcaHora]);

  return { horaRealtime, atualiza };
}
