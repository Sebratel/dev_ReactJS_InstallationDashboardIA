// O portão de login FALHA FECHADO. Não é paranoia: é o defeito que a primeira
// subida do container revelou, em 04/09/2026.
//
// O QUE ACONTECEU. `GOOGLE_CLIENT_ID` está VAZIA no `.env` (o normal para
// desenvolver), e o construtor do `Servidor` só recebe `googleClientId` quando a
// variável é preenchida. Sem ela, o `Servidor` usa a identidade `dev-local` e
// **serve tudo a todo pedido**. Rodando a stack de `docker-compose.prod.yml`:
//
//     GET /api/dashboards/visao-geral -> 200   (sem sessão nenhuma)
//
// Ou seja: CLIENTE, TELEFONE e endereço servidos a quem alcançasse a URL. O log
// dizia a verdade — *"Login: DESLIGADO — GOOGLE_CLIENT_ID ausente"* — e subia do
// mesmo jeito. **Uma trava que degrada em silêncio não é trava.**
//
// POR QUE O `NODE_ENV` NÃO BASTAVA SOZINHO: o `Dockerfile` declara
// `ENV NODE_ENV=production`, mas o `env_file: .env` do compose **sobrescreve** —
// dentro do container medimos `NODE_ENV=development`. Por isso o compose passa
// `NODE_ENV` no bloco `environment:` (que vence `env_file:`), e por isso a guarda
// é DUPLA: rodar sem credencial exige declarar a intenção, e declarar a intenção
// é incompatível com produção.
//
// POR QUE ISTO É UM MÓDULO E NÃO UM `if` NO `index.ts`. Porque lá estava — e um
// `if` dentro de um arquivo que abre porta, sobe piscina de workers e lê snapshot
// não tem como ser testado sem subir tudo. A decisão é pura: entra ambiente,
// saem três estados. `test/portao-login.test.ts` cobre as duas recusas.

export type DecisaoLogin =
  | { tipo: 'exige-credencial'; semLogin: false }
  | { tipo: 'sem-login-declarado'; semLogin: true }
  | { tipo: 'recusa'; motivo: 'sem-credencial' | 'sem-login-em-producao'; mensagem: string };

/**
 * Decide se a API pode subir, dado o ambiente.
 *
 * Três saídas, e nenhuma delas é "sobe assim mesmo":
 *   - `exige-credencial`      -> tem GOOGLE_CLIENT_ID; o portão liga.
 *   - `sem-login-declarado`   -> não tem, mas alguém disse SEM_LOGIN=1 fora de produção.
 *   - `recusa`                -> o processo tem de morrer, com a mensagem que explica.
 */
export function decideLogin(
  env: Record<string, string | undefined>,
  argv: readonly string[] = [],
): DecisaoLogin {
  const semLogin = env.SEM_LOGIN === '1' || argv.includes('--sem-login');
  // `Boolean` e não `!== undefined`: string vazia é o caso REAL do `.env` deste
  // projeto, e era exatamente ela que fazia o portão falhar aberto.
  // Desde 16/09/2026 há DOIS provedores possíveis, e qualquer um deles conta
  // como credencial: `GOOGLE_CLIENT_ID` (Google Identity Services puro) e
  // `FIREBASE_PROJECT_ID` (Firebase Authentication). Basta um.
  //
  // Olhar só o `GOOGLE_CLIENT_ID` aqui teria um efeito perverso: com a tela já
  // migrada para o Firebase, o `.env` de produção não preenche mais aquela
  // variável — e esta guarda recusaria subir uma stack perfeitamente
  // autenticada, o que empurra quem estiver de plantão para `SEM_LOGIN=1`.
  // Trava que atrapalha o caso certo acaba desligada.
  const temClientId = Boolean(env.GOOGLE_CLIENT_ID) || Boolean(env.FIREBASE_PROJECT_ID);
  const producao = env.NODE_ENV === 'production';

  if (semLogin && producao) {
    return {
      tipo: 'recusa',
      motivo: 'sem-login-em-producao',
      mensagem:
        `\n[login] RECUSANDO SUBIR: SEM_LOGIN=1 com NODE_ENV=production.\n\n` +
        `  Desligar o login numa imagem de produção serviria dado pessoal sem\n` +
        `  autenticação. Se a intenção é um piloto sem login, tire o\n` +
        `  NODE_ENV=production — assim o modo fica visível em vez de implícito.\n`,
    };
  }

  if (!temClientId && !semLogin) {
    return {
      tipo: 'recusa',
      motivo: 'sem-credencial',
      mensagem:
        `\n[login] RECUSANDO SUBIR: nenhum provedor de login configurado.\n\n` +
        `  Nem FIREBASE_PROJECT_ID nem GOOGLE_CLIENT_ID estão preenchidas, e sem\n` +
        `  uma delas nenhum pedido é autenticado — o que esta API serve inclui\n` +
        `  nome, telefone e endereço de cliente. Antes desta guarda, o processo\n` +
        `  subia e respondia 200 para /api/dashboards/* sem sessão nenhuma.\n\n` +
        `  Para PRODUÇÃO: preencha FIREBASE_PROJECT_ID (e DOMINIO_CORPORATIVO) —\n` +
        `  ou GOOGLE_CLIENT_ID, se o ambiente ainda usar o Google Identity puro.\n` +
        `  Para DESENVOLVER sem login, declare a intenção:\n` +
        `      SEM_LOGIN=1 npm run api        (ou: npm run api -- --sem-login)\n`,
    };
  }

  return semLogin
    ? { tipo: 'sem-login-declarado', semLogin: true }
    : { tipo: 'exige-credencial', semLogin: false };
}
