// Camada desacoplada de LLM — mesma arquitetura do Dashboard Comercial (`server/src/ia/provedor.js`).
// Três dialetos, uma interface:
//   anthropic — API de mensagens (/v1/messages)
//   openai    — /chat/completions (cobre OpenAI, Groq, OpenRouter, Azure, Together e servidores locais)
//   gemini    — generateContent do Google

export const TIPOS_IA = ['anthropic', 'openai', 'gemini'] as const;
export type TipoProvedorIa = (typeof TIPOS_IA)[number];

export const ROTULO_TIPO_IA: Record<TipoProvedorIa, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI e compatíveis',
  gemini: 'Google Gemini',
};

export interface ConfigProvedorIa {
  readonly tipo: TipoProvedorIa;
  readonly modelo: string;
  readonly chave: string;
  readonly baseUrl: string | null;
  readonly maxTokens: number;
  readonly origem: 'tela' | 'env';
}

export interface ModeloDisponivelIa {
  readonly id: string;
  readonly label: string;
}

export interface OpcoesConversaIa {
  readonly json?: boolean;
}

export interface ProvedorIa {
  readonly nome: TipoProvedorIa;
  conversar(sistema: string, pergunta: string, opcoes?: OpcoesConversaIa): Promise<string>;
  modelos(): Promise<ModeloDisponivelIa[]>;
}

const TIMEOUT_PADRAO_MS = Number(process.env.AI_TIMEOUT_MS) || 90_000;

const limpaBarra = (u: string): string => {
  let s = String(u);
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s;
};

const ehErroTransitorioIa = (status: number, msg: string): boolean =>
  status === 429 ||
  status === 500 ||
  status === 502 ||
  status === 503 ||
  status === 504 ||
  /high demand|overloaded|temporarily unavailable|rate limit/i.test(msg);

const ehModeloIndisponivel = (status: number, msg: string): boolean =>
  status === 404 || /no longer available|not found|deprecated/i.test(msg);

class ErroHttpIa extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function pedir(
  url: string,
  corpo: unknown,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  tentativas = 2,
): Promise<Record<string, unknown>> {
  let ultimoErro: unknown;
  for (let i = 0; i <= tentativas; i++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_PADRAO_MS);
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(corpo),
        signal: abort.signal,
      });
      const texto = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(texto) as Record<string, unknown>;
      } catch {
        /* resposta não-JSON */
      }
      if (!res.ok) {
        const err = json.error as string | { message?: string } | undefined;
        const detalhe = typeof err === 'string' ? err : err?.message;
        const msg = detalhe || texto.slice(0, 300) || `HTTP ${res.status}`;
        if (i < tentativas && ehErroTransitorioIa(res.status, msg)) {
          await new Promise((r) => setTimeout(r, 700 * (i + 1)));
          continue;
        }
        throw new ErroHttpIa(res.status, msg);
      }
      return json;
    } catch (e) {
      if (abort.signal.aborted) {
        ultimoErro = new Error(`O provedor de IA não respondeu em ${Math.round(TIMEOUT_PADRAO_MS / 1000)}s.`);
        break;
      }
      ultimoErro = e;
      if (e instanceof ErroHttpIa) break;
      if (i < tentativas) {
        await new Promise((r) => setTimeout(r, 700 * (i + 1)));
        continue;
      }
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro));
}

async function buscar(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30_000);
  try {
    const res = await fetchFn(url, { headers, signal: abort.signal });
    const texto = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(texto) as Record<string, unknown>;
    } catch {
      /* resposta não-JSON */
    }
    if (!res.ok) {
      const err = json.error as string | { message?: string } | undefined;
      const detalhe = typeof err === 'string' ? err : err?.message;
      throw new Error(detalhe || texto.slice(0, 300) || `HTTP ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function anthropic(cfg: ConfigProvedorIa, fetchFn: typeof fetch): ProvedorIa {
  return {
    nome: 'anthropic',
    async conversar(sistema: string, pergunta: string): Promise<string> {
      const base = limpaBarra(cfg.baseUrl || 'https://api.anthropic.com');
      const json = await pedir(
        `${base}/v1/messages`,
        {
          model: cfg.modelo,
          max_tokens: cfg.maxTokens || 4000,
          system: sistema,
          messages: [{ role: 'user', content: pergunta }],
        },
        {
          'x-api-key': cfg.chave,
          'anthropic-version': '2023-06-01',
        },
        fetchFn,
      );
      const blocos = Array.isArray(json.content) ? (json.content as { type?: string; text?: string }[]) : [];
      return blocos
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text!)
        .join('\n');
    },
    async modelos(): Promise<ModeloDisponivelIa[]> {
      const base = limpaBarra(cfg.baseUrl || 'https://api.anthropic.com');
      const json = await buscar(
        `${base}/v1/models?limit=100`,
        {
          'x-api-key': cfg.chave,
          'anthropic-version': '2023-06-01',
        },
        fetchFn,
      );
      const data = Array.isArray(json.data) ? (json.data as { id?: string; display_name?: string }[]) : [];
      return data
        .filter((m) => typeof m.id === 'string' && m.id !== '')
        .map((m) => ({ id: m.id!, label: m.display_name || m.id! }));
    },
  };
}

function openai(cfg: ConfigProvedorIa, fetchFn: typeof fetch): ProvedorIa {
  return {
    nome: 'openai',
    async conversar(sistema: string, pergunta: string): Promise<string> {
      const base = limpaBarra(cfg.baseUrl || 'https://api.openai.com/v1');
      const json = await pedir(
        `${base}/chat/completions`,
        {
          model: cfg.modelo,
          max_completion_tokens: cfg.maxTokens || 4000,
          messages: [
            { role: 'system', content: sistema },
            { role: 'user', content: pergunta },
          ],
        },
        { authorization: `Bearer ${cfg.chave}` },
        fetchFn,
      );
      const choices = Array.isArray(json.choices)
        ? (json.choices as { message?: { content?: string } }[])
        : [];
      return choices[0]?.message?.content || '';
    },
    async modelos(): Promise<ModeloDisponivelIa[]> {
      const base = limpaBarra(cfg.baseUrl || 'https://api.openai.com/v1');
      const json = await buscar(`${base}/models`, { authorization: `Bearer ${cfg.chave}` }, fetchFn);
      const dados = (Array.isArray(json.data) ? (json.data as { id?: string }[]) : []).filter(
        (m): m is { id: string } => typeof m.id === 'string' && m.id !== '',
      );
      const conversam = dados.filter((m) =>
        /gpt|^o\d|chat|llama|mistral|qwen|claude|gemini|deepseek/i.test(m.id),
      );
      return (conversam.length ? conversam : dados)
        .map((m) => ({ id: m.id, label: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}

function gemini(cfg: ConfigProvedorIa, fetchFn: typeof fetch): ProvedorIa {
  return {
    nome: 'gemini',
    async conversar(sistema: string, pergunta: string, opcoes?: OpcoesConversaIa): Promise<string> {
      const base = limpaBarra(cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: cfg.maxTokens || 4000,
      };
      if (opcoes?.json) {
        generationConfig.responseMimeType = 'application/json';
      }
      const corpo = {
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: 'user', parts: [{ text: pergunta }] }],
        generationConfig,
      };
      const headers = { 'x-goog-api-key': cfg.chave };
      const reservas = [
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3.5-flash',
      ].filter((m) => m !== cfg.modelo);
      let json: Record<string, unknown> | undefined;
      let ultimoErro: unknown;
      try {
        json = await pedir(
          `${base}/models/${encodeURIComponent(cfg.modelo)}:generateContent`,
          corpo,
          headers,
          fetchFn,
        );
      } catch (err) {
        ultimoErro = err;
        const msg = err instanceof Error ? err.message : String(err);
        const status = err instanceof ErroHttpIa ? err.status : 0;
        if (!ehErroTransitorioIa(status, msg) && !ehModeloIndisponivel(status, msg)) throw err;
        for (const modeloReserva of reservas) {
          try {
            json = await pedir(
              `${base}/models/${encodeURIComponent(modeloReserva)}:generateContent`,
              corpo,
              headers,
              fetchFn,
              1,
            );
            break;
          } catch (errReserva) {
            ultimoErro = errReserva;
            const msgR = errReserva instanceof Error ? errReserva.message : String(errReserva);
            const statusR = errReserva instanceof ErroHttpIa ? errReserva.status : 0;
            if (!ehErroTransitorioIa(statusR, msgR) && !ehModeloIndisponivel(statusR, msgR)) throw errReserva;
          }
        }
      }
      if (!json) throw ultimoErro;
      const candidates = Array.isArray(json.candidates)
        ? (json.candidates as { content?: { parts?: { text?: string; thought?: boolean }[] } }[])
        : [];
      const parts = candidates[0]?.content?.parts || [];
      // Modelos Gemini 2.5/3.x podem devolver partes com `thought: true` antes da resposta final.
      const resposta = parts.filter((p) => !p.thought && typeof p.text === 'string');
      const escolhidas =
        resposta.length > 0 ? resposta : parts.filter((p) => typeof p.text === 'string');
      return escolhidas.map((p) => p.text!).join('\n');
    },
    async modelos(): Promise<ModeloDisponivelIa[]> {
      const base = limpaBarra(cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
      const json = await buscar(`${base}/models?pageSize=200`, { 'x-goog-api-key': cfg.chave }, fetchFn);
      const models = Array.isArray(json.models)
        ? (json.models as { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[])
        : [];
      return models
        .filter((m) => m.name && (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => {
          const id = String(m.name).replace(/^models\//, '');
          return { id, label: m.displayName || id };
        });
    },
  };
}

export function construirProvedor(cfg: ConfigProvedorIa, fetchFn: typeof fetch = fetch): ProvedorIa {
  if (cfg.tipo === 'anthropic') return anthropic(cfg, fetchFn);
  if (cfg.tipo === 'openai') return openai(cfg, fetchFn);
  if (cfg.tipo === 'gemini') return gemini(cfg, fetchFn);
  throw new Error(`Provedor de IA desconhecido: ${String(cfg.tipo)}`);
}

/** Provedor vindo do .env — usado quando não há nada cadastrado na tela. */
export function provedorDoEnv(env: NodeJS.ProcessEnv = process.env): ConfigProvedorIa | null {
  const chave = env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.GEMINI_API_KEY;
  if (!chave || !chave.trim()) return null;
  const tipoBruto =
    env.AI_PROVIDER ||
    (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY ? 'openai' : 'gemini');
  const tipo: TipoProvedorIa = (TIPOS_IA as readonly string[]).includes(tipoBruto)
    ? (tipoBruto as TipoProvedorIa)
    : 'gemini';
  const padrao: Record<TipoProvedorIa, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
  };
  return {
    tipo,
    modelo: env.AI_MODEL || padrao[tipo],
    chave: chave.trim(),
    baseUrl: env.AI_BASE_URL || null,
    maxTokens: Number(env.AI_MAX_TOKENS) || 4000,
    origem: 'env',
  };
}
