// Montagem de URL de API, num lugar só.
//
// O mesmo `${q ? `?${q}` : ''}` estava escrito em três serviços — template dentro de
// template, com um ternário no meio, que o SonarJS acusa em `no-nested-template-literals`.
// Aqui a decisão "tem parâmetro?" é uma função com nome, e o ponto de interrogação sai
// do caminho de quem monta a URL.

/**
 * O caminho com a query string, quando há alguma.
 *
 * Aceita tanto `URLSearchParams` quanto a string já pronta; vazio em qualquer um dos
 * dois devolve o caminho intacto — importante porque a URL É a chave do cache do React
 * Query, e um `?` sobrando faria a abertura e o primeiro filtro virarem entradas
 * diferentes para o mesmo estado.
 */
export function comConsulta(caminho: string, parametros: URLSearchParams | string): string {
  const consulta = typeof parametros === 'string' ? parametros : parametros.toString();
  return consulta ? `${caminho}?${consulta}` : caminho;
}

/** Acrescenta um parâmetro a uma URL que pode ou não já ter query string. */
export function comParametroExtra(url: string, nome: string, valor: string): string {
  const separador = url.includes('?') ? '&' : '?';
  return `${url}${separador}${nome}=${encodeURIComponent(valor)}`;
}
