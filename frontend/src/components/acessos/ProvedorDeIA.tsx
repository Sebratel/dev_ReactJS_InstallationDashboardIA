// Gestão do Provedor de IA na aba "Permissões" (`GestaoDeAcessos.tsx`) — mesma
// interface e fluxo da `AbaIA` em `Configuracoes.jsx` do Dashboard Comercial.
// Visível apenas para administradores (`souAdmin`).

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Play, RefreshCw, Sparkles, X } from 'lucide-react';
import { chavesDeConsulta } from '../../services/dashboardService.ts';
import {
  CHAVE_ADMIN_IA,
  listaModelosIa,
  pegaConfigIa,
  removeConfigIa,
  salvaConfigIa,
  testaConfigIa,
  type EstadoPublicoIa,
  type ModeloDisponivelIa,
  type ResultadoTesteIa,
  type TipoProvedorIa,
} from '../../services/iaService.ts';
import { Botao } from '../ui/Botao.tsx';
import { Cartao, Erro } from '../ui/Cartao.tsx';

const MODELOS_SUGERIDOS: Record<TipoProvedorIa, readonly ModeloDisponivelIa[]> = {
  gemini: [
    { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash' },
    { id: 'gemini-3.8-pro', label: 'gemini-3.8-pro' },
    { id: 'gemini-4.0-flash', label: 'gemini-4.0-flash' },
    { id: 'gemini-4.0-pro', label: 'gemini-4.0-pro' },
    { id: 'gemini-4.5-flash', label: 'gemini-4.5-flash' },
    { id: 'gemini-4.5-pro', label: 'gemini-4.5-pro' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    { id: 'gpt-4o', label: 'gpt-4o' },
    { id: 'o3-mini', label: 'o3-mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-20250514', label: 'claude-sonnet-4-20250514' },
    { id: 'claude-3-7-sonnet-latest', label: 'claude-3-7-sonnet-latest' },
    { id: 'claude-3-5-haiku-latest', label: 'claude-3-5-haiku-latest' },
  ],
};

function FormularioProvedorIa({
  estado,
  aoAtualizarEstado,
}: {
  estado: EstadoPublicoIa;
  aoAtualizarEstado: (novo: EstadoPublicoIa) => void;
}) {
  const qc = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<ResultadoTesteIa | null>(estado.ultimoTeste || null);
  const [modelos, setModelos] = useState<ModeloDisponivelIa[]>([]);
  const [buscandoModelos, setBuscandoModelos] = useState(false);
  const [form, setForm] = useState<{
    tipo: TipoProvedorIa;
    modelo: string;
    chave: string;
    baseUrl: string;
    maxTokens: number;
  }>({
    tipo: estado.tipo || 'gemini',
    modelo: estado.modelo || '',
    chave: '',
    baseUrl: estado.baseUrl || '',
    maxTokens: estado.maxTokens || 4000,
  });

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const corpo: {
        tipo: TipoProvedorIa;
        modelo: string;
        chave?: string;
        baseUrl?: string | null;
        maxTokens?: number;
      } = {
        tipo: form.tipo,
        modelo: form.modelo,
        baseUrl: form.baseUrl.trim() || null,
        maxTokens: Number(form.maxTokens) || 4000,
      };
      if (form.chave.trim()) corpo.chave = form.chave.trim();
      const novo = await salvaConfigIa(corpo);
      aoAtualizarEstado(novo);
      setForm((f) => ({
        ...f,
        tipo: novo.tipo || 'gemini',
        modelo: novo.modelo || '',
        baseUrl: novo.baseUrl || '',
        maxTokens: novo.maxTokens || 4000,
        chave: '',
      }));
      setTeste(novo.ultimoTeste || null);
      void qc.invalidateQueries({ queryKey: chavesDeConsulta.dashboards });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  const buscarModelos = async () => {
    setBuscandoModelos(true);
    setErro(null);
    try {
      const corpo: { tipo: TipoProvedorIa; chave?: string; baseUrl?: string | null } = {
        tipo: form.tipo,
        baseUrl: form.baseUrl.trim() || null,
      };
      if (form.chave.trim()) corpo.chave = form.chave.trim();
      const d = await listaModelosIa(corpo);
      setModelos(d.modelos || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setBuscandoModelos(false);
    }
  };

  const testar = async () => {
    setTestando(true);
    setErro(null);
    try {
      setTeste(await testaConfigIa());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setTestando(false);
    }
  };

  const remover = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const novo = await removeConfigIa();
      aoAtualizarEstado(novo);
      setModelos([]);
      setTeste(null);
      setForm((f) => ({
        ...f,
        tipo: novo.tipo || 'gemini',
        modelo: novo.modelo || '',
        baseUrl: novo.baseUrl || '',
        maxTokens: novo.maxTokens || 4000,
        chave: '',
      }));
      void qc.invalidateQueries({ queryKey: chavesDeConsulta.dashboards });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="flex flex-col gap-[10px] text-[0.76rem]">
      {erro ? <Erro>{erro}</Erro> : null}

      <div
        className={`flex items-center gap-[8px] rounded-[4px] border px-[10px] py-[7px] ${
          estado.configurado
            ? 'border-emerald-500/40 bg-emerald-500/10 text-pbi-ink'
            : 'border-pbi-borda bg-pbi-fundo text-pbi-muted'
        }`}
      >
        {estado.configurado ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}
        {estado.configurado ? (
          <span>
            Configurado: <b>{estado.tipo}</b> · <code>{estado.modelo}</code> · chave{' '}
            <b>{estado.dica}</b>
            {estado.origem === 'env' ? ' (vindo do .env)' : ''}
            {estado.atualizadoPor ? ` · por ${estado.atualizadoPor}` : ''}
          </span>
        ) : (
          <span>
            Nenhuma chave cadastrada. Os gráficos funcionam normalmente, mas sem o botão de leitura
            por IA para os usuários.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-[8px] md:grid-cols-2">
        <label className="flex flex-col gap-[3px]">
          <span className="font-semibold">Provedor</span>
          <select
            value={form.tipo}
            aria-label="Provedor de IA"
            onChange={(e) => {
              setForm({ ...form, tipo: e.target.value as TipoProvedorIa });
              setModelos([]);
            }}
            className="rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[5px]"
          >
            {(
              estado.tipos || [
                { id: 'anthropic', label: 'Anthropic (Claude)' },
                { id: 'openai', label: 'OpenAI e compatíveis' },
                { id: 'gemini', label: 'Google Gemini' },
              ]
            ).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-[3px]">
          <span className="font-semibold">
            Chave de API {estado.configurado ? '(em branco mantém a atual)' : ''}
          </span>
          <input
            type="password"
            autoComplete="off"
            aria-label="Chave de API"
            placeholder={
              estado.configurado ? `mantém ${estado.dica ?? 'atual'}` : 'cole a chave aqui'
            }
            value={form.chave}
            onChange={(e) => setForm({ ...form, chave: e.target.value })}
            className="rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[5px]"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-[8px]">
        <label className="flex min-w-[240px] flex-1 flex-col gap-[3px]">
          <span className="font-semibold">Modelo</span>
          <input
            type="text"
            aria-label="Modelo de IA"
            placeholder="ex.: gemini-3.8-flash, gpt-4o-mini ou claude-sonnet-4-20250514"
            value={form.modelo}
            onChange={(e) => setForm({ ...form, modelo: e.target.value })}
            className="rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[5px]"
          />
        </label>

        <Botao
          variante="secundario"
          onClick={() => void buscarModelos()}
          disabled={buscandoModelos}
        >
          <RefreshCw size={12} className={buscandoModelos ? 'animate-spin' : ''} />{' '}
          {buscandoModelos ? 'Buscando…' : 'Listar modelos da chave'}
        </Botao>
      </div>

      <div className="flex flex-col gap-[4px]">
        <span className="text-[0.7rem] font-semibold text-pbi-muted">
          {modelos.length > 0
            ? `Modelos da chave (${modelos.length}) — clique para selecionar:`
            : 'Modelos sugeridos — clique para selecionar:'}
        </span>
        <div
          className="flex max-h-[124px] flex-wrap gap-[5px] overflow-y-auto rounded-[4px] border border-pbi-borda bg-pbi-fundo p-[6px]"
          role="listbox"
          aria-label="Lista de modelos disponíveis"
        >
          {(modelos.length > 0 ? modelos : MODELOS_SUGERIDOS[form.tipo]).map((m) => {
            const ativo = form.modelo === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="button"
                aria-pressed={ativo}
                onClick={() => setForm((f) => ({ ...f, modelo: m.id }))}
                className={`cursor-pointer rounded-[4px] border px-[8px] py-[3px] text-[0.72rem] font-semibold transition-colors ${
                  ativo
                    ? 'border-pbi-primary bg-pbi-primary text-pbi-sobre-primary'
                    : 'border-pbi-borda bg-pbi-superficie text-pbi-ink hover:border-pbi-primary hover:text-pbi-primary-texto'
                }`}
              >
                {m.label !== m.id ? `${m.label} (${m.id})` : m.id}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[8px] md:grid-cols-2">
        <label className="flex flex-col gap-[3px]">
          <span className="font-semibold">
            URL base (opcional — Groq, OpenRouter, Azure, servidor local)
          </span>
          <input
            type="text"
            aria-label="URL base do provedor"
            placeholder="deixe vazio para o padrão do provedor"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            className="rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[5px]"
          />
        </label>

        <label className="flex flex-col gap-[3px]">
          <span className="font-semibold">Teto de tokens</span>
          <input
            type="number"
            min={256}
            max={64000}
            aria-label="Teto de tokens"
            value={form.maxTokens}
            onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
            className="rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[5px]"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        <Botao variante="primario" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar provedor'}
        </Botao>
        <Botao
          variante="secundario"
          onClick={() => void testar()}
          disabled={testando || !estado.configurado}
        >
          <Play size={12} /> {testando ? 'Testando…' : 'Testar conexão'}
        </Botao>
        {estado.origem === 'tela' ? (
          <Botao variante="secundario" onClick={() => void remover()} disabled={salvando}>
            <X size={12} /> Remover chave
          </Botao>
        ) : null}

        {teste ? (
          <span
            className={`inline-flex items-center gap-[5px] font-semibold ${
              teste.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-pbi-critico'
            }`}
          >
            {teste.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {teste.ok
              ? `conexão ok em ${teste.ms} ms — resposta: "${teste.amostra ?? 'OK'}"`
              : `falhou: ${teste.erro ?? 'erro desconhecido'}`}
          </span>
        ) : null}
      </div>

      <ul className="m-0 list-disc pl-[18px] text-[0.7rem] text-pbi-muted">
        <li>
          A chave é gravada <b>cifrada</b> (AES-256-GCM) e nunca volta numa resposta da API — só os
          quatro últimos caracteres.
        </li>
        <li>
          <b>OpenAI e compatíveis</b> cobre Groq, OpenRouter, Azure OpenAI, Together e servidores
          locais: basta informar a URL base.
        </li>
      </ul>
    </div>
  );
}

export function ProvedorDeIA() {
  const qc = useQueryClient();
  const iaQ = useQuery({
    queryKey: CHAVE_ADMIN_IA,
    queryFn: pegaConfigIa,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  return (
    <Cartao
      titulo="Provedor de IA (Insights nos gráficos)"
      sub="O provedor cadastrado aqui é usado apenas para interpretar os números já apurados pelo dashboard nos gráficos, rankings e matrizes — ele nunca recalcula valores e nunca recebe dados pessoais de clientes."
      largo
    >
      {iaQ.isPending ? (
        <p className="m-0 text-pbi-muted">Carregando configuração de IA…</p>
      ) : iaQ.isError ? (
        <Erro>{(iaQ.error as Error).message}</Erro>
      ) : (
        <FormularioProvedorIa
          estado={iaQ.data}
          aoAtualizarEstado={(novo) => qc.setQueryData(CHAVE_ADMIN_IA, novo)}
        />
      )}
    </Cartao>
  );
}
