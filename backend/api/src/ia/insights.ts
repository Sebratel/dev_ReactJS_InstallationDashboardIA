// Camada de interpretação por IA: envia os números JÁ CALCULADOS pelo motor semântico
// ao provedor de IA configurado e devolve leitura operacional + prioridades.
// A IA NÃO calcula nada — ela apenas lê os agregados apurados pelo servidor.

import crypto from 'node:crypto';
import type { FiltroSpec } from '../../../packages/widget-engine/src/spec.ts';
import { relogioDeParede } from '../../../packages/measure-engine/src/relogio.ts';
import { ErroDeIa, type LojaDeIa } from './loja-ia.ts';
import {
  descreverRecorteParaIa,
  infoDoVisualIa,
  recortarVisualCalculado,
} from './visuais-ia.ts';

export interface InsightItemIa {
  readonly titulo: string;
  readonly detalhe: string;
  readonly acao: string;
  readonly gravidade: 'critico' | 'atencao' | 'positivo';
  readonly indicadores: readonly string[];
}

export interface RespostaInsightsIa {
  readonly resumo: string;
  readonly insights: readonly InsightItemIa[];
  readonly perguntas: readonly string[];
  readonly formatoInesperado?: boolean;
  readonly emCache?: boolean;
  readonly provedor: string;
  readonly modelo: string;
  readonly geradoEm: string;
  readonly pagina?: string;
  readonly visual?: string;
  readonly titulo?: string;
}

/**
 * System prompt do botão "Insights" no cabeçalho de cada gráfico/ranking/matriz:
 * segue exatamente a estrutura e o contrato JSON do Dashboard Comercial, adaptado
 * para a operação de Instalação, Agendamento Field e Manutenção Inicial da Sebratel.
 */
export const SISTEMA_VISUAL = `Você é analista sênior de dados de uma operação de instalação, agendamento field e manutenção de telecom (fibra óptica, rádio e telefonia) da Sebratel.

Recebe UM visual de um dashboard operacional: o título, o que ele representa na operação, os filtros ativos da tela e os dados JÁ AGREGADOS que estão desenhados nele. Sua função é ler esse visual como um analista de operações experiente leria — apontar o que salta aos olhos (gargalos de fila, desvios de SLA, quebras de agenda/improdutividade, sobrecarga ou ociosidade de slots, concentração por cidade/equipe/técnico, retrabalho de manutenção inicial em 30 dias), o que passa despercebido e o que merece investigação.

Regras:
- Use exclusivamente os números recebidos. Não estime, não complete, não recalcule e nunca invente valores.
- Comente o que ESTE visual mostra. Se a conclusão depender de um dado que não está aqui, transforme isso em pergunta em vez de afirmar.
- Prefira a comparação concreta ("caiu de 412 para 287 entre março e abril", "Canoas concentra 148 protocolos") ao adjetivo vago.
- Quando os dados vierem cortados no topo N ou nos últimos períodos, não trate o último listado como o menor de toda a operação.
- Nomes de técnicos instaladores, equipes e cidades podem ser citados quando o dado os traz.
- Escreva em português do Brasil, direto, sem jargão vazio e sem entusiasmo artificial.
- Não use emojis.

Responda SOMENTE com um JSON válido, sem cercas de código, neste formato:
{
  "resumo": "1 a 2 frases sobre o que este visual está dizendo no recorte atual",
  "insights": [
    {
      "titulo": "frase curta e específica",
      "detalhe": "2 a 3 frases com o número que sustenta a observação e a causa operacional provável",
      "acao": "o que fazer a respeito na operação/agendamento/campo, ou string vazia se não houver ação óbvia",
      "gravidade": "critico" | "atencao" | "positivo",
      "indicadores": ["número exato citado"]
    }
  ],
  "perguntas": ["pergunta operacional que este visual levanta mas não responde"]
}

Entregue de 2 a 4 insights, do mais relevante para o menos, e no máximo 2 perguntas.`;

/** Remove blocos de raciocínio e cercas markdown, e localiza o JSON principal mesmo com texto ao redor. */
function extrairCandidatoJson(texto: string): { limpo: string; candidato: string } {
  const semPensamento = String(texto || '')
    .replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, '')
    .trim();

  const cercado = semPensamento.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const limpo = (cercado ? cercado[1]! : semPensamento)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const inicioObj = limpo.indexOf('{');
  const inicioArr = limpo.indexOf('[');
  const inicio =
    inicioObj === -1
      ? inicioArr
      : inicioArr === -1
        ? inicioObj
        : Math.min(inicioObj, inicioArr);
  if (inicio === -1) return { limpo, candidato: limpo };

  // Caminha respeitando strings para achar o fechamento exato do primeiro JSON completo, se houver.
  const pilha: ('}' | ']')[] = [];
  let emString = false;
  let escapado = false;
  for (let i = inicio; i < limpo.length; i++) {
    const ch = limpo[i]!;
    if (escapado) {
      escapado = false;
      continue;
    }
    if (emString) {
      if (ch === '\\') escapado = true;
      else if (ch === '"') emString = false;
      continue;
    }
    if (ch === '"') {
      emString = true;
    } else if (ch === '{') {
      pilha.push('}');
    } else if (ch === '[') {
      pilha.push(']');
    } else if ((ch === '}' || ch === ']') && pilha.length > 0) {
      if (pilha[pilha.length - 1] === ch) {
        pilha.pop();
        if (pilha.length === 0) {
          return { limpo, candidato: limpo.slice(inicio, i + 1) };
        }
      }
    }
  }
  return { limpo, candidato: limpo.slice(inicio) };
}

/** Tenta fechar um JSON truncado preservando apenas itens/campos completos. */
function tentarParseJsonTolerante(candidato: string): Record<string, unknown> | null {
  const tentativas = [candidato, candidato.replace(/,\s*([}\]])/g, '$1')];
  for (const t of tentativas) {
    try {
      const parsed = JSON.parse(t) as unknown;
      const obj = Array.isArray(parsed) ? parsed[0] : parsed;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {
      /* tenta recuperação de truncamento abaixo */
    }
  }

  // Recuperação de resposta cortada no meio (ex.: MAX_TOKENS): guarda pontos seguros
  // onde um item de array ou propriedade foi fechado antes do corte.
  const pontosSeguros: { fim: number; fechar: string }[] = [];
  const pilha: ('}' | ']')[] = [];
  let emString = false;
  let escapado = false;

  for (let i = 0; i < candidato.length; i++) {
    const ch = candidato[i]!;
    if (escapado) {
      escapado = false;
      continue;
    }
    if (emString) {
      if (ch === '\\') escapado = true;
      else if (ch === '"') emString = false;
      continue;
    }
    if (ch === '"') {
      emString = true;
    } else if (ch === '{') {
      pilha.push('}');
    } else if (ch === '[') {
      pilha.push(']');
    } else if ((ch === '}' || ch === ']') && pilha.length > 0) {
      if (pilha[pilha.length - 1] === ch) {
        pilha.pop();
        pontosSeguros.push({ fim: i + 1, fechar: [...pilha].reverse().join('') });
      }
    } else if (ch === ',' && pilha.length > 0 && pilha.length <= 2) {
      pontosSeguros.push({ fim: i, fechar: [...pilha].reverse().join('') });
    }
  }

  // Caso especial: cortou ainda dentro da string de `"resumo"` antes de qualquer ponto seguro.
  if (pontosSeguros.length === 0 && pilha.length > 0) {
    const fechado =
      (emString ? (escapado ? candidato.slice(0, -1) : candidato) + '"' : candidato) +
      [...pilha].reverse().join('');
    try {
      const parsed = JSON.parse(fechado) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  for (let i = pontosSeguros.length - 1; i >= 0; i--) {
    const { fim, fechar } = pontosSeguros[i]!;
    const trecho = candidato.slice(0, fim).replace(/,\s*$/, '') + fechar;
    try {
      const parsed = JSON.parse(trecho) as unknown;
      const obj = Array.isArray(parsed) ? parsed[0] : parsed;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {
      /* tenta o ponto seguro anterior */
    }
  }

  return null;
}

function normalizaGravidade(bruto: unknown): 'critico' | 'atencao' | 'positivo' {
  const s = String(bruto ?? 'atencao')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (s === 'critico' || s === 'critica') return 'critico';
  if (s === 'positivo' || s === 'positiva') return 'positivo';
  return 'atencao';
}

/** Converte a resposta do modelo em objeto estruturado, tolerando cercas, texto solto e JSON truncado. */
export function interpretarRespostaIa(
  texto: string,
  cfg: { tipo: string; modelo: string },
  agora: Date = new Date(),
): RespostaInsightsIa {
  const { limpo, candidato } = extrairCandidatoJson(texto);
  const assinatura = {
    provedor: cfg.tipo,
    modelo: cfg.modelo,
    geradoEm: agora.toISOString(),
  };

  const parsed = tentarParseJsonTolerante(candidato);
  if (parsed) {
    const insightsBrutos = Array.isArray(parsed.insights)
      ? (parsed.insights as Record<string, unknown>[])
      : [];
    const insights: InsightItemIa[] = insightsBrutos
      .filter((i) => i && typeof i === 'object' && typeof i.titulo === 'string')
      .map((i) => ({
        titulo: String(i.titulo ?? 'Observação'),
        detalhe: String(i.detalhe ?? ''),
        acao: typeof i.acao === 'string' ? i.acao : '',
        gravidade: normalizaGravidade(i.gravidade),
        indicadores: Array.isArray(i.indicadores) ? i.indicadores.map((x) => String(x)) : [],
      }));
    const perguntas = Array.isArray(parsed.perguntas)
      ? parsed.perguntas.map((p) => String(p)).filter(Boolean)
      : [];
    const resumo = typeof parsed.resumo === 'string' ? parsed.resumo.trim() : '';

    if (resumo || insights.length > 0) {
      return {
        resumo,
        insights,
        perguntas,
        ...assinatura,
      };
    }
  }

  return {
    resumo: limpo.slice(0, 1200),
    insights: [],
    perguntas: [],
    formatoInesperado: true,
    ...assinatura,
  };
}

function extrairNumeros(valor: unknown, saida: number[] = []): number[] {
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    saida.push(valor);
    return saida;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) extrairNumeros(item, saida);
    return saida;
  }
  if (valor && typeof valor === 'object') {
    for (const v of Object.values(valor as Record<string, unknown>)) {
      extrairNumeros(v, saida);
    }
  }
  return saida;
}

/**
 * Detecta "mudança radical" entre os dados que geraram o insight em cache e os atuais:
 * - mudança de quantidade de pontos/números >= 20%;
 * - mudança na soma absoluta total >= 20%;
 * - ou qualquer número relevante (|antigo| >= 5 ou >= 0.05) variando >= 25%.
 */
export function houveMudancaRadical(anteriores: readonly number[], atuais: readonly number[]): boolean {
  if (anteriores.length === 0 && atuais.length === 0) return false;
  if (anteriores.length !== atuais.length) {
    const base = Math.max(anteriores.length, 1);
    if (Math.abs(atuais.length - anteriores.length) / base >= 0.2) return true;
  }
  const somaAnt = anteriores.reduce((acc, n) => acc + Math.abs(n), 0);
  const somaAtu = atuais.reduce((acc, n) => acc + Math.abs(n), 0);
  if (somaAnt > 0 && Math.abs(somaAtu - somaAnt) / somaAnt >= 0.2) return true;
  if (somaAnt === 0 && somaAtu > 0) return true;

  const n = Math.min(anteriores.length, atuais.length);
  for (let i = 0; i < n; i++) {
    const a = anteriores[i]!;
    const b = atuais[i]!;
    const mag = Math.max(Math.abs(a), Math.abs(b));
    if (mag === 0) continue;
    // Ignora oscilações pequenas em contagens unitárias (ex.: 1 -> 2), mas pega variações percentuais/métricas.
    if (Math.abs(a) < 5 && Math.abs(a) >= 1 && Math.abs(b) < 5 && Math.abs(b) >= 1) continue;
    if (Math.abs(b - a) / Math.max(Math.abs(a), 1e-6) >= 0.25) return true;
  }
  return false;
}

interface EntradaCacheIa {
  readonly dia: string;
  readonly numeros: readonly number[];
  readonly resposta: RespostaInsightsIa;
}

export interface ArmazenamentoCacheIa {
  le<T>(chave: string): Promise<T | null | undefined>;
  guarda<T>(chave: string, valor: T, ttlSegundos: number): Promise<void>;
}

/** Segundos restantes até a meia-noite em Brasília (piso 60 s). */
function ttlAteFimDoDiaS(agora: Date): number {
  const brt = relogioDeParede(agora);
  const segsDoDia =
    brt.getUTCHours() * 3600 + brt.getUTCMinutes() * 60 + brt.getUTCSeconds();
  return Math.max(60, 86_400 - segsDoDia);
}

function chaveExterna(chave: string): string {
  const hash = crypto.createHash('sha256').update(chave).digest('hex').slice(0, 32);
  return `ia:insights:v1:${hash}`;
}

/**
 * Cache compartilhado de leituras de IA (memória + Redis quando configurado):
 * - reutiliza a leitura já gerada no mesmo dia (fuso de Brasília) para economizar tokens;
 * - invalida automaticamente na virada do dia ou se houver mudança radical nos números do visual;
 * - deduplica chamadas simultâneas para a mesma chave.
 */
export class CacheInsightsIa {
  readonly #entradas = new Map<string, EntradaCacheIa>();
  readonly #emVoo = new Map<string, Promise<RespostaInsightsIa>>();
  readonly #maxEntradas: number;
  readonly #armazenamento: ArmazenamentoCacheIa | undefined;

  constructor(opcoes: number | { maxEntradas?: number; armazenamento?: ArmazenamentoCacheIa } = 500) {
    const max = typeof opcoes === 'number' ? opcoes : (opcoes.maxEntradas ?? 500);
    this.#maxEntradas = Math.max(10, max);
    this.#armazenamento = typeof opcoes === 'number' ? undefined : opcoes.armazenamento;
  }

  async obtemSeValido(
    chave: string,
    dia: string,
    numerosAtuais: readonly number[],
  ): Promise<RespostaInsightsIa | null> {
    let hit = this.#entradas.get(chave);
    if (!hit && this.#armazenamento) {
      const externo = await this.#armazenamento.le<EntradaCacheIa>(chaveExterna(chave)).catch(() => null);
      if (externo && typeof externo === 'object' && externo.resposta) {
        hit = externo;
      }
    }
    if (!hit) return null;
    if (hit.dia !== dia || houveMudancaRadical(hit.numeros, numerosAtuais)) {
      this.#entradas.delete(chave);
      return null;
    }
    // Atualiza ordem LRU em memória
    this.#entradas.delete(chave);
    this.#entradas.set(chave, hit);
    return { ...hit.resposta, emCache: true };
  }

  async grava(
    chave: string,
    dia: string,
    numeros: readonly number[],
    resposta: RespostaInsightsIa,
    agora: Date = new Date(),
  ): Promise<void> {
    if (resposta.formatoInesperado) return;
    const entrada: EntradaCacheIa = { dia, numeros, resposta };
    if (this.#entradas.has(chave)) this.#entradas.delete(chave);
    this.#entradas.set(chave, entrada);
    while (this.#entradas.size > this.#maxEntradas) {
      const maisAntiga = this.#entradas.keys().next().value;
      if (maisAntiga === undefined) break;
      this.#entradas.delete(maisAntiga);
    }
    if (this.#armazenamento) {
      await this.#armazenamento
        .guarda(chaveExterna(chave), entrada, ttlAteFimDoDiaS(agora))
        .catch(() => undefined);
    }
  }

  emVooOuExecuta(chave: string, fn: () => Promise<RespostaInsightsIa>): Promise<RespostaInsightsIa> {
    const p = this.#emVoo.get(chave);
    if (p) return p;
    const nova = fn().finally(() => this.#emVoo.delete(chave));
    this.#emVoo.set(chave, nova);
    return nova;
  }

  get tamanho(): number {
    return this.#entradas.size;
  }
}

export async function gerarInsightsDoVisual(opcoes: {
  loja: LojaDeIa | undefined;
  pagina: string;
  visualId: string;
  visualCalculado: {
    id: string;
    tipo: string;
    conteudo: 'card' | 'tabela' | 'grafico' | 'matriz' | null;
    dados?: unknown;
  };
  filtros: readonly FiltroSpec[];
  clicados: readonly { tabela: string; coluna: string }[];
  agora?: Date;
  cache?: CacheInsightsIa;
}): Promise<RespostaInsightsIa> {
  const info = infoDoVisualIa(opcoes.pagina, opcoes.visualId);
  if (!info) {
    throw new ErroDeIa(404, 'Visual desconhecido ou sem leitura de IA habilitada.');
  }
  const ativo = await opcoes.loja?.provedorAtivo();
  if (!ativo) {
    throw new ErroDeIa(
      503,
      'Nenhum provedor de IA configurado. Um administrador pode cadastrar a chave em Acessos → Provedor de IA.',
    );
  }

  const agora = opcoes.agora ?? new Date();
  const dia = relogioDeParede(agora).toISOString().slice(0, 10);
  const dadosRecortados = recortarVisualCalculado(opcoes.visualCalculado);
  const descricaoRecorte = descreverRecorteParaIa(
    opcoes.pagina,
    opcoes.filtros,
    opcoes.clicados,
  );
  const numeros = extrairNumeros(dadosRecortados);
  const chaveCache = `${opcoes.pagina}:${opcoes.visualId}:${ativo.cfg.tipo}:${ativo.cfg.modelo}:${descricaoRecorte}`;

  const emCache = await opcoes.cache?.obtemSeValido(chaveCache, dia, numeros);
  if (emCache) return emCache;

  const executa = async (): Promise<RespostaInsightsIa> => {
    const promptUsuario = [
      `Visual: ${info.titulo}`,
      `O que ele mostra: ${info.oQueE}`,
      descricaoRecorte,
      '',
      'Dados desenhados no visual:',
      JSON.stringify(dadosRecortados, null, 1),
    ].join('\n');

    let texto: string;
    try {
      texto = await ativo.provedor.conversar(SISTEMA_VISUAL, promptUsuario, { json: true });
    } catch (err) {
      throw new ErroDeIa(502, (err as Error).message || 'Falha ao consultar o provedor de IA.');
    }

    const interpretado = interpretarRespostaIa(texto, ativo.cfg, agora);
    const resposta: RespostaInsightsIa = {
      ...interpretado,
      pagina: opcoes.pagina,
      visual: opcoes.visualId,
      titulo: info.titulo,
    };
    await opcoes.cache?.grava(chaveCache, dia, numeros, resposta, agora);
    return resposta;
  };

  return opcoes.cache ? opcoes.cache.emVooOuExecuta(chaveCache, executa) : executa();
}
