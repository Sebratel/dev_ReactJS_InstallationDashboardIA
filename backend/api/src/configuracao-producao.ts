// O contrato mínimo para publicar a API. Ambiente de desenvolvimento pode usar
// contornos locais; produção não pode depender deles para proteger dados pessoais.

export interface ProblemaDeConfiguracaoDeProducao {
  chave: string;
  esperado: string;
}

const ligado = (valor: string | undefined): boolean => valor === '1' || valor?.toLowerCase() === 'true';

/**
 * Como a porta da API chega ao navegador. Declarado pelo compose, nunca deduzido,
 * porque as formas exigem o contrário uma da outra:
 *
 * - `direta` — a porta da API é publicada sem nada na frente. É HTTP: um cookie `Secure`
 *   nunca voltaria do navegador (login em laço, sem erro), e o `X-Real-IP` seria escrito
 *   pelo próprio cliente — confiar nele dá um balde novo de rate limit por valor forjado.
 * - `web-http` — o contêiner `web` da própria stack (nginx, `nginx.web.conf`) recebe o
 *   navegador em HTTP e repassa à API, que NÃO tem porta publicada. O nginx sobrescreve
 *   `X-Real-IP` com o endereço real, então a API TEM de confiar nele: sem isso, todo
 *   pedido chega do IP do `web`, e a empresa inteira divide um balde de rate limit — 5
 *   logins por minuto e 300 pedidos de dados por minuto para todos (20/10/2026). Cookie
 *   sem `Secure`, porque continua HTTP.
 * - `proxy-https` — um proxy termina TLS e reescreve `X-Real-IP` (`nginx.conf` é a
 *   referência). Aí os dois têm de estar ligados.
 *
 * O que o proxy fazia além disso a API já faz sozinha em produção: `/auth/interno` some
 * (`authInternaAtiva: false`), o cabeçalho do aquecedor só vale com o segredo aleatório
 * do processo, e o corpo passa de 8 KB é recusado.
 */
export const PUBLICACOES = ['direta', 'web-http', 'proxy-https'] as const;

/**
 * Tudo que a stack de produção precisa declarar antes de abrir a porta.
 *
 * Não verifica certificados nem grants aqui: isso pertence à infraestrutura. A
 * função garante que o processo não suba com a publicação incoerente nem sem a
 * conta Maria. A conta Maria compartilhada é uma decisão explícita de operação
 * (19/10/2026).
 *
 * **TLS dos bancos deixou de ser exigido em 19/10/2026** (decisão do Misael): as outras
 * stacks da Sebratel, o Comercial entre elas, conectam sem TLS, e os dois servidores
 * apresentam certificado autoassinado (ACHADOS #232). `*_SSL` seguem lidos por
 * `config.ts`; ligar é opção.
 */
export function problemasDaConfiguracaoDeProducao(
  env: Record<string, string | undefined>,
): ProblemaDeConfiguracaoDeProducao[] {
  if (env.NODE_ENV !== 'production') return [];

  const problemas: ProblemaDeConfiguracaoDeProducao[] = [];
  const exigeLigado = (chave: string, esperado: string) => {
    if (!ligado(env[chave])) problemas.push({ chave, esperado });
  };
  const exigeDesligado = (chave: string, esperado: string) => {
    if (ligado(env[chave])) problemas.push({ chave, esperado });
  };
  const exigeValor = (chave: string, esperado: string) => {
    if (!env[chave]?.trim()) problemas.push({ chave, esperado });
  };

  const publicacao = env.PUBLICACAO;
  if (publicacao === 'direta') {
    exigeDesligado('COOKIE_SECURE', '0 (PUBLICACAO=direta é HTTP: cookie Secure não volta e o login não fecha)');
    exigeDesligado('CONFIA_PROXY', '0 (PUBLICACAO=direta: sem proxy, X-Real-IP vem do cliente e fura o rate limit)');
  } else if (publicacao === 'web-http') {
    exigeDesligado('COOKIE_SECURE', '0 (PUBLICACAO=web-http é HTTP: cookie Secure não volta e o login não fecha)');
    exigeLigado('CONFIA_PROXY', '1 (PUBLICACAO=web-http: sem ele, todos os usuários dividem o rate limit do IP do web)');
  } else if (publicacao === 'proxy-https') {
    exigeLigado('COOKIE_SECURE', '1 (HTTPS terminado pelo proxy)');
    exigeLigado('CONFIA_PROXY', '1 (proxy que sobrescreve X-Real-IP)');
  } else {
    problemas.push({ chave: 'PUBLICACAO', esperado: `${PUBLICACOES.map((p) => `'${p}'`).join(' ou ')}` });
  }
  exigeValor('MARIA_HOST', 'host do MariaDB');
  exigeValor('MARIA_USER', 'usuário MariaDB configurado para a stack');
  exigeValor('MARIA_PASSWORD', 'senha do usuário MariaDB configurado para a stack');

  return problemas;
}

export function mensagemDaConfiguracaoDeProducao(problemas: readonly ProblemaDeConfiguracaoDeProducao[]): string {
  const itens = problemas.map((p) => `  - ${p.chave}: esperado ${p.esperado}`).join('\n');
  return (
    `\n[segurança] RECUSANDO SUBIR: configuração de produção incompleta.\n\n` +
    `${itens}\n\n` +
    `  Não publique a API com a publicação incoerente.\n` +
    `  PUBLICACAO=direta: COOKIE_SECURE=0 e CONFIA_PROXY=0. PUBLICACAO=web-http: COOKIE_SECURE=0 e\n` +
    `  CONFIA_PROXY=1. PUBLICACAO=proxy-https: os dois em 1.\n` +
    `  Veja docs/PORTAINER.md antes de subir a stack.\n`
  );
}
