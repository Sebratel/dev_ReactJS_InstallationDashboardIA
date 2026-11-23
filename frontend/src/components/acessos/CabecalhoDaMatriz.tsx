// O cabeçalho da matriz pessoa × aba: as colunas fixas, uma coluna por aba (com a
// caixinha "Todos") e o "selecionar todas as visíveis".
//
// Fica preso no topo enquanto a matriz rola.

import type { PessoaNaTela } from '../../utils/rascunhoDeAcessos.ts';
import { nomeDaAba } from '../../utils/ordemDasTelas.ts';
import { juntarClasses } from '../../utils/cn.ts';
import type { TelaNaMatriz } from './LinhaDaMatriz.tsx';

/** As colunas que vêm antes das abas, na ordem da tela. */
const COLUNAS_FIXAS = ['Pessoa', 'Papel', 'Perfil', 'Situação', 'Último acesso'] as const;

interface CabecalhoDaMatrizProps {
  telas: readonly TelaNaMatriz[];
  pessoasVisiveis: readonly PessoaNaTela[];
  emailsSelecionados: ReadonlySet<string>;
  travado: boolean;
  aoSelecionarTodas: (emails: readonly string[]) => void;
  aoMudarModoDaTela: (tela: string, aberta: boolean) => void;
}

/** Quem pode entrar numa ação em massa: linha fixa e pessoa ainda não gravada, não. */
function selecionaveis(pessoas: readonly PessoaNaTela[]): PessoaNaTela[] {
  return pessoas.filter((pessoa) => !pessoa.fixo && !pessoa.nova);
}

export function CabecalhoDaMatriz({
  telas,
  pessoasVisiveis,
  emailsSelecionados,
  travado,
  aoSelecionarTodas,
  aoMudarModoDaTela,
}: CabecalhoDaMatrizProps) {
  const podemSerSelecionadas = selecionaveis(pessoasVisiveis);
  const todasMarcadas =
    pessoasVisiveis.length > 0 &&
    podemSerSelecionadas.every((pessoa) => emailsSelecionados.has(pessoa.email));

  return (
    <thead className="sticky top-0 z-10 bg-pbi-fundo">
      <tr>
        <th className="w-[1%] px-[6px] py-[6px]">
          <input
            type="checkbox"
            className="w-auto"
            aria-label="Selecionar todas as visíveis"
            checked={todasMarcadas}
            onChange={(evento) =>
              aoSelecionarTodas(
                evento.target.checked ? podemSerSelecionadas.map((pessoa) => pessoa.email) : [],
              )
            }
          />
        </th>

        {COLUNAS_FIXAS.map((coluna) => (
          <th key={coluna} className="px-[8px] py-[6px] text-left">
            {coluna}
          </th>
        ))}

        {telas.map((tela) => (
          <th
            key={tela.id}
            className={juntarClasses(
              'min-w-[84px] px-[6px] py-[6px] text-center align-bottom',
              tela.mudou && 'bg-pbi-aviso-bg',
            )}
          >
            <div className="text-[0.68rem] leading-tight">{nomeDaAba(tela.nome)}</div>
            <label className="mt-[4px] flex items-center justify-center gap-[3px] text-[0.64rem] font-normal text-pbi-muted">
              <input
                type="checkbox"
                checked={tela.modo === 'todos'}
                disabled={travado}
                onChange={(evento) => aoMudarModoDaTela(tela.id, evento.target.checked)}
              />
              Todos
            </label>
          </th>
        ))}

        <th className="w-[1%]" />
      </tr>
    </thead>
  );
}
