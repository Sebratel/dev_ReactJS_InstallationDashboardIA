// O visual que a página não trouxe, e o botão que o traz.
//
// O texto diz **por que** está vazio, não só que está: "sob demanda" sem explicação
// parece defeito. Ver `specs/_catalog/projecao.yaml` e a DECISAO-DESEMPENHO — a tabela
// de relatos de `agendamento-field` custa ~350 MB, e o preço é a razão de ela não abrir
// junto com a página.

import { useState } from 'react';
import { pegaPagina, type FiltroDaTela, type VisualCalculado } from '../api.ts';
import { Cartao, Erro } from './Cartao.tsx';
import { VisualPronto } from './VisualPronto.tsx';

export function SobDemanda(props: {
  pagina: string;
  visual: VisualCalculado;
  filtros: readonly FiltroDaTela[];
}) {
  const [estado, setEstado] = useState<'parado' | 'carregando'>('parado');
  const [pronto, setPronto] = useState<VisualCalculado | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carrega(): Promise<void> {
    setEstado('carregando');
    setErro(null);
    try {
      // Os mesmos filtros da página vão junto: um visual carregado sob demanda que
      // ignorasse a segmentação mostraria o universo inteiro ao lado de cards
      // filtrados, e as duas coisas na tela se contradiriam sem aviso.
      const p = await pegaPagina(props.pagina, props.filtros, { visual: props.visual.id });
      const achado = p.visuais.find((v) => v.id === props.visual.id);
      if (!achado) throw new Error('a resposta não trouxe este visual.');
      if (achado.erro) throw new Error(achado.erro);
      setPronto(achado);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setEstado('parado');
    }
  }

  if (pronto) return <VisualPronto pagina={props.pagina} visual={pronto} filtros={props.filtros} />;

  return (
    <Cartao titulo={props.visual.tipo} sub="sob demanda" id={props.visual.id} largo>
      <div className="sob-demanda">
        <p>
          Este visual usa {(props.visual.sobDemanda ?? []).join(', ')}, que fica fora da abertura da
          página por ser grande demais para carregar sempre.
        </p>
        {erro ? <Erro>{erro}</Erro> : null}
        <button className="primario" onClick={carrega} disabled={estado === 'carregando'}>
          {estado === 'carregando' ? 'carregando…' : 'Carregar'}
        </button>
      </div>
    </Cartao>
  );
}
