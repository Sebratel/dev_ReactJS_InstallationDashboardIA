// O visual que a página não trouxe — e que ela mesma vai buscar.
//
// **Ele busca sozinho, e a tela diz isso.** A versão anterior desenhava, enquanto o
// pedido corria, o texto que explica por que a tabela é cara mais um botão
// "Carregar" — um convite a clicar em algo que já estava acontecendo, e que sugeria
// que a demora era escolha de quem olhava. O motivo continua registrado (ver
// `specs/_catalog/projecao.yaml` e a DECISAO-DESEMPENHO), mas ele é resposta para
// "por que falhou", não para "por que ainda não apareceu": enquanto carrega, a tela
// mostra o esqueleto da tabela que está vindo.
//
// **O custo real, medido em 24/08/2026.** Pedir a tabela de relatos de
// `agendamento-field` custava 12,0 s, dos quais só 1,0 s era cálculo — os outros 11 s
// eram montar um segundo dataset com a coluna de texto livre dentro. Quem paga isso
// agora é o `aqueceSobDemanda` do servidor, em segundo plano, assim que a página é
// pedida; quando este componente chega aqui a resposta costuma estar pronta (65 ms).
// O esqueleto é para o caso em que não está — arranque frio, filtro recém-trocado.

import { useState, useEffect } from 'react';
import { pegaPagina, type FiltroDaTela, type VisualCalculado } from '../api.ts';
import { Cartao, Erro } from './Cartao.tsx';
import { VisualPronto } from './VisualPronto.tsx';
import { tituloDoVisual } from '../rotulos.ts';

export function SobDemanda(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
}) {
  const [estado, setEstado] = useState<'parado' | 'carregando'>('carregando');
  const [pronto, setPronto] = useState<VisualCalculado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Sobe a cada "tentar de novo". É o que faz o efeito rodar sem mudar filtro. */
  const [tentativa, setTentativa] = useState(0);

  // Uma busca por combinação de página/visual/filtros. Trocar o filtro no meio de um
  // pedido antigo faria a resposta velha chegar depois da nova e sobrescrevê-la — uma
  // tabela filtrada pelo que a tela **não** está mais pedindo, e sem nada dizendo.
  useEffect(() => {
    let atual = true;
    setEstado('carregando');
    setErro(null);

    // Os mesmos filtros da página vão junto: um visual carregado sob demanda que
    // ignorasse a segmentação mostraria o universo inteiro ao lado de cards
    // filtrados, e as duas coisas na tela se contradiriam sem aviso.
    pegaPagina(props.pagina, props.filtros, { visual: props.visual.id })
      .then((p) => {
        const achado = p.visuais.find((v) => v.id === props.visual.id);
        if (!achado) throw new Error('a resposta não trouxe este visual.');
        if (achado.erro) throw new Error(achado.erro);
        if (atual) setPronto(achado);
      })
      .catch((err: unknown) => {
        if (atual) setErro(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (atual) setEstado('parado');
      });

    return () => {
      atual = false;
    };
  }, [props.pagina, props.visual.id, props.filtros]);

  if (pronto) return <VisualPronto pagina={props.pagina} visual={pronto} filtros={props.filtros} />;

  const titulo = tituloDoVisual(props.visual);

  if (estado === 'carregando') {
    return (
      <Cartao titulo={titulo} sub="carregando…" id={props.visual.id} largo>
        <div className="esqueleto" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando {titulo}…</span>
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
          <div className="esqueleto-linha" />
        </div>
      </Cartao>
    );
  }

  // Sobrou o caminho da falha — e aí sim a explicação do custo é o que ajuda a
  // decidir se vale tentar de novo.
  return (
    <Cartao titulo={titulo} sub="não carregou" id={props.visual.id} largo>
      <div className="sob-demanda">
        {erro ? <Erro>{erro}</Erro> : null}
        <p>
          Este visual usa {(props.visual.sobDemanda ?? []).join(', ')}, que fica fora da abertura da
          página por ser grande demais para carregar sempre.
        </p>
        <button className="primario" onClick={() => setEstado('carregando')}>
          Tentar de novo
        </button>
      </div>
    </Cartao>
  );
}
