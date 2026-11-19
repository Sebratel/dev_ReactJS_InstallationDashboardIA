// @vitest-environment jsdom
//
// Aba "Operação ao vivo": clicar num técnico da lista "Quem está em quê" tem de achá-lo no
// mapa ao lado — etiqueta aberta no ponto dele. Clicar de novo solta o foco, e quem está
// sem ponto de GPS na última hora ganha um aviso, em vez de um mapa parado sem explicação.
//
// O mapa roda de verdade (Leaflet em jsdom); o que o teste olha é o DOM da etiqueta.

import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RespostaOperacao, TecnicoAgora } from '../src/services/insightsService.ts';

const tecnico = (p: Partial<TecnicoAgora> & Pick<TecnicoAgora, 'tec_id' | 'nome' | 'curto'>) => ({
  base: 'Canoas',
  situacao: 'execucao' as const,
  semSinal: false,
  desde: 12,
  protocolo: null,
  proximoAs: null,
  lat: -29.92,
  lng: -51.18,
  sinalHaMin: 2,
  agendados: 3,
  concluidos: 0,
  semSucesso: 0,
  hoje: 0,
  mes: 50,
  faixa: null,
  ...p,
});

const COM_GPS = tecnico({ tec_id: 1, nome: 'Kana Rosa da Silva', curto: 'Kana Rosa' });
const SEM_GPS = tecnico({
  tec_id: 2,
  nome: 'Diego Boardaman Souza',
  curto: 'Diego Boardaman',
  lat: null,
  lng: null,
  sinalHaMin: null,
  semSinal: true,
});

const resposta: RespostaOperacao = {
  agora: { data: '2026-11-19', hora: 10, minuto: 5 },
  kpis: {
    ativacoesHoje: 12,
    movimentacoesHoje: 3,
    esperadoAteAgora: 10,
    tipicoAteAgora: 11,
    estimativaHoje: 40,
    previstoHoje: 38,
    agenda: {
      concluido: 5,
      execucao: 2,
      aCaminho: 1,
      aguardando: 4,
      semSucesso: 0,
      total: 12,
      slotsLivres: 3,
      ativacoes: 9,
    },
    tecnicosEscalados: 2,
    tecnicosComSinal: 1,
    tecnicosEmExecucao: 2,
    tecnicosACaminho: 0,
    prazoMedianoDias: 2,
    instaladoAte2Dias: 0.8,
    retrabalho30d: 0.04,
    execucaoMediana: 45,
    deslocamentoMediano: 20,
  },
  agendaPorBase: [],
  tecnicos: [COM_GPS, SEM_GPS],
  ritmo: [],
  calor: [],
  qualidade: [],
  retrabalhoPorMes: [],
  insights: [],
  premiacao: { tecnicos: [], faixas: [], diasRestantes: 8, restoHoje: null },
  mes: { realizado: 120, p50: null, meta: null, mesmoPontoMesAnterior: 100, totalMesAnterior: 200 },
  geradoEm: '2026-11-19T13:05:00.000Z',
};

vi.mock('../src/hooks/useInsights.ts', () => ({
  useOperacao: () => ({ isPending: false, isError: false, data: resposta }),
}));

const { default: Operacao } = await import('../src/components/insights/Operacao.tsx');

afterEach(cleanup);

// No jsdom todo elemento tem tamanho zero, e o Leaflet não desenha ponto nenhum num mapa
// sem área. Um tamanho fixo basta para os marcadores entrarem no DOM.
beforeAll(() => {
  for (const prop of ['clientWidth', 'offsetWidth'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 600 });
  }
  for (const prop of ['clientHeight', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: 400 });
  }
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      width: 600,
      height: 400,
      top: 0,
      left: 0,
      right: 600,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
});

test('clicar no técnico abre a etiqueta dele no mapa e clicar de novo solta o foco', () => {
  render(<Operacao />);
  const botao = screen.getByRole('button', { name: 'Kana Rosa' });
  expect(botao.getAttribute('aria-pressed')).toBe('false');
  // Antes do clique nenhuma etiqueta está presa: o nome completo só está no `title` da célula.
  expect(screen.queryByText('Kana Rosa da Silva')).toBeNull();

  fireEvent.click(botao);
  expect(botao.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Kana Rosa da Silva')).toBeTruthy();

  fireEvent.click(botao);
  expect(botao.getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByText('Kana Rosa da Silva')).toBeNull();
});

test('clicar na linha inteira também foca, e uma só vez', () => {
  render(<Operacao />);
  const botao = screen.getByRole('button', { name: 'Kana Rosa' });
  const linha = botao.closest('tr');
  expect(linha).toBeTruthy();
  fireEvent.click(linha as HTMLElement);
  expect(botao.getAttribute('aria-pressed')).toBe('true');
});

test('técnico sem ponto de GPS na última hora é avisado em vez de sumir sem explicação', () => {
  render(<Operacao />);
  fireEvent.click(screen.getByRole('button', { name: 'Diego Boardaman' }));
  expect(screen.getByText(/Diego Boardaman está sem ponto de GPS/)).toBeTruthy();
});
