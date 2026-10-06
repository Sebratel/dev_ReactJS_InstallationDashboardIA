// Login de ferramenta de linha de comando contra a API — compartilhado entre
// `varre.ts` e `perf.ts`, os dois dirigem um NAVEGADOR DE VERDADE, onde o
// React roda e pede `/api/*` como qualquer visitante.
//
// Desde o login (01/09/2026), `/api/*` exige sessão — sem uma sessão de
// verdade aqui, toda página cairia na tela de login e `[data-selo]` nunca
// apareceria: dezenas de timeouts de 15s em vez de um erro claro de
// configuração. `POST /auth/interno` (`TOKEN_INTERNO` do `.env`) é a única
// forma de logar sem conta do Google — ver `backend/api/src/servidor.ts`.

export interface CookieDeSessao {
  name: string;
  value: string;
}

export async function logaComoFerramenta(base: string): Promise<CookieDeSessao> {
  const token = process.env.TOKEN_INTERNO;
  if (!token) {
    console.error(
      'TOKEN_INTERNO ausente no .env — sem ele, /auth/interno recusa e toda página cai no login. ' +
        'Configure TOKEN_INTERNO (o mesmo valor no .env do servidor e aqui) antes de rodar esta ferramenta.',
    );
    process.exit(2);
  }
  const resposta = await fetch(`${base}/auth/interno`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const cookieBruto = resposta.headers.get('set-cookie');
  if (!resposta.ok || !cookieBruto) {
    console.error(`login interno recusado (HTTP ${resposta.status}) — confira se o TOKEN_INTERNO bate dos dois lados.`);
    process.exit(2);
  }
  const [nome, valor] = cookieBruto.split(';')[0]!.split('=');
  return { name: nome!, value: decodeURIComponent(valor!) };
}
