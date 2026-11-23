// Gestão do Provedor de IA na aba Configurações (`GestaoDeAcessos.tsx`) — mesma
// interface e fluxo da `AbaIA` em `Configuracoes.jsx` do Dashboard Comercial.
// Visível apenas para administradores (`souAdmin`).
//
// As quatro gravações moram no hook `useProvedorDeIa`; o selo, a lista de modelos e o
// resultado do teste, em `ia/partes.tsx`. Aqui ficam só os campos e o que o clique em
// cada botão dispara.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, X } from 'lucide-react';
import {
  CHAVE_ADMIN_IA,
  pegaConfigIa,
  type EstadoPublicoIa,
  type ModeloDisponivelIa,
  type TipoProvedorIa,
} from '../../services/iaService.ts';
import {
  formularioDoEstado,
  useProvedorDeIa,
  type FormularioDeIa,
} from '../../hooks/useProvedorDeIa.ts';
import { Botao } from '../ui/Botao.tsx';
import { Cartao, Erro } from '../ui/Cartao.tsx';
import { ResultadoDoTeste, SeletorDeModelos, SeloDoProvedor } from './ia/partes.tsx';

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

/** Os provedores oferecidos quando a resposta da API é mais velha que a tela. */
const TIPOS_DE_RESERVA: readonly { id: TipoProvedorIa; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI e compatíveis' },
  { id: 'gemini', label: 'Google Gemini' },
];

const CLASSE_DE_CAMPO = 'rounded-[2px] border border-pbi-borda bg-pbi-superficie px-[8px] py-[5px]';

function FormularioProvedorIa({
  estado,
  aoAtualizarEstado,
}: {
  estado: EstadoPublicoIa;
  aoAtualizarEstado: (novo: EstadoPublicoIa) => void;
}) {
  const [formulario, setFormulario] = useState<FormularioDeIa>({
    ...formularioDoEstado(estado),
    chave: '',
  });
  const provedor = useProvedorDeIa(estado, aoAtualizarEstado, (novo) =>
    setFormulario({ ...formularioDoEstado(novo), chave: '' }),
  );

  const mudaCampo = <C extends keyof FormularioDeIa>(campo: C, valor: FormularioDeIa[C]) =>
    setFormulario((atual) => ({ ...atual, [campo]: valor }));

  return (
    <div className="flex flex-col gap-[10px] text-[0.76rem]">
      {provedor.erro ? <Erro>{provedor.erro}</Erro> : null}

      <SeloDoProvedor estado={estado} />

      <div className="grid grid-cols-1 gap-[8px] md:grid-cols-2">
        <label className="flex flex-col gap-[3px]">
          <span className="font-semibold">Provedor</span>
          <select
            value={formulario.tipo}
            aria-label="Provedor de IA"
            onChange={(evento) => mudaCampo('tipo', evento.target.value as TipoProvedorIa)}
            className={CLASSE_DE_CAMPO}
          >
            {(estado.tipos || TIPOS_DE_RESERVA).map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {tipo.label}
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
            value={formulario.chave}
            onChange={(evento) => mudaCampo('chave', evento.target.value)}
            className={CLASSE_DE_CAMPO}
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
            value={formulario.modelo}
            onChange={(evento) => mudaCampo('modelo', evento.target.value)}
            className={CLASSE_DE_CAMPO}
          />
        </label>

        <Botao
          variante="secundario"
          onClick={() => void provedor.buscaModelos(formulario)}
          disabled={provedor.buscandoModelos}
        >
          <RefreshCw size={12} className={provedor.buscandoModelos ? 'animate-spin' : ''} />{' '}
          {provedor.buscandoModelos ? 'Buscando…' : 'Listar modelos da chave'}
        </Botao>
      </div>

      <SeletorDeModelos
        modelosDaChave={provedor.modelos}
        modelosSugeridos={MODELOS_SUGERIDOS[formulario.tipo]}
        modeloEscolhido={formulario.modelo}
        aoEscolher={(modelo) => mudaCampo('modelo', modelo)}
      />

      <div className="grid grid-cols-1 gap-[8px] md:grid-cols-2">
        <label className="flex flex-col gap-[3px]">
          <span className="font-semibold">
            URL base (opcional — Groq, OpenRouter, Azure, servidor local)
          </span>
          <input
            type="text"
            aria-label="URL base do provedor"
            placeholder="deixe vazio para o padrão do provedor"
            value={formulario.baseUrl}
            onChange={(evento) => mudaCampo('baseUrl', evento.target.value)}
            className={CLASSE_DE_CAMPO}
          />
        </label>

        <label className="flex flex-col gap-[3px]">
          <span className="font-semibold">Teto de tokens</span>
          <input
            type="number"
            min={256}
            max={64000}
            aria-label="Teto de tokens"
            value={formulario.maxTokens}
            onChange={(evento) => mudaCampo('maxTokens', Number(evento.target.value))}
            className={CLASSE_DE_CAMPO}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-[8px] pt-[4px]">
        <Botao
          variante="primario"
          onClick={() => void provedor.salva(formulario)}
          disabled={provedor.salvando}
        >
          {provedor.salvando ? 'Salvando…' : 'Salvar provedor'}
        </Botao>
        <Botao
          variante="secundario"
          onClick={() => void provedor.testa()}
          disabled={provedor.testando || !estado.configurado}
        >
          <Play size={12} /> {provedor.testando ? 'Testando…' : 'Testar conexão'}
        </Botao>
        {estado.origem === 'tela' ? (
          <Botao
            variante="secundario"
            onClick={() => void provedor.remove()}
            disabled={provedor.salvando}
          >
            <X size={12} /> Remover chave
          </Botao>
        ) : null}

        <ResultadoDoTeste teste={provedor.ultimoTeste} />
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
  const clienteDeConsultas = useQueryClient();
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
      <ConteudoDaConfiguracaoDeIa
        carregando={iaQ.isPending}
        erro={iaQ.isError ? (iaQ.error as Error) : null}
        estado={iaQ.data}
        aoAtualizarEstado={(novo) => clienteDeConsultas.setQueryData(CHAVE_ADMIN_IA, novo)}
      />
    </Cartao>
  );
}

/** Carregando, erro ou formulário — os três estados do cartão, sem ternário aninhado. */
function ConteudoDaConfiguracaoDeIa({
  carregando,
  erro,
  estado,
  aoAtualizarEstado,
}: {
  carregando: boolean;
  erro: Error | null;
  estado: EstadoPublicoIa | undefined;
  aoAtualizarEstado: (novo: EstadoPublicoIa) => void;
}) {
  if (carregando) return <p className="m-0 text-pbi-muted">Carregando configuração de IA…</p>;
  if (erro) return <Erro>{erro.message}</Erro>;
  if (!estado) return null;
  return <FormularioProvedorIa estado={estado} aoAtualizarEstado={aoAtualizarEstado} />;
}
