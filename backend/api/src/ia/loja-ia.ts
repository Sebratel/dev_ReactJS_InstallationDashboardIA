// Registro e persistência do provedor de IA (mesma arquitetura de `server/src/ia/registro.js`
// do Dashboard Comercial, integrada também ao `DB_InstallationDashboard`).
//
// A chave é gravada cifrada (AES-256-GCM) e NUNCA sai numa resposta da API — apenas uma dica
// com os quatro últimos caracteres (`••••1234`) para o administrador reconhecer qual cadastrou.

import fs from 'node:fs';
import path from 'node:path';
import type mysql from 'mysql2/promise';
import { cifrar, decifrar } from './cripto.ts';
import {
  ROTULO_TIPO_IA,
  TIPOS_IA,
  construirProvedor,
  provedorDoEnv,
  type ConfigProvedorIa,
  type ModeloDisponivelIa,
  type ProvedorIa,
  type TipoProvedorIa,
} from './provedor.ts';

export class ErroDeIa extends Error {
  readonly status: number;

  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.name = 'ErroDeIa';
  }
}

export interface ResultadoTesteIa {
  readonly ok: boolean;
  readonly ms: number;
  readonly amostra?: string;
  readonly erro?: string;
  readonly em: string;
}

export interface EstadoPublicoIa {
  readonly configurado: boolean;
  readonly origem: 'tela' | 'env' | null;
  readonly tipo: TipoProvedorIa;
  readonly modelo: string;
  readonly baseUrl: string | null;
  readonly maxTokens: number;
  readonly dica: string | null;
  readonly atualizadoEm?: string | null;
  readonly atualizadoPor?: string | null;
  readonly ultimoTeste?: ResultadoTesteIa | null;
  readonly aviso?: string;
  readonly tipos: readonly { id: TipoProvedorIa; label: string }[];
}

export interface RegistroSalvoIa {
  readonly tipo: TipoProvedorIa;
  readonly modelo: string;
  readonly baseUrl: string | null;
  readonly maxTokens: number;
  readonly chaveCifrada: string;
  readonly dica: string | null;
  readonly atualizadoEm: string;
  readonly atualizadoPor: string;
  readonly ultimoTeste: ResultadoTesteIa | null;
}

export interface LojaDeIa {
  estado(): Promise<EstadoPublicoIa>;
  configuracaoAtiva(): Promise<ConfigProvedorIa | null>;
  provedorAtivo(): Promise<{ provedor: ProvedorIa; cfg: ConfigProvedorIa } | null>;
  salvar(entrada: unknown, porQuem: string): Promise<EstadoPublicoIa>;
  remover(porQuem: string): Promise<EstadoPublicoIa>;
  listarModelos(entrada: unknown): Promise<ModeloDisponivelIa[]>;
  testar(): Promise<ResultadoTesteIa>;
}

export const DDL_DA_IA = `CREATE TABLE IF NOT EXISTS ai_provider_config (
  config_id        TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  provider_type   VARCHAR(32) NOT NULL,
  model_name      VARCHAR(128) NOT NULL,
  base_url        VARCHAR(512) NULL,
  max_tokens      INT UNSIGNED NOT NULL DEFAULT 4000,
  encrypted_key   TEXT NOT NULL,
  key_hint        VARCHAR(32) NULL,
  last_test_json  TEXT NULL,
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by      VARCHAR(254) NOT NULL
) ENGINE = InnoDB`;

const TIPOS_LISTA = TIPOS_IA.map((id) => ({ id, label: ROTULO_TIPO_IA[id] }));

const mascaraDica = (chave: string | null | undefined): string | null =>
  chave && chave.length > 4 ? `••••${chave.slice(-4)}` : chave ? '••••' : null;

export function validarEntradaIa(entrada: unknown): {
  tipo: TipoProvedorIa;
  modelo: string;
  baseUrl: string | null;
  maxTokens: number;
  chave: string | undefined;
} {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new ErroDeIa(400, 'Corpo inválido: esperado um objeto JSON.');
  }
  const obj = entrada as Record<string, unknown>;
  const tipo = String(obj.tipo ?? '');
  if (!(TIPOS_IA as readonly string[]).includes(tipo)) {
    throw new ErroDeIa(400, 'Provedor inválido. Escolha Anthropic, OpenAI ou Gemini.');
  }
  const modelo = typeof obj.modelo === 'string' ? obj.modelo.trim() : '';
  if (!modelo) {
    throw new ErroDeIa(400, 'Informe o modelo (ex.: gemini-2.0-flash ou gpt-4o-mini).');
  }
  let baseUrl: string | null = null;
  if (obj.baseUrl !== undefined && obj.baseUrl !== null && String(obj.baseUrl).trim() !== '') {
    const crua = String(obj.baseUrl).trim();
    try {
      const u = new URL(crua);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocolo');
      baseUrl = crua;
    } catch {
      throw new ErroDeIa(400, 'URL base inválida (use http ou https).');
    }
  }
  let maxTokens = 4000;
  if (obj.maxTokens !== undefined && obj.maxTokens !== null && String(obj.maxTokens).trim() !== '') {
    const n = Number(obj.maxTokens);
    if (!Number.isInteger(n) || n < 256 || n > 64_000) {
      throw new ErroDeIa(400, 'O teto de tokens deve ser um inteiro entre 256 e 64.000.');
    }
    maxTokens = n;
  }
  const chave =
    obj.chave !== undefined && obj.chave !== null ? String(obj.chave).trim() : undefined;

  return {
    tipo: tipo as TipoProvedorIa,
    modelo,
    baseUrl,
    maxTokens,
    chave,
  };
}

function montaEstadoPublico(
  salvo: RegistroSalvoIa | null,
  env: ConfigProvedorIa | null,
): EstadoPublicoIa {
  if (!salvo && !env) {
    return {
      configurado: false,
      origem: null,
      tipo: 'gemini',
      modelo: '',
      baseUrl: null,
      maxTokens: 4000,
      dica: null,
      tipos: TIPOS_LISTA,
    };
  }
  if (!salvo && env) {
    return {
      configurado: true,
      origem: 'env',
      tipo: env.tipo,
      modelo: env.modelo,
      baseUrl: env.baseUrl,
      maxTokens: env.maxTokens,
      dica: mascaraDica(env.chave),
      aviso: 'Configuração vinda do .env. Cadastre pela tela para poder trocar sem reiniciar.',
      tipos: TIPOS_LISTA,
    };
  }
  return {
    configurado: Boolean(salvo!.chaveCifrada),
    origem: 'tela',
    tipo: salvo!.tipo,
    modelo: salvo!.modelo,
    baseUrl: salvo!.baseUrl || null,
    maxTokens: salvo!.maxTokens || 4000,
    dica: salvo!.dica || null,
    atualizadoEm: salvo!.atualizadoEm || null,
    atualizadoPor: salvo!.atualizadoPor || null,
    ultimoTeste: salvo!.ultimoTeste || null,
    tipos: TIPOS_LISTA,
  };
}

/**
 * Armazenamento em arquivo (`ia.json` no diretório runtime da API), com a chave cifrada em
 * AES-256-GCM e fallback para variáveis de ambiente.
 */
export function criaLojaDeIaArquivo(opcoes: {
  dir: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  segredo?: string;
}): LojaDeIa {
  const { dir, env = process.env, fetchFn = fetch, segredo } = opcoes;
  const caminhoArquivo = path.join(dir, 'ia.json');

  const lerSalvo = (): RegistroSalvoIa | null => {
    try {
      if (!fs.existsSync(caminhoArquivo)) return null;
      const raw = fs.readFileSync(caminhoArquivo, 'utf8').trim();
      return raw ? (JSON.parse(raw) as RegistroSalvoIa) : null;
    } catch {
      return null;
    }
  };

  const gravarSalvo = (dados: RegistroSalvoIa): void => {
    fs.mkdirSync(path.dirname(caminhoArquivo), { recursive: true });
    fs.writeFileSync(caminhoArquivo, `${JSON.stringify(dados, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  };

  const apagarSalvo = (): void => {
    if (fs.existsSync(caminhoArquivo)) fs.unlinkSync(caminhoArquivo);
  };

  return criaLojaComPersistencia({
    ler: async () => lerSalvo(),
    gravar: async (d) => gravarSalvo(d),
    apagar: async () => apagarSalvo(),
    dirRuntime: dir,
    env,
    fetchFn,
    segredo,
  });
}

/**
 * Armazenamento no MariaDB (`DB_InstallationDashboard`, tabela `ai_provider_config`) com
 * espelho local em arquivo (`dirFallback/ia.json`) e registro em `audit_logs`.
 */
export function criaLojaDeIaMaria(
  pool: mysql.Pool,
  opcoes: {
    dirFallback: string;
    env?: NodeJS.ProcessEnv;
    fetchFn?: typeof fetch;
    segredo?: string;
  },
): LojaDeIa {
  const { dirFallback, env = process.env, fetchFn = fetch, segredo } = opcoes;
  const caminhoEspelho = path.join(dirFallback, 'ia.json');

  const lerEspelho = (): RegistroSalvoIa | null => {
    try {
      if (!fs.existsSync(caminhoEspelho)) return null;
      const raw = fs.readFileSync(caminhoEspelho, 'utf8').trim();
      return raw ? (JSON.parse(raw) as RegistroSalvoIa) : null;
    } catch {
      return null;
    }
  };

  const gravarEspelho = (dados: RegistroSalvoIa | null): void => {
    try {
      if (!dados) {
        if (fs.existsSync(caminhoEspelho)) fs.unlinkSync(caminhoEspelho);
        return;
      }
      fs.mkdirSync(path.dirname(caminhoEspelho), { recursive: true });
      fs.writeFileSync(caminhoEspelho, `${JSON.stringify(dados, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      /* espelho local é melhor-esforço quando o container é read-only */
    }
  };

  return criaLojaComPersistencia({
    ler: async () => {
      try {
        const [r] = await pool.query(
          'SELECT provider_type, model_name, base_url, max_tokens, encrypted_key, key_hint, last_test_json, updated_at, updated_by FROM ai_provider_config WHERE config_id = 1',
        );
        const linhas = r as Record<string, unknown>[];
        if (linhas.length === 0) return lerEspelho();
        const l = linhas[0]!;
        let ultimoTeste: ResultadoTesteIa | null = null;
        if (typeof l.last_test_json === 'string' && l.last_test_json.trim() !== '') {
          try {
            ultimoTeste = JSON.parse(l.last_test_json) as ResultadoTesteIa;
          } catch {
            ultimoTeste = null;
          }
        }
        const registro: RegistroSalvoIa = {
          tipo: String(l.provider_type) as TipoProvedorIa,
          modelo: String(l.model_name),
          baseUrl: l.base_url ? String(l.base_url) : null,
          maxTokens: Number(l.max_tokens) || 4000,
          chaveCifrada: String(l.encrypted_key),
          dica: l.key_hint ? String(l.key_hint) : null,
          atualizadoEm: new Date(l.updated_at as string).toISOString(),
          atualizadoPor: String(l.updated_by),
          ultimoTeste,
        };
        return registro;
      } catch {
        return lerEspelho();
      }
    },
    gravar: async (d, porQuem) => {
      gravarEspelho(d);
      try {
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          await c.query(
            `INSERT INTO ai_provider_config (config_id, provider_type, model_name, base_url, max_tokens, encrypted_key, key_hint, last_test_json, updated_by)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               provider_type = VALUES(provider_type),
               model_name = VALUES(model_name),
               base_url = VALUES(base_url),
               max_tokens = VALUES(max_tokens),
               encrypted_key = VALUES(encrypted_key),
               key_hint = VALUES(key_hint),
               last_test_json = VALUES(last_test_json),
               updated_by = VALUES(updated_by)`,
            [
              d.tipo,
              d.modelo,
              d.baseUrl,
              d.maxTokens,
              d.chaveCifrada,
              d.dica,
              d.ultimoTeste ? JSON.stringify(d.ultimoTeste) : null,
              porQuem,
            ],
          );
          await c.query(
            'INSERT INTO audit_logs (actor_email, action, target, before_value, after_value) VALUES (?, ?, ?, ?, ?)',
            [
              porQuem,
              'ia_configurada',
              'ai_provider_config',
              null,
              JSON.stringify({ tipo: d.tipo, modelo: d.modelo, dica: d.dica }),
            ],
          );
          await c.commit();
        } catch (err) {
          await c.rollback().catch(() => {});
          throw err;
        } finally {
          c.release();
        }
      } catch {
        /* fallback já ficou salvo no espelho local */
      }
    },
    apagar: async (porQuem) => {
      gravarEspelho(null);
      try {
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          await c.query('DELETE FROM ai_provider_config WHERE config_id = 1');
          await c.query(
            'INSERT INTO audit_logs (actor_email, action, target, before_value, after_value) VALUES (?, ?, ?, ?, ?)',
            [porQuem, 'ia_removida', 'ai_provider_config', null, null],
          );
          await c.commit();
        } catch {
          await c.rollback().catch(() => {});
        } finally {
          c.release();
        }
      } catch {
        /* fallback já apagou o espelho */
      }
    },
    dirRuntime: dirFallback,
    env,
    fetchFn,
    segredo,
  });
}

function criaLojaComPersistencia(p: {
  ler: () => Promise<RegistroSalvoIa | null>;
  gravar: (d: RegistroSalvoIa, porQuem: string) => Promise<void>;
  apagar: (porQuem: string) => Promise<void>;
  dirRuntime: string;
  env: NodeJS.ProcessEnv;
  fetchFn: typeof fetch;
  segredo?: string;
}): LojaDeIa {
  const configuracaoAtiva = async (): Promise<ConfigProvedorIa | null> => {
    const salvo = await p.ler();
    if (salvo?.chaveCifrada) {
      try {
        return {
          tipo: salvo.tipo,
          modelo: salvo.modelo,
          chave: decifrar(salvo.chaveCifrada, p.segredo, p.dirRuntime),
          baseUrl: salvo.baseUrl || null,
          maxTokens: salvo.maxTokens || 4000,
          origem: 'tela',
        };
      } catch (err) {
        console.warn('[ia] chave gravada não pôde ser decifrada:', (err as Error).message);
      }
    }
    return provedorDoEnv(p.env);
  };

  const estado = async (): Promise<EstadoPublicoIa> => {
    const salvo = await p.ler();
    const doEnv = provedorDoEnv(p.env);
    return montaEstadoPublico(salvo, doEnv);
  };

  const provedorAtivo = async (): Promise<{ provedor: ProvedorIa; cfg: ConfigProvedorIa } | null> => {
    const cfg = await configuracaoAtiva();
    return cfg ? { provedor: construirProvedor(cfg, p.fetchFn), cfg } : null;
  };

  return {
    estado,
    configuracaoAtiva,
    provedorAtivo,

    async salvar(entrada: unknown, porQuem: string): Promise<EstadoPublicoIa> {
      const validado = validarEntradaIa(entrada);
      const atual = await p.ler();
      const novaChave = validado.chave && validado.chave.length > 0 ? validado.chave : null;

      if (!atual?.chaveCifrada && !novaChave) {
        throw new ErroDeIa(400, 'Informe a chave de API do provedor.');
      }

      const registro: RegistroSalvoIa = {
        tipo: validado.tipo,
        modelo: validado.modelo,
        baseUrl: validado.baseUrl,
        maxTokens: validado.maxTokens,
        chaveCifrada: novaChave
          ? cifrar(novaChave, p.segredo, p.dirRuntime)
          : atual!.chaveCifrada,
        dica: novaChave ? mascaraDica(novaChave) : atual?.dica ?? null,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: porQuem,
        ultimoTeste: atual?.ultimoTeste ?? null,
      };
      await p.gravar(registro, porQuem);
      return estado();
    },

    async remover(porQuem: string): Promise<EstadoPublicoIa> {
      await p.apagar(porQuem);
      return estado();
    },

    async listarModelos(entrada: unknown): Promise<ModeloDisponivelIa[]> {
      const obj =
        entrada && typeof entrada === 'object' && !Array.isArray(entrada)
          ? (entrada as Record<string, unknown>)
          : {};
      const tipoBruto = typeof obj.tipo === 'string' ? obj.tipo : '';
      const chaveInformada =
        typeof obj.chave === 'string' && obj.chave.trim() !== '' ? obj.chave.trim() : null;
      const baseUrlInformada =
        typeof obj.baseUrl === 'string' && obj.baseUrl.trim() !== '' ? obj.baseUrl.trim() : null;

      let cfg: ConfigProvedorIa;
      if (chaveInformada) {
        if (!(TIPOS_IA as readonly string[]).includes(tipoBruto)) {
          throw new ErroDeIa(400, 'Provedor inválido. Escolha Anthropic, OpenAI ou Gemini.');
        }
        cfg = {
          tipo: tipoBruto as TipoProvedorIa,
          modelo: '',
          chave: chaveInformada,
          baseUrl: baseUrlInformada,
          maxTokens: 4000,
          origem: 'tela',
        };
      } else {
        const ativa = await configuracaoAtiva();
        if (!ativa) throw new ErroDeIa(400, 'Nenhuma chave cadastrada.');
        cfg = {
          ...ativa,
          ...(tipoBruto && (TIPOS_IA as readonly string[]).includes(tipoBruto)
            ? { tipo: tipoBruto as TipoProvedorIa }
            : {}),
          ...(obj.baseUrl !== undefined ? { baseUrl: baseUrlInformada } : {}),
        };
      }
      try {
        return await construirProvedor(cfg, p.fetchFn).modelos();
      } catch (err) {
        throw new ErroDeIa(400, (err as Error).message);
      }
    },

    async testar(): Promise<ResultadoTesteIa> {
      const ativo = await provedorAtivo();
      if (!ativo) throw new ErroDeIa(400, 'Nenhum provedor de IA configurado.');
      const inicio = Date.now();
      let resultado: ResultadoTesteIa;
      try {
        const texto = await ativo.provedor.conversar(
          'Você é um teste de conectividade. Responda apenas: OK',
          'Responda apenas OK.',
        );
        resultado = {
          ok: true,
          ms: Date.now() - inicio,
          amostra: (texto || '').trim().slice(0, 120),
          em: new Date().toISOString(),
        };
      } catch (err) {
        resultado = {
          ok: false,
          ms: Date.now() - inicio,
          erro: (err as Error).message,
          em: new Date().toISOString(),
        };
      }
      const salvo = await p.ler();
      if (salvo) {
        await p.gravar({ ...salvo, ultimoTeste: resultado }, salvo.atualizadoPor);
      }
      return resultado;
    },
  };
}
