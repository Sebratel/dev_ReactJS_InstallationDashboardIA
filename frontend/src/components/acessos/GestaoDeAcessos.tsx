// A aba CONFIGURAÇÕES: quem abre cada aba — a matriz pessoa × aba do dashboard comercial
// (`Configuracoes.jsx`, aba "Acessos"). Só admin/dev a vê na faixa; o servidor confere de
// novo a cada pedido (ACHADOS #208).
//
// Até 14/10/2026 era um diálogo aberto por um ícone no topo, e cada caixinha gravava na
// hora. Agora é uma aba como as outras, com uma seção por vez.
//
// **Este arquivo só escolhe a seção.** Cada seção é um componente: a matriz e os pedidos
// moram na `AbaDeUsuarios`, as gravações no hook `useAcoesDeAcesso`, a faixa de abas na
// `AbasDeConfiguracao`. Antes as sete seções, o estado, as quatro mutações e 450 linhas
// de JSX estavam todos aqui — complexidade cognitiva 36 pelo SonarJS, num arquivo de 691
// linhas.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pegaMatriz } from '../../services/acessoService.ts';
import { useAcoesDeAcesso, CHAVE_ACESSOS } from '../../hooks/useAcoesDeAcesso.ts';
import { Erro } from '../ui/Cartao.tsx';
import {
  AbasDeConfiguracao,
  abasVisiveis,
  ROTULO_DO_PAPEL,
  type AbaDeConfiguracao,
} from './AbasDeConfiguracao.tsx';
import { AbaDeUsuarios } from './AbaDeUsuarios.tsx';
import { HistoricoDeAcessos } from './HistoricoDeAcessos.tsx';
import { PerfisDeAcesso } from './PerfisDeAcesso.tsx';
import { ProvedorDeIA } from './ProvedorDeIA.tsx';
import { SessoesAtivas } from './SessoesAtivas.tsx';
import { UsoDasTelas } from './UsoDasTelas.tsx';

export { CHAVE_ACESSOS };

export function GestaoDeAcessos() {
  // Ao contrário do dado das páginas, a matriz não tem aviso do servidor quando muda: outra
  // aba do navegador, ou outro admin, salva e esta continuava mostrando quem já saiu (até
  // o F5). Reler ao abrir a aba e ao voltar o foco é barato — o GET lê a memória da API.
  const matrizQ = useQuery({
    queryKey: CHAVE_ACESSOS,
    queryFn: pegaMatriz,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const [secaoEscolhida, setSecaoEscolhida] = useState<AbaDeConfiguracao>('usuarios');
  const [emailsSelecionados, setEmailsSelecionados] = useState<ReadonlySet<string>>(new Set());
  const acoes = useAcoesDeAcesso(emailsSelecionados, () => setEmailsSelecionados(new Set()));

  const matriz = matrizQ.data;
  if (!matriz) {
    return matrizQ.error ? (
      <Erro>{(matrizQ.error as Error).message}</Erro>
    ) : (
      <p className="m-0 text-pbi-muted">Lendo os acessos…</p>
    );
  }

  const souAdmin = matriz.eu.papel === 'admin';
  // Uma seção por vez, em abas — como as Configurações da Manutenção e a casca padrão.
  // Antes as sete seções vinham empilhadas numa página de ~2.200px, e a de baixo
  // (histórico) só aparecia rolando três telas.
  const abas = abasVisiveis(souAdmin);
  const secaoAberta = abas.some((aba) => aba.id === secaoEscolhida) ? secaoEscolhida : 'usuarios';

  return (
    <>
      <AbasDeConfiguracao
        abas={abas}
        aberta={secaoAberta}
        aoEscolher={setSecaoEscolhida}
        pedidos={matriz.pedidos.length}
        quem={`${matriz.eu.usuario} · ${ROTULO_DO_PAPEL[matriz.eu.papel]}`}
      />

      {secaoAberta === 'usuarios' ? (
        <AbaDeUsuarios
          matriz={matriz}
          souAdmin={souAdmin}
          acoes={acoes}
          emailsSelecionados={emailsSelecionados}
          aoMudarSelecao={setEmailsSelecionados}
        />
      ) : null}

      {secaoAberta === 'perfis' ? (
        <PerfisDeAcesso m={matriz} aoAtualizar={acoes.aoAtualizar} />
      ) : null}

      {secaoAberta === 'uso' ? <UsoDasTelas /> : null}

      {secaoAberta === 'ia' && souAdmin ? <ProvedorDeIA /> : null}

      {secaoAberta === 'sessoes' && souAdmin ? <SessoesAtivas eu={matriz.eu.usuario} /> : null}

      {secaoAberta === 'historico' ? <HistoricoDeAcessos /> : null}
    </>
  );
}
