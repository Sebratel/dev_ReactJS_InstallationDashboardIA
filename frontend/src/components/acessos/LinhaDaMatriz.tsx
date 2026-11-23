// Uma linha da matriz pessoa × aba.
//
// Saiu de dentro do `visiveis.map(...)` da `GestaoDeAcessos` — 120 linhas de JSX com
// quatro ternários aninhados no `title` de cada caixinha. Como componente, cada decisão
// de "pode marcar?" / "por que está travada?" fica numa função com nome.

import { Trash2, Undo2 } from 'lucide-react';
import type { MatrizDeAcesso, PerfilDeAcesso, Papel } from '../../services/acessoService.ts';
import type { PessoaNaTela } from '../../utils/rascunhoDeAcessos.ts';
import { ultimoAcessoNaTela } from '../../utils/inatividade.ts';
import { cn } from '../../utils/cn.ts';
import { Selo } from '../ui/Selo.tsx';
import { BotaoDeIcone } from '../ui/BotaoDeIcone.tsx';
import { SituacaoDaPessoa } from './SituacaoDaPessoa.tsx';

/** Uma aba da matriz, já com o que o rascunho mudou. */
export interface TelaNaMatriz {
  id: string;
  nome: string;
  modo: 'lista' | 'todos';
  mudou: boolean;
}

interface LinhaDaMatrizProps {
  pessoa: PessoaNaTela;
  telas: readonly TelaNaMatriz[];
  /** O perfil desta pessoa, quando ela tem um; as abas dele somam às individuais. */
  perfilDaPessoa: PerfilDeAcesso | undefined;
  perfisDisponiveis: readonly PerfilDeAcesso[];
  souAdmin: boolean;
  /** Uma gravação em curso: a linha inteira fica travada. */
  travado: boolean;
  gravandoEmMassa: boolean;
  selecionada: boolean;
  aoSelecionar: (email: string) => void;
  aoMudarPapel: (email: string, papel: Papel) => void;
  aoMudarPerfil: (email: string, perfil: string | null) => void;
  aoMarcarTela: (email: string, tela: string, marcada: boolean) => void;
  aoAlternarRemocao: (email: string) => void;
  aoAtualizarMatriz: (nova: MatrizDeAcesso) => void;
}

/** Por que a caixinha desta aba está travada — ou `undefined` quando ela está livre. */
function motivoDaTrava(
  veTudo: boolean,
  abertaParaTodos: boolean,
  nomeDoPerfil: string | undefined,
): string | undefined {
  if (veTudo) return 'Admin abre todas as abas';
  if (abertaParaTodos) return 'Aba aberta para todos';
  if (nomeDoPerfil) return `Vem do perfil ${nomeDoPerfil}`;
  return undefined;
}

/** O que o botão da direita faz nesta linha, e o que ele explica ao passar o mouse. */
function tituloDaRemocao(removida: boolean, podeRemover: boolean): string {
  if (removida) return 'Desfazer a remoção';
  if (podeRemover) return 'Tirar todos os acessos (ao salvar)';
  return 'Só admin remove quem tem papel; papel fixo não sai pela tela';
}

/** O nome e, abaixo, o nome vindo da Senior. */
function CelulaDaPessoa({ pessoa }: { pessoa: PessoaNaTela }) {
  return (
    <td className="px-[8px] py-[4px] whitespace-nowrap">
      {pessoa.email}
      {pessoa.nova ? <span className="ml-[6px] text-pbi-muted">(nova)</span> : null}
      {pessoa.senior?.nome ? (
        <div className="text-[0.66rem] text-pbi-muted">{pessoa.senior.nome}</div>
      ) : null}
    </td>
  );
}

/** Só admin troca papel, e papel fixo vem do `.env` do servidor — nem admin o muda aqui. */
function CelulaDePapel({
  pessoa,
  souAdmin,
  travado,
  aoMudarPapel,
}: {
  pessoa: PessoaNaTela;
  souAdmin: boolean;
  travado: boolean;
  aoMudarPapel: (email: string, papel: Papel) => void;
}) {
  if (!souAdmin || pessoa.fixo) {
    return (
      <td className="px-[8px] py-[4px]">
        <span title={pessoa.fixo ? 'Definido no .env do servidor' : undefined}>
          {pessoa.papel}
          {pessoa.fixo ? ' (fixo)' : ''}
        </span>
      </td>
    );
  }
  return (
    <td className="px-[8px] py-[4px]">
      <select
        value={pessoa.papel}
        disabled={travado || pessoa.removida}
        onChange={(evento) => aoMudarPapel(pessoa.email, evento.target.value as Papel)}
        aria-label={`Papel de ${pessoa.email}`}
      >
        <option value="viewer">viewer</option>
        <option value="dev">dev</option>
        <option value="admin">admin</option>
      </select>
    </td>
  );
}

/** Perfil é gravação no clique, não rascunho — por isso ele some em quem ainda não existe. */
function CelulaDePerfil({
  pessoa,
  perfisDisponiveis,
  gravandoEmMassa,
  aoMudarPerfil,
}: {
  pessoa: PessoaNaTela;
  perfisDisponiveis: readonly PerfilDeAcesso[];
  gravandoEmMassa: boolean;
  aoMudarPerfil: (email: string, perfil: string | null) => void;
}) {
  if (pessoa.nova || pessoa.fixo) {
    return (
      <td className="px-[8px] py-[4px]">
        <span className="text-pbi-muted">—</span>
      </td>
    );
  }
  return (
    <td className="px-[8px] py-[4px]">
      <select
        value={pessoa.perfil ?? ''}
        disabled={gravandoEmMassa || pessoa.removida}
        aria-label={`Perfil de ${pessoa.email}`}
        onChange={(evento) => aoMudarPerfil(pessoa.email, evento.target.value || null)}
      >
        <option value="">(sem perfil)</option>
        {perfisDisponiveis.map((perfil) => (
          <option key={perfil.id} value={perfil.id}>
            {perfil.nome}
          </option>
        ))}
      </select>
    </td>
  );
}

/** Quando foi a última vez que esta pessoa abriu alguma aba. */
function CelulaDeUltimoAcesso({ pessoa }: { pessoa: PessoaNaTela }) {
  const ultimoAcesso = ultimoAcessoNaTela(pessoa.ultimoAcesso);
  return (
    <td
      className="px-[8px] py-[4px] whitespace-nowrap"
      title={
        pessoa.ultimoAcesso
          ? new Date(pessoa.ultimoAcesso).toLocaleString('pt-BR')
          : 'Nenhum acesso registrado'
      }
    >
      {pessoa.nova ? null : <Selo tom={ultimoAcesso.tom}>{ultimoAcesso.texto}</Selo>}
    </td>
  );
}

export function LinhaDaMatriz({
  pessoa,
  telas,
  perfilDaPessoa,
  perfisDisponiveis,
  souAdmin,
  travado,
  gravandoEmMassa,
  selecionada,
  aoSelecionar,
  aoMudarPapel,
  aoMudarPerfil,
  aoMarcarTela,
  aoAlternarRemocao,
  aoAtualizarMatriz,
}: LinhaDaMatrizProps) {
  const veTudo = pessoa.papel === 'admin';
  const vemDoPerfil = (tela: string) => Boolean(perfilDaPessoa?.telas.includes(tela));
  const podeRemover = !pessoa.fixo && (souAdmin || pessoa.papel === 'viewer');
  const podeAgir = souAdmin || pessoa.papel === 'viewer';

  return (
    <tr
      className={cn(
        'border-t border-pbi-borda',
        pessoa.mudou && 'bg-pbi-aviso-bg',
        pessoa.removida && 'text-pbi-muted line-through',
      )}
    >
      <td className="px-[6px] py-[4px]">
        <input
          type="checkbox"
          className="w-auto"
          aria-label={`Selecionar ${pessoa.email}`}
          disabled={pessoa.fixo || pessoa.nova}
          checked={selecionada}
          onChange={() => aoSelecionar(pessoa.email)}
        />
      </td>

      <CelulaDaPessoa pessoa={pessoa} />

      <CelulaDePapel
        pessoa={pessoa}
        souAdmin={souAdmin}
        travado={travado}
        aoMudarPapel={aoMudarPapel}
      />

      <CelulaDePerfil
        pessoa={pessoa}
        perfisDisponiveis={perfisDisponiveis}
        gravandoEmMassa={gravandoEmMassa}
        aoMudarPerfil={aoMudarPerfil}
      />

      <td className="px-[8px] py-[4px] whitespace-nowrap">
        {pessoa.nova ? (
          <span className="text-pbi-muted">ao salvar</span>
        ) : (
          <SituacaoDaPessoa pessoa={pessoa} podeAgir={podeAgir} aoAtualizar={aoAtualizarMatriz} />
        )}
      </td>

      <CelulaDeUltimoAcesso pessoa={pessoa} />

      {telas.map((tela) => {
        const abertaParaTodos = tela.modo === 'todos';
        const herdadaDoPerfil = vemDoPerfil(tela.id);
        const trava = motivoDaTrava(
          veTudo,
          abertaParaTodos,
          herdadaDoPerfil ? perfilDaPessoa?.nome : undefined,
        );
        return (
          <td key={tela.id} className="px-[6px] py-[4px] text-center">
            <input
              type="checkbox"
              checked={trava !== undefined || pessoa.telas.includes(tela.id)}
              disabled={trava !== undefined || pessoa.removida || travado}
              title={trava}
              aria-label={`${pessoa.email} abre ${tela.nome}`}
              onChange={(evento) => aoMarcarTela(pessoa.email, tela.id, evento.target.checked)}
            />
          </td>
        );
      })}

      <td className="px-[6px] py-[4px]">
        <BotaoDeIcone
          onClick={() => aoAlternarRemocao(pessoa.email)}
          disabled={!podeRemover || travado}
          title={tituloDaRemocao(pessoa.removida, podeRemover)}
          aria-label={pessoa.removida ? `Manter ${pessoa.email}` : `Remover ${pessoa.email}`}
        >
          {pessoa.removida ? <Undo2 size={13} /> : <Trash2 size={13} />}
        </BotaoDeIcone>
      </td>
    </tr>
  );
}
