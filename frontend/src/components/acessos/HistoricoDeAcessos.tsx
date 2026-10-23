// O histórico da aba PERMISSÕES (20/10/2026): quem mudou o quê, de quem e quando — as
// linhas de `audit_logs` que toda mudança grava na mesma transação. Antes isso só existia
// no banco; agora o admin filtra por pessoa direto na tela.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pegaHistorico, type RegistroDeAuditoria } from '../../services/acessoService.ts';
import { Cartao, Erro } from '../ui/Cartao.tsx';
import { Nota } from '../ui/Nota.tsx';

const ACOES: Record<string, string> = {
  'telas-da-pessoa': 'mudou as abas de',
  papel: 'mudou o papel de',
  'modo-da-tela': 'mudou o modo da aba',
  'remove-pessoa': 'removeu',
  'dispensa-pedido': 'dispensou o pedido de',
  suspende: 'suspendeu',
  reativa: 'reativou',
  validade: 'mudou o prazo de acesso de',
  'excecao-senior': 'mudou a exceção à Senior de',
  'perfil-salva': 'salvou o perfil',
  'perfil-remove': 'apagou o perfil',
  'perfil-da-pessoa': 'mudou o perfil de',
};

/** Uma linha em português: "chefe@ suspendeu ana@ (antes → depois)". */
export function descreveRegistro(r: RegistroDeAuditoria): string {
  const acao = ACOES[r.acao] ?? r.acao;
  const curto = (v: string | null) => (v === null ? '—' : v.length > 80 ? `${v.slice(0, 77)}…` : v);
  return `${r.por} ${acao} ${r.alvo ?? ''} (${curto(r.antes)} → ${curto(r.depois)})`;
}

export function HistoricoDeAcessos() {
  const [filtro, setFiltro] = useState('');
  const email = filtro.trim().toLowerCase() || null;
  const q = useQuery({
    queryKey: ['acessos-historico', email],
    queryFn: () => pegaHistorico(email),
    staleTime: 0,
  });
  // Resposta sem `registros` (API antiga) vale como lista vazia, não como erro de tela.
  const registros = q.data?.registros ?? [];
  return (
    <Cartao
      titulo="Histórico de alterações"
      sub="As últimas 200 mudanças de acesso, da mais nova para a mais antiga."
      largo
    >
      <input
        type="email"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Filtrar por e-mail (exato)"
        aria-label="Filtrar o histórico por e-mail"
        className="w-[min(320px,100%)]"
      />
      {q.error ? <Erro>{(q.error as Error).message}</Erro> : null}
      {q.data && registros.length === 0 ? <Nota como="p">Nada registrado.</Nota> : null}
      <ul className="m-0 grid max-h-[320px] list-none gap-[3px] overflow-auto p-0 text-[0.72rem]">
        {registros.map((r, i) => (
          <li key={`${r.em}-${i}`} className="grid grid-cols-[150px_1fr] gap-[8px]">
            <span className="text-pbi-muted">{new Date(r.em).toLocaleString('pt-BR')}</span>
            <span className="break-words">{descreveRegistro(r)}</span>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
