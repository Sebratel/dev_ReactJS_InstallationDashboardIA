// O contrato mínimo para publicar a API. Ambiente de desenvolvimento pode usar
// contornos locais; produção não pode depender deles para proteger dados pessoais.

export interface ProblemaDeConfiguracaoDeProducao {
  chave: string;
  esperado: string;
}

const ligado = (valor: string | undefined): boolean => valor === '1' || valor?.toLowerCase() === 'true';

/**
 * Tudo que a stack de produção precisa declarar antes de abrir a porta.
 *
 * Não verifica certificados nem grants aqui: isso pertence à infraestrutura. A
 * função garante que o processo não volte a subir em HTTP, sem TLS no banco ou
 * com a credencial Maria compartilhada por acidente.
 */
export function problemasDaConfiguracaoDeProducao(
  env: Record<string, string | undefined>,
): ProblemaDeConfiguracaoDeProducao[] {
  if (env.NODE_ENV !== 'production') return [];

  const problemas: ProblemaDeConfiguracaoDeProducao[] = [];
  const exigeLigado = (chave: string, esperado: string) => {
    if (!ligado(env[chave])) problemas.push({ chave, esperado });
  };
  const exigeValor = (chave: string, esperado: string) => {
    if (!env[chave]?.trim()) problemas.push({ chave, esperado });
  };

  exigeLigado('COOKIE_SECURE', '1 (HTTPS terminado pelo proxy)');
  exigeLigado('CONFIA_PROXY', '1 (proxy que sobrescreve X-Real-IP)');
  exigeLigado('VOALLE_SSL', '1');
  exigeLigado('VOALLE_SSL_REJECT_UNAUTHORIZED', '1');
  exigeLigado('ACESSO_DB_SSL', '1');
  exigeValor('ACESSO_DB_HOST', 'host do DB_InstallationDashboard');
  exigeValor('ACESSO_DB_USER', 'usuário installation_access');
  exigeValor('ACESSO_DB_PASSWORD', 'senha do usuário installation_access');

  return problemas;
}

export function mensagemDaConfiguracaoDeProducao(problemas: readonly ProblemaDeConfiguracaoDeProducao[]): string {
  const itens = problemas.map((p) => `  - ${p.chave}: esperado ${p.esperado}`).join('\n');
  return (
    `\n[segurança] RECUSANDO SUBIR: configuração de produção incompleta.\n\n` +
    `${itens}\n\n` +
    `  Não publique a API em HTTP, com TLS de banco desligado ou usando MARIA_USER\n` +
    `  compartilhado. Veja docs/DEPLOY.md antes de subir a stack.\n`
  );
}
