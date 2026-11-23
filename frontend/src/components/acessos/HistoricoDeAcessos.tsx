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

/**
 * Lista de abas gravada no histórico, ou `null` quando o valor não é uma lista.
 *
 * `telas-da-pessoa` grava as abas ANTES e DEPOIS como lista. Mostrar as duas inteiras
 * nunca coube na linha — vinham cortadas em 80 caracteres, e o que importa (o que
 * entrou e o que saiu) é justamente o que o corte comia (QA D-08).
 */
function listaDeAbas(v: string | null): string[] | null {
  if (v === null) return null;
  try {
    const o: unknown = JSON.parse(v);
    return Array.isArray(o) && o.every((x) => typeof x === 'string') ? (o as string[]) : null;
  } catch {
    return null;
  }
}

/** `+ premiacao, visao-geral · − l-mapa` — só o que mudou, nunca a lista inteira. */
function diffDeAbas(antes: string[], depois: string[]): string {
  const entraram = depois.filter((t) => !antes.includes(t));
  const sairam = antes.filter((t) => !depois.includes(t));
  if (entraram.length === 0 && sairam.length === 0) {
    // Acontece: salvar a matriz sem mexer em nada grava uma linha assim. Dizer "nada
    // mudou" é informação; repetir a lista das duas vezes não é.
    return `sem mudança (${depois.length} aba${depois.length === 1 ? '' : 's'})`;
  }
  const partes: string[] = [];
  if (entraram.length > 0) partes.push(`+ ${entraram.join(', ')}`);
  if (sairam.length > 0) partes.push(`− ${sairam.join(', ')}`);
  return partes.join(' · ');
}

/** Uma linha em português: "chefe@ suspendeu ana@ (antes → depois)". */
export function descreveRegistro(r: RegistroDeAuditoria): string {
  const acao = ACOES[r.acao] ?? r.acao;
  const antes = listaDeAbas(r.antes);
  const depois = listaDeAbas(r.depois);
  // Mudança de abas: o que entrou e o que saiu. As duas pontas têm de ser lista — uma
  // só (a primeira vez de alguém, com `antes` nulo) ainda assim compara, com a vazia.
  if (antes !== null || depois !== null) {
    const corpo = diffDeAbas(antes ?? [], depois ?? []);
    return `${r.por} ${acao} ${r.alvo ?? ''} (${corpo})`;
  }
  // Valor cru do registro, encurtado: a linha do histórico é uma só.
  const curto = (valor: string | null) => {
    if (valor === null) return '—';
    return valor.length > LIMITE_DO_VALOR ? `${valor.slice(0, LIMITE_DO_VALOR - 3)}…` : valor;
  };
  return `${r.por} ${acao} ${r.alvo ?? ''} (${curto(r.antes)} → ${curto(r.depois)})`;
}

/** Quanto de um valor cru cabe na linha do histórico antes das reticências. */
const LIMITE_DO_VALOR = 80;

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
