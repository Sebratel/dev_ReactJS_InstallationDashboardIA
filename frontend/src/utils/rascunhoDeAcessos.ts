// O rascunho da aba PERMISSÕES: o que a pessoa mexeu na matriz e ainda não salvou.
//
// Até 14/10/2026 cada caixinha gravava na hora — sem botão de confirmar, um clique
// errado já valia (e virava evento de auditoria). Agora a tela guarda só as DIFERENÇAS
// em relação ao que o servidor devolveu, e "Salvar alterações" as transforma em pedidos
// (`operacoesDoRascunho`). Guardar diferença, e não uma cópia da matriz, é o que deixa
// outro admin mexer ao mesmo tempo: o que este não tocou continua vindo do banco.
//
// Puro de propósito: nada de rede nem de React aqui — `test/rascunho-de-acessos.test.ts`.

import type {
  MatrizDeAcesso,
  ModoDaTela,
  Papel,
  PessoaDeAcesso,
} from '../services/acessoService.ts';

export interface RascunhoDeAcessos {
  /** Aba → modo pedido. */
  modos: Record<string, ModoDaTela>;
  /** E-mail → papel pedido. */
  papeis: Record<string, Papel>;
  /** E-mail → a lista inteira de abas pedida (o servidor grava a LINHA da pessoa). */
  telas: Record<string, string[]>;
  /** Quem perde todos os acessos ao salvar. */
  removidos: string[];
  /** Quem foi adicionado pela tela e ainda não existe no banco. */
  novos: string[];
}

export const RASCUNHO_VAZIO: RascunhoDeAcessos = {
  modos: {},
  papeis: {},
  telas: {},
  removidos: [],
  novos: [],
};

export type OperacaoDeAcesso =
  | { tipo: 'modo'; tela: string; modo: ModoDaTela }
  | { tipo: 'remove'; email: string }
  | { tipo: 'papel'; email: string; papel: Papel }
  | { tipo: 'telas'; email: string; telas: string[] };

/** A linha da matriz: o que veio do servidor (situação, perfil, último acesso) mais o
 *  estado do rascunho. */
export interface PessoaNaTela extends PessoaDeAcesso {
  nova: boolean;
  removida: boolean;
  /** Alguma coisa desta linha muda ao salvar. */
  mudou: boolean;
}

const mesmoConjunto = (uma: readonly string[], outra: readonly string[]) =>
  uma.length === outra.length && uma.every((item) => outra.includes(item));

const semChave = <T>(objeto: Record<string, T>, chave: string) => {
  const { [chave]: _, ...resto } = objeto;
  return resto;
};

/** A matriz como fica depois de salvar — o que a tela desenha. */
export function matrizComRascunho(matriz: MatrizDeAcesso, rascunho: RascunhoDeAcessos) {
  const telas = matriz.telas.map((tela) => ({
    ...tela,
    modo: rascunho.modos[tela.id] ?? tela.modo,
    mudou: rascunho.modos[tela.id] !== undefined && rascunho.modos[tela.id] !== tela.modo,
  }));
  const doBanco = matriz.pessoas.map((pessoa) => ({ ...pessoa, nova: false }));
  const novas = rascunho.novos
    .filter((emailNovo) => !matriz.pessoas.some((pessoa) => pessoa.email === emailNovo))
    .map((email) => ({
      email,
      papel: 'viewer' as Papel,
      fixo: false,
      telas: [] as string[],
      nova: true,
    }));
  const pessoas: PessoaNaTela[] = [...doBanco, ...novas].map((ponto) => {
    const papel = rascunho.papeis[ponto.email] ?? ponto.papel;
    const lista = rascunho.telas[ponto.email] ?? ponto.telas;
    const removida = rascunho.removidos.includes(ponto.email);
    return {
      ...ponto,
      papel,
      telas: lista,
      removida,
      mudou: ponto.nova || removida || papel !== ponto.papel || !mesmoConjunto(lista, ponto.telas),
    };
  });
  return { telas, pessoas };
}

/**
 * Os pedidos que "Salvar" faz, na ordem em que faz: primeiro o modo das abas, depois
 * quem sai, depois papel e abas de cada um. Uma diferença que já coincide com o banco
 * (outro admin fez o mesmo, ou a pessoa desmarcou o que marcou) não vira pedido.
 */
export function operacoesDoRascunho(
  matriz: MatrizDeAcesso,
  rascunho: RascunhoDeAcessos,
): OperacaoDeAcesso[] {
  const noBanco = new Map(matriz.pessoas.map((pessoa) => [pessoa.email, pessoa]));
  return [
    ...mudancasDeModo(matriz, rascunho),
    ...remocoes(rascunho, noBanco),
    ...mudancasPorPessoa(rascunho, noBanco),
  ];
}

/** As abas cujo modo (lista/todos) mudou. */
function mudancasDeModo(matriz: MatrizDeAcesso, rascunho: RascunhoDeAcessos): OperacaoDeAcesso[] {
  const operacoes: OperacaoDeAcesso[] = [];
  for (const tela of matriz.telas) {
    const modo = rascunho.modos[tela.id];
    if (modo !== undefined && modo !== tela.modo) {
      operacoes.push({ tipo: 'modo', tela: tela.id, modo });
    }
  }
  return operacoes;
}

/** Quem sai — só quem existe no banco; remover quem nunca foi gravado não é pedido. */
function remocoes(
  rascunho: RascunhoDeAcessos,
  noBanco: ReadonlyMap<string, { papel: Papel; telas: string[] }>,
): OperacaoDeAcesso[] {
  return rascunho.removidos
    .filter((email) => noBanco.has(email))
    .map((email): OperacaoDeAcesso => ({ tipo: 'remove', email }));
}

/** Papel e abas de cada pessoa que fica. */
function mudancasPorPessoa(
  rascunho: RascunhoDeAcessos,
  noBanco: ReadonlyMap<string, { papel: Papel; telas: string[] }>,
): OperacaoDeAcesso[] {
  const novos = rascunho.novos.filter((email) => !noBanco.has(email));
  const operacoes: OperacaoDeAcesso[] = [];

  for (const email of [...noBanco.keys(), ...novos]) {
    if (rascunho.removidos.includes(email)) continue;
    const atual = noBanco.get(email) ?? { papel: 'viewer' as Papel, telas: [] as string[] };

    const papel = rascunho.papeis[email];
    if (papel !== undefined && papel !== atual.papel) {
      operacoes.push({ tipo: 'papel', email, papel });
    }

    const telas = rascunho.telas[email];
    if (telas !== undefined && !mesmoConjunto(telas, atual.telas)) {
      operacoes.push({ tipo: 'telas', email, telas });
    }
  }
  return operacoes;
}

/** Tira do rascunho o que um pedido já gravou — para, se o seguinte falhar, sobrar só o resto. */
export function semOperacao(
  rascunho: RascunhoDeAcessos,
  operacao: OperacaoDeAcesso,
): RascunhoDeAcessos {
  switch (operacao.tipo) {
    case 'modo':
      return { ...rascunho, modos: semChave(rascunho.modos, operacao.tela) };
    case 'remove':
      return {
        ...rascunho,
        removidos: rascunho.removidos.filter((emailRemovido) => emailRemovido !== operacao.email),
        papeis: semChave(rascunho.papeis, operacao.email),
        telas: semChave(rascunho.telas, operacao.email),
      };
    case 'papel':
      return { ...rascunho, papeis: semChave(rascunho.papeis, operacao.email) };
    case 'telas':
      return { ...rascunho, telas: semChave(rascunho.telas, operacao.email) };
  }
}

/** Em português, para a lista "o que vai mudar" ao lado do botão de salvar. */
export function descreveOperacao(
  operacao: OperacaoDeAcesso,
  nomeDaTela: (id: string) => string,
): string {
  switch (operacao.tipo) {
    case 'modo':
      return operacao.modo === 'todos'
        ? `${nomeDaTela(operacao.tela)}: aberta para todos`
        : `${nomeDaTela(operacao.tela)}: só quem estiver marcado`;
    case 'remove':
      return `${operacao.email}: perde todos os acessos`;
    case 'papel':
      return `${operacao.email}: papel vira ${operacao.papel}`;
    case 'telas':
      return operacao.telas.length === 0
        ? `${operacao.email}: nenhuma aba`
        : `${operacao.email}: ${operacao.telas.map(nomeDaTela).join(', ')}`;
  }
}

// As edições — cada uma devolve o rascunho novo e APAGA a diferença quando o valor
// pedido volta a ser o do banco, para "desfazer na mão" zerar o contador.

export function comModo(
  matriz: MatrizDeAcesso,
  rascunho: RascunhoDeAcessos,
  tela: string,
  modo: ModoDaTela,
) {
  const doBanco = matriz.telas.find((telaAtual) => telaAtual.id === tela)?.modo;
  return {
    ...rascunho,
    modos: modo === doBanco ? semChave(rascunho.modos, tela) : { ...rascunho.modos, [tela]: modo },
  };
}

export function comPapel(
  matriz: MatrizDeAcesso,
  rascunho: RascunhoDeAcessos,
  email: string,
  papel: Papel,
) {
  const doBanco = matriz.pessoas.find((pessoa) => pessoa.email === email)?.papel ?? 'viewer';
  return {
    ...rascunho,
    papeis:
      papel === doBanco ? semChave(rascunho.papeis, email) : { ...rascunho.papeis, [email]: papel },
  };
}

export function comTela(
  matriz: MatrizDeAcesso,
  rascunho: RascunhoDeAcessos,
  email: string,
  tela: string,
  marcada: boolean,
) {
  const doBanco = matriz.pessoas.find((pessoa) => pessoa.email === email)?.telas ?? [];
  const antes = rascunho.telas[email] ?? doBanco;
  const depois = marcada
    ? [...antes.filter((abaAnterior) => abaAnterior !== tela), tela]
    : antes.filter((abaAnterior) => abaAnterior !== tela);
  return {
    ...rascunho,
    telas: mesmoConjunto(depois, doBanco)
      ? semChave(rascunho.telas, email)
      : { ...rascunho.telas, [email]: depois },
  };
}

export function comPessoa(rascunho: RascunhoDeAcessos, email: string): RascunhoDeAcessos {
  const entrada = email.trim().toLowerCase();
  if (entrada === '' || rascunho.novos.includes(entrada)) return rascunho;
  return {
    ...rascunho,
    novos: [...rascunho.novos, entrada],
    removidos: rascunho.removidos.filter((removido) => removido !== entrada),
  };
}

/** A lixeira: quem é novo some do rascunho; quem está no banco alterna "vai sair". */
export function alternaRemocao(matriz: MatrizDeAcesso, rascunho: RascunhoDeAcessos, email: string) {
  if (!matriz.pessoas.some((pessoa) => pessoa.email === email)) {
    return {
      ...rascunho,
      novos: rascunho.novos.filter((emailNovo) => emailNovo !== email),
      papeis: semChave(rascunho.papeis, email),
      telas: semChave(rascunho.telas, email),
    };
  }
  return {
    ...rascunho,
    removidos: rascunho.removidos.includes(email)
      ? rascunho.removidos.filter((emailRemovido) => emailRemovido !== email)
      : [...rascunho.removidos, email],
  };
}
