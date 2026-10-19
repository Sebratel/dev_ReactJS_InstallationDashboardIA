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
 * função garante que o processo não volte a subir em HTTP ou sem TLS no banco.
 * A conta Maria compartilhada é uma decisão explícita de operação (19/10/2026).
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
  exigeLigado('MARIA_SSL', '1');
  exigeLigado('MARIA_SSL_REJECT_UNAUTHORIZED', '1');
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
    `  Não publique a API em HTTP ou com TLS de banco desligado.\n` +
    `  Veja docs/DEPLOY.md antes de subir a stack.\n`
  );
}
