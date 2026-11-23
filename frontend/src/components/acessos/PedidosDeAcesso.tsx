// Quem entrou e caiu em "sem acesso", ainda sem resposta.
//
// Três saídas por pedido: aprovar com um perfil (grava na hora), dar abas à mão (vai
// para o rascunho e espera o "Salvar alterações") ou dispensar.

import {
  definePerfilDaPessoa,
  type MatrizDeAcesso,
  type PerfilDeAcesso,
} from '../../services/acessoService.ts';
import { Botao } from '../ui/Botao.tsx';
import { Cartao, Erro } from '../ui/Cartao.tsx';

interface PedidoDeAcesso {
  email: string;
  tentativas: number;
  ultimaVez: string;
}

interface PedidosDeAcessoProps {
  pedidos: readonly PedidoDeAcesso[];
  perfisDisponiveis: readonly PerfilDeAcesso[];
  /** Uma gravação da matriz em curso trava o "Dar abas". */
  travado: boolean;
  dispensando: boolean;
  erro: Error | null;
  aoAprovarComPerfil: (nova: MatrizDeAcesso) => void;
  aoDarAbas: (email: string) => void;
  aoDispensar: (email: string) => void;
}

export function PedidosDeAcesso({
  pedidos,
  perfisDisponiveis,
  travado,
  dispensando,
  erro,
  aoAprovarComPerfil,
  aoDarAbas,
  aoDispensar,
}: PedidosDeAcessoProps) {
  if (pedidos.length === 0) return null;
  const temPerfis = perfisDisponiveis.length > 0;

  return (
    <Cartao titulo={`Pedidos de acesso (${pedidos.length})`} largo>
      {erro ? <Erro>{erro.message}</Erro> : null}
      <ul className="m-0 grid list-none gap-[4px] p-0 text-[0.76rem]">
        {pedidos.map((pedido) => (
          <li key={pedido.email} className="flex flex-wrap items-center gap-[8px]">
            <span className="font-semibold">{pedido.email}</span>
            <span className="text-pbi-muted">
              {pedido.tentativas} tentativa(s), última em{' '}
              {new Date(pedido.ultimaVez).toLocaleString('pt-BR')}
            </span>

            {temPerfis ? (
              <select
                value=""
                className="ml-auto"
                aria-label={`Aprovar ${pedido.email} com um perfil`}
                onChange={(evento) => {
                  if (!evento.target.value) return;
                  void definePerfilDaPessoa(pedido.email, evento.target.value).then(
                    aoAprovarComPerfil,
                  );
                }}
              >
                <option value="">Aprovar com perfil…</option>
                {perfisDisponiveis.map((perfil) => (
                  <option key={perfil.id} value={perfil.id}>
                    {perfil.nome}
                  </option>
                ))}
              </select>
            ) : null}

            <Botao
              variante="secundario"
              className={temPerfis ? undefined : 'ml-auto'}
              disabled={travado}
              onClick={() => aoDarAbas(pedido.email)}
            >
              Dar abas
            </Botao>
            <Botao
              variante="secundario"
              disabled={dispensando}
              onClick={() => aoDispensar(pedido.email)}
            >
              Dispensar
            </Botao>
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
