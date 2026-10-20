// Os perfis da aba PERMISSÕES (20/10/2026): um grupo de abas com nome ("Field", "Gestão").
// Quem está no perfil abre as abas dele, somadas às individuais; mudar o perfil muda todo
// mundo dele. Grava no clique de "Salvar perfil" — não passa pelo rascunho da matriz.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  removePerfil,
  salvaPerfil,
  type MatrizDeAcesso,
  type PerfilDeAcesso,
} from '../../services/acessoService.ts';
import { nomeDaAba } from '../../utils/ordemDasTelas.ts';
import { Botao } from '../ui/Botao.tsx';
import { Cartao, Erro } from '../ui/Cartao.tsx';
import { Nota } from '../ui/Nota.tsx';

/** "Gestão Field" → "gestao-field": o identificador sai do nome. */
export function idDoPerfil(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function EditorDePerfil(props: {
  perfil: PerfilDeAcesso | null;
  telas: MatrizDeAcesso['telas'];
  aoAtualizar: (m: MatrizDeAcesso) => void;
  aoFechar?: () => void;
}) {
  const [nome, setNome] = useState(props.perfil?.nome ?? '');
  const [telas, setTelas] = useState<string[]>(props.perfil?.telas ?? []);
  const salva = useMutation({
    mutationFn: () => salvaPerfil(props.perfil?.id ?? idDoPerfil(nome), nome.trim(), telas),
    onSuccess: (m) => {
      props.aoAtualizar(m);
      props.aoFechar?.();
    },
  });
  const remove = useMutation({
    mutationFn: () => removePerfil(props.perfil!.id),
    onSuccess: props.aoAtualizar,
  });
  const ocupado = salva.isPending || remove.isPending;
  const mudou =
    nome.trim() !== (props.perfil?.nome ?? '') ||
    telas.length !== (props.perfil?.telas.length ?? 0) ||
    telas.some((t) => !props.perfil?.telas.includes(t));

  return (
    <div className="grid gap-[6px] border-t border-pbi-borda py-[8px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <input
          value={nome}
          maxLength={80}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do perfil (ex.: Field)"
          aria-label="Nome do perfil"
          className="w-[min(240px,100%)]"
        />
        {props.perfil ? <Nota>{props.perfil.membros} pessoa(s)</Nota> : null}
        <div className="ml-auto flex gap-[6px]">
          {props.perfil ? (
            <Botao
              variante="secundario"
              disabled={ocupado}
              onClick={() => {
                if (
                  window.confirm(
                    `Apagar o perfil "${props.perfil!.nome}"? Quem está nele perde as abas que vinham dele.`,
                  )
                ) {
                  remove.mutate();
                }
              }}
            >
              Apagar
            </Botao>
          ) : null}
          <Botao
            variante="primario"
            disabled={ocupado || !mudou || !idDoPerfil(nome)}
            onClick={() => salva.mutate()}
          >
            {props.perfil ? 'Salvar perfil' : 'Criar perfil'}
          </Botao>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-[14px] gap-y-[4px] text-[0.72rem]">
        {props.telas.map((t) => (
          <label key={t.id} className="flex items-center gap-[4px]">
            <input
              type="checkbox"
              className="w-auto"
              checked={telas.includes(t.id)}
              disabled={ocupado}
              onChange={(e) =>
                setTelas((atual) =>
                  e.target.checked ? [...atual, t.id] : atual.filter((x) => x !== t.id),
                )
              }
            />
            {nomeDaAba(t.nome)}
          </label>
        ))}
      </div>
      {salva.error ? <Erro>{(salva.error as Error).message}</Erro> : null}
      {remove.error ? <Erro>{(remove.error as Error).message}</Erro> : null}
    </div>
  );
}

export function PerfisDeAcesso(props: {
  m: MatrizDeAcesso;
  aoAtualizar: (m: MatrizDeAcesso) => void;
}) {
  const [novo, setNovo] = useState(false);
  const perfis = props.m.perfis ?? [];
  return (
    <Cartao
      titulo="Perfis"
      sub="Um perfil é um conjunto de abas. Quem está nele abre essas abas, além das marcadas na matriz — e mudar o perfil muda todo mundo dele."
      largo
    >
      {perfis.length === 0 && !novo ? <Nota como="p">Nenhum perfil ainda.</Nota> : null}
      {perfis.map((p) => (
        <EditorDePerfil
          key={`${p.id}:${p.telas.join(',')}:${p.nome}`}
          perfil={p}
          telas={props.m.telas}
          aoAtualizar={props.aoAtualizar}
        />
      ))}
      {novo ? (
        <EditorDePerfil
          perfil={null}
          telas={props.m.telas}
          aoAtualizar={props.aoAtualizar}
          aoFechar={() => setNovo(false)}
        />
      ) : (
        <div>
          <Botao variante="secundario" onClick={() => setNovo(true)}>
            Novo perfil
          </Botao>
        </div>
      )}
    </Cartao>
  );
}
