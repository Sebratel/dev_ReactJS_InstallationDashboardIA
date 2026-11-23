// As partes do cadastro do provedor de IA: o selo do que está configurado, a lista de
// modelos para escolher e o resultado do último teste de conexão.
//
// Saíram do `FormularioProvedorIa` junto com as classes montadas por template literal
// com ternário dentro (`${ativo ? '…' : '…'}`), que o SonarJS acusava em
// `no-nested-template-literals`. Aqui a classe condicional é `cn`, como no resto da tela.

import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import type {
  EstadoPublicoIa,
  ModeloDisponivelIa,
  ResultadoTesteIa,
} from '../../../services/iaService.ts';
import { cn } from '../../../utils/cn.ts';

/** O que o cartão mostra quando ninguém cadastrou chave ainda. */
const SEM_CHAVE =
  'Nenhuma chave cadastrada. Os gráficos funcionam normalmente, mas sem o botão de leitura por IA para os usuários.';

export function SeloDoProvedor({ estado }: { estado: EstadoPublicoIa }) {
  return (
    <div
      className={cn(
        'flex items-center gap-[8px] rounded-[4px] border px-[10px] py-[7px]',
        estado.configurado
          ? 'border-emerald-500/40 bg-emerald-500/10 text-pbi-ink'
          : 'border-pbi-borda bg-pbi-fundo text-pbi-muted',
      )}
    >
      {estado.configurado ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}
      {estado.configurado ? (
        <span>
          Configurado: <b>{estado.tipo}</b> · <code>{estado.modelo}</code> · chave{' '}
          <b>{estado.dica}</b>
          {estado.origem === 'env' ? ' (vindo do .env)' : ''}
          {estado.atualizadoPor ? ` · por ${estado.atualizadoPor}` : ''}
        </span>
      ) : (
        <span>{SEM_CHAVE}</span>
      )}
    </div>
  );
}

interface SeletorDeModelosProps {
  /** Os modelos que a chave listou; vazio cai nos sugeridos. */
  modelosDaChave: readonly ModeloDisponivelIa[];
  modelosSugeridos: readonly ModeloDisponivelIa[];
  modeloEscolhido: string;
  aoEscolher: (modelo: string) => void;
}

/** O rótulo de um modelo: "nome (id)" quando os dois diferem, senão só o id. */
function rotuloDoModelo(modelo: ModeloDisponivelIa): string {
  return modelo.label !== modelo.id ? `${modelo.label} (${modelo.id})` : modelo.id;
}

export function SeletorDeModelos({
  modelosDaChave,
  modelosSugeridos,
  modeloEscolhido,
  aoEscolher,
}: SeletorDeModelosProps) {
  const daChave = modelosDaChave.length > 0;
  const lista = daChave ? modelosDaChave : modelosSugeridos;
  const titulo = daChave
    ? `Modelos da chave (${modelosDaChave.length}) — clique para selecionar:`
    : 'Modelos sugeridos — clique para selecionar:';

  return (
    <div className="flex flex-col gap-[4px]">
      <span className="text-[0.7rem] font-semibold text-pbi-muted">{titulo}</span>
      <div
        className="flex max-h-[124px] flex-wrap gap-[5px] overflow-y-auto rounded-[4px] border border-pbi-borda bg-pbi-fundo p-[6px]"
        role="listbox"
        aria-label="Lista de modelos disponíveis"
      >
        {lista.map((modelo) => {
          const ativo = modeloEscolhido === modelo.id;
          return (
            <button
              key={modelo.id}
              type="button"
              aria-pressed={ativo}
              onClick={() => aoEscolher(modelo.id)}
              className={cn(
                'cursor-pointer rounded-[4px] border px-[8px] py-[3px] text-[0.72rem] font-semibold transition-colors',
                ativo
                  ? 'border-pbi-primary bg-pbi-primary text-pbi-sobre-primary'
                  : 'border-pbi-borda bg-pbi-superficie text-pbi-ink hover:border-pbi-primary hover:text-pbi-primary-texto',
              )}
            >
              {rotuloDoModelo(modelo)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** O resultado do último "Testar conexão" — some enquanto ninguém testou. */
export function ResultadoDoTeste({ teste }: { teste: ResultadoTesteIa | null }) {
  if (!teste) return null;
  const amostra = teste.amostra ?? 'OK';
  const texto = teste.ok
    ? `conexão ok em ${teste.ms} ms — resposta: "${amostra}"`
    : `falhou: ${teste.erro ?? 'erro desconhecido'}`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] font-semibold',
        teste.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-pbi-critico',
      )}
    >
      {teste.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
      {texto}
    </span>
  );
}
