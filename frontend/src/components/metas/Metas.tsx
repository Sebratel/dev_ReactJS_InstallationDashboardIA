// A aba METAS: os números de negócio que a operação define e o painel lê.
//
// Por que existe (QA de 11/11/2026, D-20): a META DO MÊS era a constante `2865` dentro de
// `protocolos-geral.measures.yaml`. Mudava quando a operação decidia, mas só chegava ao
// painel quando alguém percebia, media o Power BI, editava o YAML e subia uma versão. Em
// 11/11 o painel mostrava 2.865 contra 2.583 no Power BI — 24 dias de número errado.
// Agora o gestor edita aqui e o refresh de 15 min leva ao KPI.
//
// A aba nasce SEM NINGUÉM: é liberada pessoa a pessoa na tela "Acessos", como qualquer
// outra. Esconder o campo é conforto; quem barra é o 403 de `/api/admin/metas`.

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHAVE_METAS,
  pegaMetas,
  salvaMeta,
  type MetaDeNegocio,
} from '../../services/metasService.ts';
import { Botao } from '../ui/Botao.tsx';
import { Aviso, Cartao, Erro } from '../ui/Cartao.tsx';
import { MensagemDeEstado } from '../ui/Estado.tsx';

/** "12/11/2026 às 14:32", ou `null`. O fuso é o do navegador — o mesmo das outras telas. */
function quando(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function UmaMeta({ meta }: { meta: MetaDeNegocio }) {
  const qc = useQueryClient();
  // O que está no campo. Começa no valor gravado e NUNCA é sincronizado sozinho com ele:
  // quem está digitando não pode ver o número pular embaixo do cursor, e uma releitura
  // (outro gestor salvou noutra aba) não pode apagar o que esta pessoa escreveu. Se os
  // dois divergirem, a linha "Em vigor desde…" embaixo mostra qual é o gravado.
  const [texto, setTexto] = useState(meta.valor === null ? '' : String(meta.valor));

  const gravacao = useMutation({
    mutationFn: (valor: number) => salvaMeta(meta.id, valor),
    onSuccess: (resposta) => {
      qc.setQueryData(CHAVE_METAS, resposta);
      // O campo passa a mostrar o que o SERVIDOR devolveu, não o que foi digitado.
      const gravada = resposta.metas.find((m) => m.id === meta.id);
      setTexto(gravada?.valor == null ? '' : String(gravada.valor));
    },
  });

  const n = Number(texto.trim());
  const valido = texto.trim() !== '' && Number.isInteger(n) && n >= 0;
  const mudou = valido && n !== meta.valor;

  const envia = (e: FormEvent) => {
    e.preventDefault();
    if (!mudou || gravacao.isPending) return;
    gravacao.mutate(n);
  };

  const gravadaEm = quando(meta.em);

  return (
    <Cartao titulo={meta.nome} sub={meta.descricao} largo>
      <form className="flex flex-col gap-[12px] p-[12px]" onSubmit={envia}>
        <div className="flex flex-wrap items-end gap-[12px]">
          <label className="flex flex-col gap-[4px]">
            <span className="text-[11px] font-semibold tracking-[0.3px] uppercase">Valor</span>
            <input
              className="w-[140px] px-[8px] py-[4px] text-right text-[15px] font-semibold"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={texto}
              aria-label={`${meta.nome} — valor`}
              onChange={(e) => setTexto(e.target.value)}
            />
          </label>
          <Botao variante="primario" type="submit" disabled={!mudou || gravacao.isPending}>
            {gravacao.isPending ? 'Salvando…' : 'Salvar'}
          </Botao>
          {mudou ? (
            <Botao
              variante="secundario"
              onClick={() => setTexto(meta.valor === null ? '' : String(meta.valor))}
            >
              Desfazer
            </Botao>
          ) : null}
        </div>

        {texto.trim() !== '' && !valido ? (
          <Erro>A meta tem de ser um número inteiro, sem casas decimais.</Erro>
        ) : null}
        {gravacao.isError ? <Erro>{(gravacao.error as Error).message}</Erro> : null}
        {gravacao.isSuccess && !mudou ? (
          // A promessa tem de ser a verdadeira: a gravação é imediata, o KPI não.
          <Aviso>Meta salva. O painel passa a mostrá-la na próxima carga, em até 15 minutos.</Aviso>
        ) : null}

        <p className="m-0 text-[11.5px] opacity-80">
          {meta.valor === null
            ? 'Ainda não definida — enquanto estiver em branco, o KPI do painel aparece vazio.'
            : gravadaEm
              ? `Em vigor desde ${gravadaEm}${meta.por ? `, por ${meta.por}` : ''}.`
              : 'Em vigor.'}
        </p>
        <p className="m-0 text-[11.5px] opacity-80">
          Vale para QUALQUER mês, inclusive os já fechados — é como o Power BI trata a meta. Trocar
          o valor muda também o que setembro e outubro comparam.
        </p>
      </form>
    </Cartao>
  );
}

export function Metas() {
  // Como a matriz de acessos, não há aviso do servidor quando muda: outro gestor pode ter
  // salvado numa outra aba. Reler ao abrir e ao voltar o foco é barato — é uma linha.
  const metasQ = useQuery({
    queryKey: CHAVE_METAS,
    queryFn: pegaMetas,
    refetchOnWindowFocus: true,
  });

  if (metasQ.isPending) return <MensagemDeEstado>Lendo as metas…</MensagemDeEstado>;
  if (metasQ.isError) return <Erro>{(metasQ.error as Error).message}</Erro>;

  const metas = metasQ.data?.metas ?? [];
  if (metas.length === 0) return <MensagemDeEstado>Nenhuma meta cadastrada.</MensagemDeEstado>;

  return (
    <div className="flex flex-col gap-[var(--gap)]">
      {metas.map((m) => (
        <UmaMeta key={m.id} meta={m} />
      ))}
    </div>
  );
}
