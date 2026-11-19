// @vitest-environment jsdom
//
// Aba "Operação ao vivo": clicar num técnico da lista "Quem está em quê" tem de achá-lo no
// mapa ao lado — zoom no ponto dele, etiqueta aberta. Clicar de novo solta o foco, e quem
// está sem ponto de GPS na última hora ganha um aviso, em vez de um mapa parado.
//
// O mapa roda de verdade (Leaflet em jsdom); o teste olha o DOM da etiqueta e o estado do
// mapa. O último teste é o defeito que o Erick viu em 19/11/2026: o zoom chegava e a
// atualização seguinte (o conjunto de técnicos com GPS muda a cada minuto) o desfazia.

import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import L from 'leaflet';
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
const COLEGA = tecnico({
  tec_id: 3,
  nome: 'Eliel Machado Teixeira',
  curto: 'Eliel Machado',
  lat: -29.7,
  lng: -51.1,
});
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
  tecnicos: [COM_GPS, COLEGA, SEM_GPS],
  ritmo: [],
  calor: [],
  qualidade: [],
  retrabalhoPorMes: [],
  insights: [],
  premiacao: { tecnicos: [], faixas: [], diasRestantes: 8, restoHoje: null },
  mes: { realizado: 120, p50: null, meta: null, mesmoPontoMesAnterior: 100, totalMesAnterior: 200 },
  geradoEm: '2026-11-19T13:05:00.000Z',
};

/** O que o hook devolve agora — trocado nos testes para simular a atualização de 60 s. */
let dados: RespostaOperacao = resposta;

vi.mock('../src/hooks/useInsights.ts', () => ({
  useOperacao: () => ({ isPending: false, isError: false, data: dados }),
}));

const { default: Operacao } = await import('../src/components/insights/Operacao.tsx');

afterEach(() => {
  cleanup();
  dados = resposta;
  vi.restoreAllMocks();
});

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

/** Captura a instância do mapa espiando o `setView`, que todo caminho acaba chamando. */
function espiaOMapa(): { mapa: () => L.Map } {
  const mapas: L.Map[] = [];
  const original = L.Map.prototype.setView;
  vi.spyOn(L.Map.prototype, 'setView').mockImplementation(function (
    this: L.Map,
    ...args: Parameters<typeof original>
  ) {
    mapas.push(this);
    return original.apply(this, args);
  });
  return {
    mapa: () => {
      const ultimo = mapas.at(-1);
      if (!ultimo) throw new Error('o mapa não chegou a ser posicionado');
      return ultimo;
    },
  };
}

test('o clique leva o mapa ao ponto do técnico, com zoom', () => {
  const espiao = espiaOMapa();
  render(<Operacao />);
  const mapa = espiao.mapa();
  expect(mapa.getZoom()).toBeLessThan(15); // enquadramento geral, os dois pontos na tela

  fireEvent.click(screen.getByRole('button', { name: 'Kana Rosa' }));
  expect(mapa.getZoom()).toBeGreaterThanOrEqual(15);
  expect(mapa.getCenter().lat).toBeCloseTo(-29.92, 3);
  expect(mapa.getCenter().lng).toBeCloseTo(-51.18, 3);
});

test('a atualização dos dados não desfaz o zoom do técnico escolhido', () => {
  const espiao = espiaOMapa();
  const { rerender } = render(<Operacao />);
  const mapa = espiao.mapa();
  fireEvent.click(screen.getByRole('button', { name: 'Kana Rosa' }));
  expect(mapa.getZoom()).toBeGreaterThanOrEqual(15);

  // Um minuto depois: o colega perdeu o sinal, o CONJUNTO de pontos mudou. Era aqui que o
  // reenquadramento automático jogava o mapa de volta na região inteira.
  dados = {
    ...resposta,
    tecnicos: [COM_GPS, { ...COLEGA, lat: null, lng: null, sinalHaMin: null }, SEM_GPS],
  };
  rerender(<Operacao />);
  expect(mapa.getZoom()).toBeGreaterThanOrEqual(15);
  expect(mapa.getCenter().lat).toBeCloseTo(-29.92, 3);
});

test('sem técnico escolhido, a atualização reenquadra a região como antes', () => {
  const espiao = espiaOMapa();
  const { rerender } = render(<Operacao />);
  const mapa = espiao.mapa();
  const antes = mapa.getCenter().lat;

  dados = { ...resposta, tecnicos: [COM_GPS, SEM_GPS] };
  rerender(<Operacao />);
  // Sobrou um ponto só: o mapa centra nele, em vez de ficar no meio dos dois.
  expect(mapa.getCenter().lat).not.toBeCloseTo(antes, 3);
  expect(mapa.getCenter().lat).toBeCloseTo(-29.92, 3);
});

test('o mapa acompanha o técnico escolhido quando ele anda', () => {
  const espiao = espiaOMapa();
  const { rerender } = render(<Operacao />);
  const mapa = espiao.mapa();
  fireEvent.click(screen.getByRole('button', { name: 'Kana Rosa' }));

  dados = { ...resposta, tecnicos: [{ ...COM_GPS, lat: -29.95 }, COLEGA, SEM_GPS] };
  rerender(<Operacao />);
  expect(mapa.getCenter().lat).toBeCloseTo(-29.95, 3);
});
