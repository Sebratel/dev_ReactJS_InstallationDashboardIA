// `npm start` precisa mesmo declarar `--sem-login`? Decide isso olhando o ambiente.
//
// **O DEFEITO QUE ISTO CONSERTA (18/09/2026, ACHADOS #136).** `subir` passava
// `--sem-login` INCONDICIONALMENTE, por um motivo que era verdadeiro em 04/09 e
// deixou de ser em 16/09: naquela época nenhum provedor de login estava
// configurado, `decideLogin` RECUSAVA subir sem a declaração, e a bandeira era o
// que fazia `npm start` funcionar.
//
// Depois que `FIREBASE_PROJECT_ID` foi preenchida, a bandeira virou ruído com
// consequência: `decideLogin` devolve `sem-login-declarado`, e a API imprime na
// subida
//
//   Login: DESLIGADO por SEM_LOGIN=1/--sem-login — TODO pedido é servido sem sessão
//
// que é **falso**. O portão do `Servidor` só cai para a identidade `dev-local`
// quando NENHUM provedor está configurado; com o Firebase ligado ele exige sessão,
// como deve. Medido em 18/09: seis páginas pedidas a `/api/pagina/*`, seis 401.
//
// Repare que o COMPORTAMENTO estava certo — falhar fechado é o desenho inteiro de
// `portao-login.ts`, e ele veio de um incidente real. Errado estava o RELATO. E um
// relato errado sobre segurança é pior que nenhum: quem lê aquela linha na subida
// conclui que a API está aberta e vai procurar o buraco que não existe — ou, pior,
// conclui que está aberta e para de procurar o dia em que estiver.
//
// A regra aqui é a mesma que `decideLogin` usa para saber se a declaração é
// necessária. Não podia ser outra: duas condições parecidas em dois arquivos
// divergem, e foi assim que esta chegou até aqui.
//
// **LÊ O ARQUIVO, NÃO O `process.env`, e isto não é detalhe.** A primeira versão
// desta correção consultava `process.env` e não mudou NADA — porque em `subir` o
// `applyDotEnv` roda deliberadamente TARDE, dentro de `buscaAutenticado()`, muito
// depois deste spawn. O motivo está documentado lá e é bom: carregar o `.env`
// antes do `spawnSync('npm run web:build')` faz o Vite herdar
// `NODE_ENV=development` e sair sem minificar (281 kB viraram 563 kB, medido).
//
// Então no instante em que a bandeira é decidida, `process.env.FIREBASE_PROJECT_ID`
// é `undefined` — embora o processo FILHO vá enxergá-la, porque ele chama
// `applyDotEnv` por conta própria. Ler o arquivo sem aplicá-lo (`loadDotEnv`)
// responde a pergunta certa sem tocar no ambiente do build.
//
// A precedência é a de `applyDotEnv`: variável já definida no ambiente vence o
// arquivo. Tem de ser a mesma, senão as duas discordam de novo — em outro ponto.

import path from 'node:path';
import { loadDotEnv } from '../../../packages/query-engine/src/config.ts';

/**
 * `true` quando `npm start` precisa declarar `--sem-login` para a API subir —
 * isto é, quando NENHUM provedor de login está configurado.
 *
 * Com provedor configurado devolve `false`, e aí a bandeira não é passada: a API
 * sobe exigindo sessão e diz isso na subida.
 */
export function precisaDeclararSemLogin(env: Record<string, string | undefined>): boolean {
  // `Boolean` e não `!== undefined`: string vazia é o caso real deste `.env`, e é
  // exatamente ela que `portao-login.ts` documenta como a origem do defeito de
  // 04/09. As duas checagens têm de concordar caractere a caractere.
  const temProvedor = Boolean(env.GOOGLE_CLIENT_ID) || Boolean(env.FIREBASE_PROJECT_ID);
  return !temProvedor;
}

/**
 * O mesmo, lendo o `.env` do disco — porque neste ponto do `subir` ele ainda não
 * foi aplicado ao `process.env`, de propósito (ver o comentário do topo).
 *
 * Precedência igual à de `applyDotEnv`: quem já está no ambiente vence o arquivo.
 */
export function precisaDeclararSemLoginNaRaiz(
  raiz: string,
  leArquivo: (caminho: string) => Record<string, string> = loadDotEnv,
  ambiente: Record<string, string | undefined> = process.env,
): boolean {
  const doArquivo = leArquivo(path.join(raiz, '.env'));
  const combinado: Record<string, string | undefined> = { ...doArquivo };
  for (const [k, v] of Object.entries(ambiente)) {
    if (v !== undefined) combinado[k] = v;
  }
  return precisaDeclararSemLogin(combinado);
}
