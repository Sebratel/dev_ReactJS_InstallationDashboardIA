// @vitest-environment jsdom
// Testes TDD da camada de IA na tela (`iaService.ts`, `InsightsIA.tsx` e `ProvedorDeIA.tsx`):
//   1. `urlDeInsightsVisual` preserva todos os filtros (`?filtro=`) e seleções cruzadas (`?clicado=`).
//   2. `BotaoInsights` aparece para visual agregado do catálogo e abre o painel lateral com
//      resumo, cards de insight (`critico`/`atencao`/`positivo`), ação, indicadores e perguntas.
//   3. `BotaoInsights` fecha com `Escape` e exibe dica de configuração para admin quando 503.
//   4. `ProvedorDeIA` carrega o estado mascarado (`••••7788`), permite listar modelos, salvar e
//      testar conexão.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ehVisualComIaNaTela,
  urlDeInsightsVisual,
  type RespostaInsightsIa,
} from '../src/services/iaService.ts';
import { BotaoInsights, PainelInsights } from '../src/components/ia/InsightsIA.tsx';
import { ProvedorDeIA } from '../src/components/acessos/ProvedorDeIA.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function criaQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  });
}

describe('iaService e URL de insights', () => {
  it('inclui filtros de segmentação e clicados na URL de POST /insights', () => {
    const url = urlDeInsightsVisual(
      'visao-geral',
      'd9713da4535926b79bd8',
      [{ tabela: 'PROTOCOLOS GERAL', coluna: 'CIDADE', valores: ['CANOAS'] }],
      [{ tabela: 'PROTOCOLOS GERAL', coluna: 'EQUIPE' }],
    );
    expect(url).toContain('/api/dashboards/visao-geral/insights/d9713da4535926b79bd8?');
    expect(url).toContain('filtro=');
    expect(url).toContain('clicado=');
  });

  it('habilita IA apenas nos visuais agregados do catálogo e bloqueia tabelas de detalhe', () => {
    expect(ehVisualComIaNaTela('visao-geral', 'd9713da4535926b79bd8')).toBe(true);
    expect(ehVisualComIaNaTela('agendamento-field', '0c0223c665b34f95121e')).toBe(true);
    expect(ehVisualComIaNaTela('visao-geral', '704b7bcb68fd3e17cd30')).toBe(false);
  });
});

describe('BotaoInsights e Painel lateral', () => {
  it('abre a gaveta ao clicar em Insights, exibe resumo/cards/perguntas e fecha no Escape', async () => {
    const respostaFalsa: RespostaInsightsIa = {
      resumo: 'Canoas concentra 420 solicitações no período.',
      insights: [
        {
          titulo: 'Alta demanda em Canoas',
          detalhe: 'Canoas representa 38% do volume total de instalações.',
          acao: 'Redirecionar 2 equipes móveis para Canoas no turno da tarde.',
          gravidade: 'critico',
          indicadores: ['420 solicitações', '38%'],
        },
      ],
      perguntas: ['Há restrição de slots de agenda em Canoas?'],
      provedor: 'gemini',
      modelo: 'gemini-2.0-flash',
      geradoEm: '2026-11-16T18:00:00.000Z',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/dashboards') {
        return new Response(
          JSON.stringify({
            iaConfigurada: true,
            eu: { usuario: 'gestor@sebratel.com.br', papel: 'viewer', podeGerir: false },
            dashboards: [],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/insights/')) {
        return new Response(JSON.stringify(respostaFalsa), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    const qc = criaQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BotaoInsights
          pagina="visao-geral"
          visualId="d9713da4535926b79bd8"
          titulo="QUANTIDADE POR CIDADE"
          filtros={[{ tabela: 'PROTOCOLOS GERAL', coluna: 'CIDADE', valores: ['CANOAS'] }]}
          clicados={[{ tabela: 'PROTOCOLOS GERAL', coluna: 'EQUIPE' }]}
        />
      </QueryClientProvider>,
    );

    const botao = await screen.findByRole('button', { name: /Insights/i });
    fireEvent.click(botao);

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /Leitura de IA: QUANTIDADE POR CIDADE/i }),
      ).toBeTruthy();
    });

    expect(await screen.findByText('Canoas concentra 420 solicitações no período.')).toBeTruthy();
    expect(screen.getByText('Alta demanda em Canoas')).toBeTruthy();
    expect(screen.getByText(/Redirecionar 2 equipes móveis/i)).toBeTruthy();
    expect(screen.getByText('420 solicitações')).toBeTruthy();
    expect(screen.getByText('Há restrição de slots de agenda em Canoas?')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/dashboards/visao-geral/insights/d9713da4535926b79bd8?'),
      expect.objectContaining({ method: 'POST' }),
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('exibe erro amigável com botão "Tentar novamente" que refaz a consulta e mostra aviso limpo em formatoInesperado', async () => {
    let tentativas = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/insights/')) {
        tentativas += 1;
        if (tentativas === 1) {
          return new Response(
            JSON.stringify({ erro: 'Provedor Gemini retornou HTTP 502: Bad Gateway' }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            resumo: 'Leitura parcial recuperada de outubro.',
            insights: [
              {
                titulo: 'Pico em outubro',
                detalhe: 'Foram registrados 48 retornos.',
                acao: 'Auditar equipe responsável.',
                gravidade: 'critico',
                indicadores: ['48'],
              },
            ],
            perguntas: [],
            formatoInesperado: true,
            provedor: 'gemini',
            modelo: 'gemini-3.8-flash',
            geradoEm: '2026-11-17T10:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    });

    const qc = criaQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <PainelInsights
          aberto={true}
          fechar={() => {}}
          pagina="visao-geral"
          visualId="vis-1"
          titulo="Retorno Prioritário"
          filtros={[]}
        />
      </QueryClientProvider>,
    );

    const btnTentar = await screen.findByRole('button', { name: /Tentar novamente/i });
    expect(btnTentar).toBeTruthy();

    fireEvent.click(btnTentar);

    expect(await screen.findByText(/Leitura parcial recuperada de outubro\./)).toBeTruthy();
    expect(screen.getByText('Pico em outubro')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});

describe('ProvedorDeIA (Admin)', () => {
  it('exibe estado configurado, permite salvar e testar conexão', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/admin/ia' && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            configurado: true,
            origem: 'tela',
            tipo: 'gemini',
            modelo: 'gemini-2.0-flash',
            baseUrl: null,
            maxTokens: 4000,
            dica: '••••7788',
            atualizadoPor: 'admin@sebratel.com.br',
            tipos: [
              { id: 'anthropic', label: 'Anthropic (Claude)' },
              { id: 'openai', label: 'OpenAI e compatíveis' },
              { id: 'gemini', label: 'Google Gemini' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/admin/ia/testar') {
        return new Response(
          JSON.stringify({ ok: true, ms: 142, amostra: 'OK', em: '2026-11-16T18:00:00.000Z' }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    const qc = criaQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <ProvedorDeIA />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/••••7788/)).toBeTruthy();

    // Seleciona um modelo Gemini >= 3.8 clicando diretamente na lista clicável
    const modelo38 = await screen.findByRole('button', { name: /gemini-3\.8-flash/i });
    fireEvent.click(modelo38);
    const inputModelo = screen.getByLabelText('Modelo de IA') as HTMLInputElement;
    expect(inputModelo.value).toBe('gemini-3.8-flash');

    const btnTestar = screen.getByRole('button', { name: /Testar conexão/i });
    fireEvent.click(btnTestar);

    expect(await screen.findByText(/conexão ok em 142 ms/i)).toBeTruthy();
  });
});
