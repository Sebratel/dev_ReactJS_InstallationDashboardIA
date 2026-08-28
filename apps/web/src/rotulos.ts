// Rótulos de visual.
//
// Aqui morava também `sigla()`, que espremia o nome da página em duas letras para
// caber no ícone da barra lateral FECHADA (62px). Essa barra não existe mais — a
// navegação é a faixa de topo, com o rótulo inteiro visível — e a função ficou sem
// chamador, mas COM quatro testes passando. É a pior forma de código morto: a suíte
// dizia que estava coberto, e o comentário dos testes descrevia uma tela que ninguém
// pode mais abrir. Removida junto com `apps/web/test/rotulos.test.ts`.

/** Título humano para visuais calculados */
export function tituloDoVisual(visual: { spec?: { name?: string; id?: string }; id?: string; titulo?: string }): string {
  if (visual.titulo) return visual.titulo;
  if (visual.spec?.name) return visual.spec.name;
  if (visual.spec?.id) return visual.spec.id;
  if (visual.id) return visual.id;
  return 'Visual';
}

// ---------------------------------------------------------------------------
// TÍTULO DERIVADO — porque `tituloDoVisual` cai no id, e o id é um hash.
//
// `VisualCalculado` não tem `titulo` nem `spec`: a extração do Power BI trouxe nome
// de CAMPO (`specs/dashboards/*.spec.yaml`, chave `name`) e nenhum nome de VISUAL.
// Com isso as três primeiras linhas de `tituloDoVisual` nunca casam e toda tabela e
// toda matriz aparecem com o cabeçalho `05da970602ab7c4abced`. Medido em 27/08/2026
// na AGENDAMENTO FIELD: 10 dos 15 cards da página, e o mesmo em todas as 14 telas.
//
// `Grafico` já não sofria disso porque monta a frase a partir das séries e do eixo
// ("Qtd Protocolos Base por Data"). Aqui é o MESMO idioma, aplicado às outras duas
// formas — os dados que chegam já trazem os nomes, então nada disto precisa de ida
// à API.
// ---------------------------------------------------------------------------

/** No máximo três medidas no título: a quarta já não cabe no cabeçalho do card. */
const MAX_MEDIDAS = 3;

/** Nomes úteis, na ordem, sem repetido, sem vazio e sem o `"."` que a extração deixa. */
function nomesUteis(entradas: readonly (string | null | undefined)[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const entrada of entradas) {
    const nome = entrada?.trim();
    if (!nome || nome === '.' || vistos.has(nome)) continue;
    vistos.add(nome);
    saida.push(nome);
  }
  return saida;
}

/**
 * Enumera até `max` nomes e DIZ quantos ficaram de fora.
 *
 * Cortar calado seria o mesmo defeito do paginador que promete e não entrega: o
 * cabeçalho afirmaria que a tabela tem trêss colunas quando tem onze. "e mais 8"
 * custa 9 caracteres e devolve a informação que o corte tirou.
 */
function lista(nomes: string[], max: number): string {
  if (nomes.length <= max) return nomes.join(' · ');
  return `${nomes.slice(0, max).join(' · ')} e mais ${nomes.length - max}`;
}

/**
 * "Qtd · Vezes Agendado por Data" — medidas, depois a dimensão que as separa.
 *
 * O CORTE VALE PARA OS DOIS RAMOS, e o de baixo é o que doeu. Uma tabela de detalhe
 * não tem coluna de medida — é tudo chave —, então ela caía no ramo sem corte e
 * enumerava a lista inteira. Medido em 27/08/2026 na AGENDAMENTO FIELD: um cabeçalho
 * de **138 caracteres** com 11 nomes de coluna, que quebra em várias linhas e come a
 * altura que `--util` está disputando card a card.
 */
function frase(medidas: string[], dimensoes: string[]): string | null {
  if (medidas.length === 0) return dimensoes.length > 0 ? lista(dimensoes, MAX_MEDIDAS) : null;
  const cabeca = lista(medidas, MAX_MEDIDAS);
  if (dimensoes.length === 0) return cabeca;
  return `${cabeca} por ${lista(dimensoes, 2)}`;
}

/**
 * Título de tabela: as colunas de valor, "por", as colunas-chave.
 *
 * `chave` é o que o widget-engine marca como dimensão; o resto é grandeza. Quando a
 * tabela não tem chave nenhuma (resumo de uma linha só), a frase fica só com os
 * valores, que é o que o card realmente mostra.
 */
export function tituloDeTabela(
  visual: { titulo?: string; id?: string },
  colunas: readonly { nome: string | null; chave: boolean }[] | undefined,
): string {
  if (visual.titulo?.trim()) return visual.titulo.trim();
  const cols = colunas ?? [];
  const derivado = frase(
    nomesUteis(cols.filter((c) => !c.chave).map((c) => c.nome)),
    nomesUteis(cols.filter((c) => c.chave).map((c) => c.nome)),
  );
  return derivado ?? tituloDoVisual(visual);
}

/**
 * Título de matriz: as medidas do cruzamento, "por", a chave de linha e a de coluna.
 *
 * A chave cai para o nome da COLUNA quando `nome` vem nulo — o nome do campo é o que
 * o usuário reconhece, mas um identificador de coluna ainda diz mais que um hash.
 */
export function tituloDeMatriz(
  visual: { titulo?: string; id?: string },
  dados:
    | {
        medidas: readonly (string | null)[];
        chavesDeLinha: readonly { nome: string | null; coluna: string }[];
        chavesDeColuna: readonly { nome: string | null; coluna: string }[];
      }
    | undefined,
): string {
  if (visual.titulo?.trim()) return visual.titulo.trim();
  if (!dados) return tituloDoVisual(visual);
  const chave = (k: { nome: string | null; coluna: string }) => k.nome ?? k.coluna;
  const derivado = frase(
    nomesUteis(dados.medidas),
    nomesUteis([...dados.chavesDeLinha.map(chave), ...dados.chavesDeColuna.map(chave)]),
  );
  return derivado ?? tituloDoVisual(visual);
}
