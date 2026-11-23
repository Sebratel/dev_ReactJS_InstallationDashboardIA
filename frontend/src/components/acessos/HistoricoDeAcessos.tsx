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
function listaDeAbas(valor: string | null): string[] | null {
  if (valor === null) return null;
  try {
    const lista: unknown = JSON.parse(valor);
    return Array.isArray(lista) && lista.every((item) => typeof item === 'string')
      ? (lista as string[])
      : null;
  } catch {
    return null;
  }
}

/** `+ premiacao, visao-geral · − l-mapa` — só o que mudou, nunca a lista inteira. */
function diffDeAbas(antes: string[], depois: string[]): string {
  const entraram = depois.filter((abaNova) => !antes.includes(abaNova));
  const sairam = antes.filter((abaAnterior) => !depois.includes(abaAnterior));
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
export function descreveRegistro(registro: RegistroDeAuditoria): string {
  const acao = ACOES[registro.acao] ?? registro.acao;
  const antes = listaDeAbas(registro.antes);
  const depois = listaDeAbas(registro.depois);
  // Mudança de abas: o que entrou e o que saiu. As duas pontas têm de ser lista — uma
  // só (a primeira vez de alguém, com `antes` nulo) ainda assim compara, com a vazia.
  if (antes !== null || depois !== null) {
    const corpo = diffDeAbas(antes ?? [], depois ?? []);
    return `${registro.por} ${acao} ${registro.alvo ?? ''} (${corpo})`;
  }
  // Valor cru do registro, encurtado: a linha do histórico é uma só.
  const curto = (valor: string | null) => {
    if (valor === null) return '—';
    return valor.length > LIMITE_DO_VALOR ? `${valor.slice(0, LIMITE_DO_VALOR - 3)}…` : valor;
  };
  return `${registro.por} ${acao} ${registro.alvo ?? ''} (${curto(registro.antes)} → ${curto(registro.depois)})`;
}

/** Quanto de um valor cru cabe na linha do histórico antes das reticências. */
const LIMITE_DO_VALOR = 80;

export function HistoricoDeAcessos() {
  const [filtro, setFiltro] = useState('');
  const email = filtro.trim().toLowerCase() || null;
  const registroAtual = useQuery({
    queryKey: ['acessos-historico', email],
    queryFn: () => pegaHistorico(email),
    staleTime: 0,
  });
  // Resposta sem `registros` (API antiga) vale como lista vazia, não como erro de tela.
  const registros = registroAtual.data?.registros ?? [];
  return (
    <Cartao
      titulo="Histórico de alterações"
      sub="As últimas 200 mudanças de acesso, da mais nova para a mais antiga."
      largo
    >
      <input
        type="email"
        value={filtro}
        onChange={(evento) => setFiltro(evento.target.value)}
        placeholder="Filtrar por e-mail (exato)"
        aria-label="Filtrar o histórico por e-mail"
        className="w-[min(320px,100%)]"
      />
      {registroAtual.error ? <Erro>{(registroAtual.error as Error).message}</Erro> : null}
      {registroAtual.data && registros.length === 0 ? <Nota como="p">Nada registrado.</Nota> : null}
      <ul className="m-0 grid max-h-[320px] list-none gap-[3px] overflow-auto p-0 text-[0.72rem]">
        {registros.map((registro, indice) => (
          <li key={`${registro.em}-${indice}`} className="grid grid-cols-[150px_1fr] gap-[8px]">
            <span className="text-pbi-muted">{new Date(registro.em).toLocaleString('pt-BR')}</span>
            <span className="break-words">{descreveRegistro(registro)}</span>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
