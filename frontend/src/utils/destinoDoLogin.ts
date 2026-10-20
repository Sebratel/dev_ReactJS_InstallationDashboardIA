// O endereço que a pessoa queria abrir quando a sessão faltou.
//
// **Por que sai da URL.** A tela de login não é página do relatório: com `?pagina=…`
// na barra, o endereço dizia uma coisa e a tela mostrava outra, e copiar o link dali
// mandava adiante um "protocolos-detalhados" que ninguém estava vendo. Mas jogar o
// destino fora quebraria o link compartilhado (`rota.ts`), que é justamente o motivo
// de o estado morar na URL. Então ele fica guardado na aba (`sessionStorage`) enquanto
// o login está aberto e volta para a barra assim que a sessão existe.

const CHAVE = 'destino-do-login';

/** Tira o destino da barra, guardando-o para depois do login. */
export function guardaDestino(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location,
): void {
  const destino = `${loc.pathname}${loc.search}${loc.hash}`;
  if (destino === '/') return;
  try {
    sessionStorage.setItem(CHAVE, destino);
  } catch {
    // Sem armazenamento (aba privada, bloqueio): o login leva para a capa.
  }
  window.history.replaceState(window.history.state, '', '/');
}

/** O destino guardado — consumido, para não reabrir o mesmo filtro no próximo login. */
export function retiraDestino(): string {
  try {
    const destino = sessionStorage.getItem(CHAVE);
    sessionStorage.removeItem(CHAVE);
    // Só caminho do próprio site: nada de `//outro-host` vindo do armazenamento.
    if (destino && destino.startsWith('/') && !destino.startsWith('//')) return destino;
  } catch {
    // idem acima
  }
  return '/';
}
