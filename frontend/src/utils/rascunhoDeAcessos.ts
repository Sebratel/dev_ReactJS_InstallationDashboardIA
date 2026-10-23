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

const mesmoConjunto = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

const semChave = <T>(o: Record<string, T>, k: string) => {
  const { [k]: _, ...resto } = o;
  return resto;
};

/** A matriz como fica depois de salvar — o que a tela desenha. */
export function matrizComRascunho(m: MatrizDeAcesso, r: RascunhoDeAcessos) {
  const telas = m.telas.map((t) => ({
    ...t,
    modo: r.modos[t.id] ?? t.modo,
    mudou: r.modos[t.id] !== undefined && r.modos[t.id] !== t.modo,
  }));
  const doBanco = m.pessoas.map((p) => ({ ...p, nova: false }));
  const novas = r.novos
    .filter((e) => !m.pessoas.some((p) => p.email === e))
    .map((email) => ({
      email,
      papel: 'viewer' as Papel,
      fixo: false,
      telas: [] as string[],
      nova: true,
    }));
  const pessoas: PessoaNaTela[] = [...doBanco, ...novas].map((p) => {
    const papel = r.papeis[p.email] ?? p.papel;
    const lista = r.telas[p.email] ?? p.telas;
    const removida = r.removidos.includes(p.email);
    return {
      ...p,
      papel,
      telas: lista,
      removida,
      mudou: p.nova || removida || papel !== p.papel || !mesmoConjunto(lista, p.telas),
    };
  });
  return { telas, pessoas };
}

/**
 * Os pedidos que "Salvar" faz, na ordem em que faz: primeiro o modo das abas, depois
 * quem sai, depois papel e abas de cada um. Uma diferença que já coincide com o banco
 * (outro admin fez o mesmo, ou a pessoa desmarcou o que marcou) não vira pedido.
 */
export function operacoesDoRascunho(m: MatrizDeAcesso, r: RascunhoDeAcessos): OperacaoDeAcesso[] {
  const ops: OperacaoDeAcesso[] = [];
  for (const t of m.telas) {
    const modo = r.modos[t.id];
    if (modo !== undefined && modo !== t.modo) ops.push({ tipo: 'modo', tela: t.id, modo });
  }
  const noBanco = new Map(m.pessoas.map((p) => [p.email, p]));
  for (const email of r.removidos) {
    if (noBanco.has(email)) ops.push({ tipo: 'remove', email });
  }
  const emails = [...noBanco.keys(), ...r.novos.filter((e) => !noBanco.has(e))];
  for (const email of emails) {
    if (r.removidos.includes(email)) continue;
    const atual = noBanco.get(email) ?? { papel: 'viewer' as Papel, telas: [] as string[] };
    const papel = r.papeis[email];
    if (papel !== undefined && papel !== atual.papel) ops.push({ tipo: 'papel', email, papel });
    const telas = r.telas[email];
    if (telas !== undefined && !mesmoConjunto(telas, atual.telas))
      ops.push({ tipo: 'telas', email, telas });
  }
  return ops;
}

/** Tira do rascunho o que um pedido já gravou — para, se o seguinte falhar, sobrar só o resto. */
export function semOperacao(r: RascunhoDeAcessos, op: OperacaoDeAcesso): RascunhoDeAcessos {
  switch (op.tipo) {
    case 'modo':
      return { ...r, modos: semChave(r.modos, op.tela) };
    case 'remove':
      return {
        ...r,
        removidos: r.removidos.filter((e) => e !== op.email),
        papeis: semChave(r.papeis, op.email),
        telas: semChave(r.telas, op.email),
      };
    case 'papel':
      return { ...r, papeis: semChave(r.papeis, op.email) };
    case 'telas':
      return { ...r, telas: semChave(r.telas, op.email) };
  }
}

/** Em português, para a lista "o que vai mudar" ao lado do botão de salvar. */
export function descreveOperacao(op: OperacaoDeAcesso, nomeDaTela: (id: string) => string): string {
  switch (op.tipo) {
    case 'modo':
      return op.modo === 'todos'
        ? `${nomeDaTela(op.tela)}: aberta para todos`
        : `${nomeDaTela(op.tela)}: só quem estiver marcado`;
    case 'remove':
      return `${op.email}: perde todos os acessos`;
    case 'papel':
      return `${op.email}: papel vira ${op.papel}`;
    case 'telas':
      return op.telas.length === 0
        ? `${op.email}: nenhuma aba`
        : `${op.email}: ${op.telas.map(nomeDaTela).join(', ')}`;
  }
}

// As edições — cada uma devolve o rascunho novo e APAGA a diferença quando o valor
// pedido volta a ser o do banco, para "desfazer na mão" zerar o contador.

export function comModo(m: MatrizDeAcesso, r: RascunhoDeAcessos, tela: string, modo: ModoDaTela) {
  const doBanco = m.telas.find((t) => t.id === tela)?.modo;
  return { ...r, modos: modo === doBanco ? semChave(r.modos, tela) : { ...r.modos, [tela]: modo } };
}

export function comPapel(m: MatrizDeAcesso, r: RascunhoDeAcessos, email: string, papel: Papel) {
  const doBanco = m.pessoas.find((p) => p.email === email)?.papel ?? 'viewer';
  return {
    ...r,
    papeis: papel === doBanco ? semChave(r.papeis, email) : { ...r.papeis, [email]: papel },
  };
}

export function comTela(
  m: MatrizDeAcesso,
  r: RascunhoDeAcessos,
  email: string,
  tela: string,
  marcada: boolean,
) {
  const doBanco = m.pessoas.find((p) => p.email === email)?.telas ?? [];
  const antes = r.telas[email] ?? doBanco;
  const depois = marcada
    ? [...antes.filter((t) => t !== tela), tela]
    : antes.filter((t) => t !== tela);
  return {
    ...r,
    telas: mesmoConjunto(depois, doBanco)
      ? semChave(r.telas, email)
      : { ...r.telas, [email]: depois },
  };
}

export function comPessoa(r: RascunhoDeAcessos, email: string): RascunhoDeAcessos {
  const e = email.trim().toLowerCase();
  if (e === '' || r.novos.includes(e)) return r;
  return { ...r, novos: [...r.novos, e], removidos: r.removidos.filter((x) => x !== e) };
}

/** A lixeira: quem é novo some do rascunho; quem está no banco alterna "vai sair". */
export function alternaRemocao(m: MatrizDeAcesso, r: RascunhoDeAcessos, email: string) {
  if (!m.pessoas.some((p) => p.email === email)) {
    return {
      ...r,
      novos: r.novos.filter((e) => e !== email),
      papeis: semChave(r.papeis, email),
      telas: semChave(r.telas, email),
    };
  }
  return {
    ...r,
    removidos: r.removidos.includes(email)
      ? r.removidos.filter((e) => e !== email)
      : [...r.removidos, email],
  };
}
