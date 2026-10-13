// Do snapshot em disco para um avaliador pronto.
//
// **É aqui que a plataforma passa a tocar dado real.** Até esta função, tudo o
// que as engines calculavam vinha de `Dataset` montado à mão no teste. O caminho
// completo é:
//
//   fontes → Query Engine → camada M → toDatasetRows → snapshot em disco
//                                                          │
//                                          carrega() ──────┘
//                                              │
//                        Dataset + tabelas calculadas materializadas
//                                              │
//                          Evaluator → Widget Engine → número na tela
//
// **Só o que a página precisa entra.** O plano manda: as tabelas de query vêm de
// arquivo, as calculadas nascem de DAX aqui, e nada mais é carregado. Carregar as
// 23 sempre puxaria `field-agenda` — 1,4 milhão de linhas — para páginas que não
// a mencionam.
//
// **Tabela faltando erra alto, e nomeia o comando.** A alternativa é o
// `Tabela não está no dataset` do avaliador no meio do cálculo de um visual, que
// diz o sintoma e não o que fazer.

import fs from 'node:fs';
import path from 'node:path';
import { Dataset } from '../../measure-engine/src/dataset.ts';
import { Evaluator } from '../../measure-engine/src/evaluator.ts';
import {
  calculatedTableOrder,
  calculatedTableSourceTables,
  materializeCalculatedTable,
} from '../../measure-engine/src/calculated.ts';
import { normalizeName as normaliza, type SemanticModel } from '../../semantic-model/src/model.ts';
import { cortesDaPagina, inicioDoCorte } from '../../semantic-model/src/corte-por-pagina.ts';
import type { DashboardSpec } from '../../widget-engine/src/spec.ts';
import { aplicaTipo } from '../../measure-engine/src/calculated.ts';
import type { ModelTable } from '../../semantic-model/src/types.ts';
import { colunasUsadas, graoReduzidoDe, omissiveis, sobDemandaLiberada } from './colunas-usadas.ts';
import {
  arquivoDaCalculada,
  dependeDoRelogio,
  mesmoDiaLocal,
  shaDaCalculada,
} from './tabelas-calculadas.ts';
import {
  le,
  leCabecalho,
  leColunar,
  shaDeDax,
  type CabecalhoDeSnapshot,
  type Escalar,
  type TipoDeColuna,
} from './formato.ts';
import { VistaDeLinhas, indiceDaVista } from './linha-vista.ts';
import type { TabelaColunar } from './tabela-colunar.ts';
import { arquivoDaQuery, leManifesto } from './manifesto.ts';
import { planeja, type PlanoDeSnapshot } from './plano.ts';
import { chaveDeParticao, traducaoAoVivoDe, traducaoDe, type TraducaoNativa } from './nativas.ts';

export interface CarregaOptions {
  /** Diretório do snapshot. */
  dir: string;
  model: SemanticModel;
  /** As páginas a servir. O plano sai delas. */
  dashboards: readonly DashboardSpec[];
  /**
   * O "agora" do cálculo. Injetado porque 25 das 121 expressões chamam `TODAY()`
   * — um resultado que muda à meia-noite não é conferível.
   */
  now: Date;
  /**
   * Projetar colunas? Padrão `true`.
   *
   * `false` carrega o arquivo inteiro, e existe para uma coisa só: comparar o
   * mesmo cálculo com e sem projeção. É o interruptor honesto que o teste de
   * diferencial precisa — o mesmo papel que `MINIMO_PARA_INDEXAR` faz no índice.
   */
  projetar?: boolean;
  /**
   * Guardar as tabelas em armazenamento COLUNAR (`TabelaColunar` + `VistaDeLinhas`)
   * em vez de um objeto por linha? Padrão `false`.
   *
   * O mesmo interruptor honesto de `projetar` e `lerCalculadas`, e pela mesma razão:
   * enquanto as duas representações existirem, tem de ser possível rodar o MESMO
   * cálculo nas duas e comparar. É o que o teste diferencial faz.
   *
   * Medido em 13/09/2026 sobre as 23 tabelas de `snapshot/`: 3.378 MB como objetos
   * contra 378 MB colunar+vista (8,9x), com 0 células divergentes em 34.456.293.
   * O avaliador não sabe da diferença — a vista responde a `row[c]`, `c in row` e
   * `for...in` como o objeto respondia.
   */
  colunar?: boolean;
  /**
   * Colunas sob demanda a **liberar** nesta carga, como `'TABELA'[coluna]`.
   *
   * É o outro lado de `backend/specs/_catalog/projecao.yaml`: a coluna fica fora da abertura
   * da página, e entra quando alguém pede o visual que depende dela. Liberar só o que
   * foi pedido — e não tudo — é o que mantém o pedido caro proporcional ao que ele
   * mostra, em vez de trazer todo o texto livre da base de volta por um clique.
   */
  liberaSobDemanda?: readonly string[];
  /**
   * Tabelas com GRÃO reduzido (`model.graoReduzido`) a carregar na forma COMPLETA
   * nesta chamada, por nome — ausente de tabela com grão reduzido = usa a query
   * PADRÃO (mais barata) dela. Tabela sem entrada em `model.graoReduzido` nunca olha
   * para isto. Ver `backend/specs/_catalog/projecao.yaml`, bloco `grao_reduzido`, e ACHADOS
   * #87 — é o mesmo papel de `liberaSobDemanda`, um nível acima: lá libera-se
   * COLUNA de uma tabela já carregada; aqui troca-se a LINHA (a query de origem)
   * antes mesmo de abrir o arquivo.
   */
  precisaFormaCompleta?: readonly string[];
  /**
   * Ler tabela calculada de disco quando houver arquivo? Padrão `true`.
   *
   * `false` força o cálculo a partir do DAX, e existe para duas coisas: o programa que
   * **grava** esses arquivos (senão ele leria o que deveria produzir) e o teste
   * diferencial, que compara ler contra calcular. É o mesmo interruptor honesto de
   * `projetar`.
   */
  lerCalculadas?: boolean;
  /**
   * O poller de quase-realtime (`backend/api/src/poller-realtime.ts`), por nome de
   * tabela: uma função que recebe as linhas lidas do arquivo e devolve a versão
   * mesclada com o que o poller viu de mais recente no Voalle. Ausente ou sem
   * entrada para uma tabela = ela carrega só do arquivo, como sempre carregou.
   *
   * **Por que uma função, e não os dados prontos.** Quem sabe mesclar é dono da
   * política (`chave`/`marca` de `backend/specs/_catalog/realtime-poll.yaml`) — este
   * módulo não precisa importar `mescla()` nem conhecer a forma da configuração,
   * só chamar de volta.
   *
   * **Por que aqui, e não um passo à parte.** `Dataset`/`Evaluator` não sabem que
   * overlay existe — recebem uma tabela com as mesmas colunas físicas de sempre,
   * só que algumas linhas são mais novas que o arquivo. É o mesmo desenho do grão
   * reduzido (ACHADOS #87): a decisão fica aqui, embaixo, e o resto do avaliador
   * nunca precisa saber.
   */
  overlay?: ReadonlyMap<
    string,
    (doDisco: readonly Record<string, Escalar>[]) => Record<string, Escalar>[]
  >;
}

export interface Carregado {
  ev: Evaluator;
  plano: PlanoDeSnapshot;
  /** Nome da tabela → quantas linhas entraram, de arquivo ou de DAX. */
  linhasPorTabela: Map<string, number>;
  /**
   * As colunas cujo valor foi convertido para o tipo declarado no carregamento.
   *
   * Fica no resultado porque é a única parte do carregamento que **muda o dado**, e
   * conversão calada é a coisa que mais custa caro nesta base. Ver
   * `aplicaTiposDeclarados`.
   */
  convertidas: string[];
  /**
   * As colunas que a projeção deixou fora da carga, como `'TABELA'[coluna]`.
   *
   * Sai no resultado pelo mesmo motivo de `convertidas`: é a outra coisa que o
   * carregamento faz e que **muda o que o avaliador enxerga**. Carga que omite sem
   * dizer é indistinguível de bug; esta lista é o que a torna auditável.
   */
  omitidas: string[];
  /**
   * Tabelas calculadas que vieram **de disco** em vez de serem recalculadas.
   *
   * Como `convertidas` e `omitidas`: o que o carregamento faz de diferente tem de ser
   * dizível. Uma tabela congelada é um valor que o avaliador não desconfia, e saber
   * quais são é o que separa "rápido" de "misteriosamente rápido".
   */
  congeladas: string[];
  /**
   * Tabelas calculadas que tinham arquivo congelado e mesmo assim foram
   * recalculadas, com o motivo.
   *
   * Hoje só há um motivo: o DAX depende do relógio e o arquivo é de outro dia. Ver
   * `dependeDoRelogio`. Sai no resultado porque recalcular é uma decisão sobre o
   * dado e tem custo — e as duas coisas precisam ser visíveis.
   */
  recalculadas: string[];
  /**
   * As tabelas recortadas pelo corte desta página (`corte-por-pagina.ts`), com quantas
   * linhas ficaram. Vazio fora das páginas com corte — o número de uma página que segue
   * o outro relatório tem de ser dizível, não descoberto.
   */
  recortadas: string[];
  /**
   * As conversões de tipo que **não** foram feitas para não quebrar um
   * relacionamento. Ver `preservaEspecieDeJuncao`.
   *
   * Sai no resultado pela mesma razão de `convertidas`: é uma decisão do
   * carregamento sobre o dado, e decisão calada é indistinguível de bug.
   */
  juncoesPreservadas: string[];
  /** A materialização mais antiga entre as tabelas usadas — a idade do dado. */
  dadoDe: string | null;
  ms: number;
}

/**
 * Monta o avaliador de uma ou mais páginas a partir do snapshot.
 *
 * Assíncrona porque a leitura é em streaming: `field-agenda` não cabe
 * confortavelmente numa string só, e ler linha a linha mantém o pico de memória
 * na ordem da tabela, não do dobro dela.
 */
export async function carrega(opts: CarregaOptions): Promise<Carregado> {
  const inicio = Date.now();
  const plano = planeja(opts.dashboards, opts.model);

  // Grão reduzido: a QUERY de cada tabela pode trocar por baixo, por pedido — sem
  // mudar o plano em si (`plano.tabelas` continua descrevendo a necessidade
  // ESTÁTICA da página; só a fonte muda aqui, e só para quem tem entrada em
  // `model.graoReduzido`). O resto desta função usa `tabelas`, não `plano.tabelas`.
  const formaCompleta = new Set((opts.precisaFormaCompleta ?? []).map(normaliza));
  const tabelas = plano.tabelas.map((t) => {
    const g = graoReduzidoDe(t.nome, opts.model.graoReduzido);
    if (!g) return t;
    return { ...t, query: formaCompleta.has(normaliza(t.nome)) ? g.queryCompleta : g.queryPadrao };
  });

  const dataset = new Dataset();
  const linhasPorTabela = new Map<string, number>();
  const datas: string[] = [];
  /** A materialização de query mais recente entre as carregadas. Ver `confereIdadeDaCalculada`. */
  let maisNovoDeQuery: string | null = null;
  /**
   * `geradoEm` de CADA tabela de query carregada, por nome normalizado.
   *
   * É o que permite a `confereIdadeDaCalculada` perguntar "a MINHA origem mudou?"
   * em vez de "alguma coisa do plano mudou?". Ver o docstring de lá.
   */
  const geradoEmPorTabela = new Map<string, string>();

  const faltando: { tabela: string; query: string }[] = [];
  for (const t of tabelas) {
    if (t.query === null) continue;
    if (!fs.existsSync(arquivoDaQuery(opts.dir, t.query))) {
      faltando.push({ tabela: t.nome, query: t.query });
    }
  }
  if (faltando.length > 0) {
    const manifesto = leManifesto(opts.dir);
    throw new Error(
      `Snapshot incompleto em ${opts.dir}: falta(m) ${faltando.length} tabela(s) — ` +
        faltando.map((f) => `'${f.tabela}' (query ${f.query})`).join(', ') +
        `. Em disco: ${manifesto ? manifesto.tabelas.length : 0} query(s). ` +
        `Rode: npm run snapshot -- --pagina=${plano.dashboards.join(',')}`,
    );
  }

  // As colunas que estas páginas alcançam. Tudo que sobra é candidato a não entrar
  // na memória — ver `colunas-usadas.ts` e `docs/DECISAO-DESEMPENHO.md`.
  const usadas = opts.projetar === false ? null : colunasUsadas(opts.dashboards, opts.model);
  const omitidas: string[] = [];
  const liberadas = new Set((opts.liberaSobDemanda ?? []).map((r) => normaliza(r)));

  // **Corte por página** (`corte-por-pagina.ts`, decisão de 13/10/2026). Só quando a
  // carga é de UMA página: o dataset é dela, e o cache também. Carga de várias páginas
  // juntas é materialização ou congelamento de calculada, e recortar ali gravaria em
  // disco, para todas, o dado de uma.
  const cortes = opts.dashboards.length === 1 ? cortesDaPagina(opts.model.cortes, opts.dashboards[0]!.id) : [];
  const cortePorTabela = new Map(cortes.map((c) => [normaliza(c.tabela), c] as const));
  const recalculaPorCorte = new Set(cortes.flatMap((c) => c.recalcula.map(normaliza)));
  const recortadas: string[] = [];

  const juncao = preservaEspecieDeJuncao(opts.model, opts.dir, { ...plano, tabelas });
  const convertidas: string[] = [];
  for (const t of tabelas) {
    if (t.query === null) continue;
    const arquivo = arquivoDaQuery(opts.dir, t.query);
    // `preservaEspecieDeJuncao` já leu este cabeçalho, logo acima, para toda tabela
    // do plano. O `??` não é defesa contra o mapa estar errado — é contra ele estar
    // INCOMPLETO, o que só aconteceria se as duas varreduras passassem a divergir no
    // que pulam; nesse dia o custo volta a ser o de antes, e não o número muda.
    const cabecalhoEmDisco =
      juncao.cabecalhos.get(normaliza(t.nome)) ?? leCabecalho(arquivo);
    const corte = cortePorTabela.get(normaliza(t.nome));
    const fora = (usadas === null
      ? []
      : omissiveis(
          t.nome,
          cabecalhoEmDisco.colunas.map((c) => c.nome),
          usadas,
          opts.model,
          sobDemandaLiberada(t.nome, opts.model.sobDemanda, liberadas),
        )
    // A coluna do corte entra mesmo que nenhum visual a cite: sem ela não há como cortar.
    ).filter((c) => !corte || normaliza(c) !== normaliza(corte.coluna));
    for (const c of fora) omitidas.push(`'${t.nome}'[${c}]`);

    const modelo = opts.model.table(t.nome)!;
    const semColuna = new Set(fora);
    // O poller de quase-realtime, se houver um para esta tabela.
    const mesclador = opts.overlay?.get(normaliza(t.nome));
    // `semColuna` vai para a conversão de tipo também, e não é detalhe: sem ele a
    // conversão escreveria `aplicaTipo(col, null)` na coluna omitida e a **traria de
    // volta**, agora valendo BLANK em todas as linhas. Seria a projeção produzindo
    // exatamente o número errado e silencioso que ela promete não produzir.
    let cabecalho: CabecalhoDeSnapshot;
    let linhas: Record<string, Escalar>[];

    if (opts.colunar) {
      const lido = await leColunar(arquivo, semColuna, cabecalhoEmDisco.formato);
      cabecalho = lido.cabecalho;
      conferaColunasCalculadas(modelo, cabecalho, t.query, opts.dir);
      // A conversão de tipo acontece AQUI, no dicionário, antes de existir linha
      // nenhuma — e essa ordem é obrigatória, não preferida: a vista recusa escrita
      // em coluna física, então converter depois seria impossível. Em troca, custa o
      // número de valores DISTINTOS em vez do número de linhas.
      convertidas.push(
        ...aplicaTiposDeclaradosColunar(modelo, cabecalho, lido.tabela, semColuna, juncao.suprimir),
      );
      const doDisco = new VistaDeLinhas(lido.tabela).todas() as unknown as Record<
        string,
        Escalar
      >[];
      linhas = mesclador ? mesclador(doDisco) : doDisco;
      if (mesclador) {
        // As linhas que o overlay trouxe são objetos simples, e não passaram pelo
        // dicionário — então ainda precisam da conversão linha a linha, exatamente
        // como no caminho de objeto. São elas e só elas: `indiceDaVista` distingue o
        // que veio do arquivo do que veio do poller, sem precisar saber qual tabela
        // é vigiada. Os rótulos já foram registrados acima; são as mesmas colunas.
        aplicaTiposDeclarados(
          modelo,
          cabecalho,
          linhas.filter((l) => indiceDaVista(l as never) === null),
          semColuna,
          juncao.suprimir,
        );
      }
    } else {
      const lido = await le(arquivo, semColuna, cabecalhoEmDisco.formato);
      cabecalho = lido.cabecalho;
      conferaColunasCalculadas(modelo, cabecalho, t.query, opts.dir);
      // Aplicado ANTES da conversão: o overlay já entrega `Date` de verdade (o driver
      // do Postgres devolve isso, não texto), então passa pelo mesmo caminho que uma
      // linha do arquivo passaria se já estivesse no tipo certo — nenhuma linha do
      // overlay é reconvertida à toa, e nenhuma fica sem a conversão que precisa.
      linhas = mesclador ? mesclador(lido.linhas) : lido.linhas;
      convertidas.push(
        ...aplicaTiposDeclarados(modelo, cabecalho, linhas, semColuna, juncao.suprimir),
      );
    }
    if (corte) {
      // Depois do overlay e da conversão de tipo: a linha que o poller trouxe é cortada
      // igual, e a coluna já é `Date`. Data em branco sai — `created >= X` no SQL do
      // relatório de origem também a descarta.
      const desde = inicioDoCorte(corte, opts.now);
      const chave = normaliza(corte.coluna);
      const antes = linhas.length;
      linhas = linhas.filter((l) => {
        const v = (l as Record<string, unknown>)[chave];
        return v instanceof Date && v.getTime() >= desde.getTime();
      });
      recortadas.push(
        `${t.nome}: ${antes} → ${linhas.length} linha(s), '${corte.coluna}' desde ` +
          `${desde.toISOString().slice(0, 10)} (corte da página)`,
      );
    }
    // **Adotar, não copiar.** `addTable` remonta objeto por objeto para normalizar o
    // nome das colunas — trabalho que em `field-agenda` são 1,46 milhão de linhas
    // reconstruídas campo a campo, e um segundo exemplar delas vivo até o GC passar,
    // numa máquina de 16 GB. `le` já devolve chave normalizada, então não há o que
    // normalizar: a cópia era pura perda. Se algum dia deixar de ser verdade,
    // `adotaTabela` erra alto nomeando a chave — não devolve BLANK calado.
    dataset.adotaTabela(t.nome, linhas as never, fora);
    linhasPorTabela.set(t.nome, linhas.length);
    datas.push(cabecalho.geradoEm);
    geradoEmPorTabela.set(normaliza(t.nome), cabecalho.geradoEm);
    if (maisNovoDeQuery === null || cabecalho.geradoEm > maisNovoDeQuery) {
      maisNovoDeQuery = cabecalho.geradoEm;
    }
  }

  const ev = new Evaluator({ model: opts.model, dataset, now: opts.now });

  // Só as calculadas do plano, e na ordem de dependência que o modelo dita: uma
  // tabela calculada pode nascer de outra, e materializar fora de ordem daria
  // "não está no dataset" longe da causa.
  const noPlano = new Set(plano.calculadas.map(normaliza));
  const congeladas: string[] = [];
  const recalculadas: string[] = [];
  for (const t of calculatedTableOrder(opts.model)) {
    if (!noPlano.has(normaliza(t.name))) continue;

    // Congelada em disco? Então não recalcula. Foram ~21 dos ~25 minutos de
    // `agendamento-field` (ACHADOS #53): quatro colunas calculadas desta tabela,
    // recalculadas a cada abertura de página. O Power BI as calcula no refresh.
    const arq = arquivoDaCalculada(opts.dir, t.name);

    // O congelado em disco nasceu da tabela INTEIRA; com o corte da página, ela é
    // recalculada sobre o recorte. Só as listadas em `recalcula` — todas baratas.
    if (recalculaPorCorte.has(normaliza(t.name))) {
      const m = materializeCalculatedTable(ev, t);
      linhasPorTabela.set(t.name, m.rowCount);
      recalculadas.push(`${t.name}: recalculada sobre o corte da página`);
      continue;
    }

    // **O tempo real mudou uma origem dela? Então o arquivo congelado está velho.**
    // O overlay do poller entra nas tabelas físicas (acima), mas uma calculada lida de
    // disco continuaria com as linhas de antes — a VISÃO PRODUTIVA mostraria o status
    // da última carga com a FIELD AGENDA já atualizada embaixo (ACHADOS #169). Só a
    // tradução nativa recalcula aqui: o DAX de `Status Protocolo Dia` leva horas, e
    // pagar isso por volta do poller não é opção — sem tradução, fica o arquivo, e o
    // motivo vai para `recalculadas`, que a página reporta.
    const origens = calculatedTableSourceTables(opts.model, t);
    const tocadas = (origens ?? []).filter((o) => opts.overlay?.has(normaliza(o)));
    // A fonte só-do-poller (`aoVivo` em nativas.ts) não está no modelo: ninguém mescla o
    // overlay dela em tabela nenhuma, e é chamando o mesclador com o disco vazio que
    // saem as linhas ao vivo.
    const vivaDeclarada = traducaoAoVivoDe(t);
    const mescladorVivo = vivaDeclarada ? opts.overlay?.get(normaliza(vivaDeclarada.tabela)) : undefined;
    if (vivaDeclarada && mescladorVivo) tocadas.push(vivaDeclarada.tabela);
    if (tocadas.length > 0) {
      const nativa = traducaoDe(t);
      if ('traducao' in nativa) {
        const tr = nativa.traducao;
        const fontes = tr.fontes.map((nome) => dataset.rows(nome) as unknown as Record<string, Escalar>[]);
        const aoVivo = mescladorVivo ? mescladorVivo([]) : undefined;
        const parcial = await recalculoParcial(t, tr, fontes, tocadas, arq, opts.dir, {
          colunar: opts.colunar === true,
          confere: (cab) => {
            confereTabelaCalculada(t, cab, opts.dir);
            confereIdadeDaCalculada(t, cab, maisNovoDeQuery, opts.dir, opts.model, geradoEmPorTabela);
          },
          aoVivo,
        });
        const linhas = parcial?.linhas ?? tr.calcula(fontes, aoVivo);
        dataset.adotaTabela(t.name, linhas as never);
        linhasPorTabela.set(t.name, linhas.length);
        recalculadas.push(
          parcial
            ? `${t.name}: ${parcial.chaves} chave(s) recalculada(s) pela tradução nativa, o resto do ` +
                `arquivo — o tempo real mudou ${tocadas.map((x) => `'${x}'`).join(', ')}`
            : `${t.name}: recalculada inteira pela tradução nativa — o tempo real mudou ` +
                `${tocadas.map((x) => `'${x}'`).join(', ')}`,
        );
        continue;
      }
      recalculadas.push(
        `${t.name}: o tempo real mudou ${tocadas.map((x) => `'${x}'`).join(', ')}, mas ela ` +
          `não tem tradução nativa (${nativa.porque}) — segue o arquivo congelado, sem o tempo real`,
      );
    }

    if (opts.lerCalculadas !== false && fs.existsSync(arq)) {
      const cab = leCabecalho(arq);
      confereTabelaCalculada(t, cab, opts.dir);
      confereIdadeDaCalculada(t, cab, maisNovoDeQuery, opts.dir, opts.model, geradoEmPorTabela);

      // O relógio andou: o valor congelado é o de outro dia. Recalcular aqui é
      // barato **porque a regra não é transitiva** — as duas tabelas desta base que
      // dependem do relógio somam ~22 ms. Ver `dependeDoRelogio`.
      if (dependeDoRelogio(t) && !mesmoDiaLocal(new Date(cab.geradoEm), opts.now)) {
        recalculadas.push(
          `${t.name}: congelada em ${cab.geradoEm}, e o DAX dela chama TODAY()/NOW() — ` +
            `o valor em disco é o de outro dia`,
        );
      } else {
        const { cabecalho, linhas } = await le(arq);
        dataset.adotaTabela(t.name, linhas as never);
        linhasPorTabela.set(t.name, linhas.length);
        datas.push(cabecalho.geradoEm);
        congeladas.push(t.name);
        continue;
      }
    }

    const m = materializeCalculatedTable(ev, t);
    linhasPorTabela.set(t.name, m.rowCount);
  }

  return {
    ev,
    plano,
    linhasPorTabela,
    convertidas,
    omitidas,
    congeladas,
    recalculadas,
    recortadas,
    juncoesPreservadas: juncao.notas,
    // **A mais ANTIGA, não a mais nova.** A tela escreve "dado de <isto>", e o que
    // ela promete é que *nada* do que está ali é mais velho que a data mostrada.
    // Devolver a mais nova invertia a promessa: uma tabela congelada há dois dias
    // ao lado de uma rematerializada agora apareceria com a hora de agora, que é
    // exatamente o número plausível e errado que este projeto não pode cometer.
    // É a mesma conta de `manifesto.maisAntigo`, e agora com a mesma resposta.
    dadoDe: datas.length ? datas.sort()[0]! : null,
    ms: Date.now() - inicio,
  };
}

/** Tipo de snapshot que cada tipo declarado do modelo espera encontrar. */
const ESPERADO: Record<string, TipoDeColuna> = {
  int64: 'number',
  double: 'number',
  decimal: 'number',
  dateTime: 'date',
};

/** A chave de uma coluna nos conjuntos deste arquivo. */
function chaveDeColuna(tabela: string, coluna: string): string {
  return `${normaliza(tabela)} ${normaliza(coluna)}`;
}

export interface PreservacaoDeJuncao {
  /** Colunas cuja conversão de tipo foi suprimida, por `chaveDeColuna`. */
  suprimir: Set<string>;
  /** O que foi preservado, em texto — vai para `Carregado.juncoesPreservadas`. */
  notas: string[];
  /**
   * O cabeçalho de cada tabela do plano, por nome normalizado — **já lido**, e por
   * isso devolvido.
   *
   * Esta função abre e inflaciona o cabeçalho de toda tabela do plano antes do laço
   * de carga, e o laço lia cada um de novo: uma vez para `omissiveis` e outra dentro
   * de `leColunar`, que precisa do `formato` para escolher o caminho. Eram **três
   * leituras do mesmo cabeçalho por tabela**, e num arquivo comprimido cada uma
   * custa um `gunzipSync` de 128 KB — 30,3 ms para uma passada nos 30 arquivos do
   * snapshot, medido em 15/09/2026.
   *
   * Devolver o mapa não é cache: é parar de jogar fora o que já está na mão. Não há
   * janela de invalidação a gerenciar, porque o mapa nasce e morre dentro de uma
   * chamada de `carrega` — um arquivo trocado por baixo no meio dela (é o que o
   * `grao_reduzido` faz entre chamadas) continua sendo visto pela leitura seguinte.
   */
  cabecalhos: Map<string, CabecalhoDeSnapshot>;
}

/**
 * As duas pontas de um relacionamento têm de chegar na **mesma espécie**.
 *
 * **É a conversão do #40 encontrando o seu próprio limite.** A regra "o tipo
 * declarado vence ao materializar" conserta agregação (`AVERAGE` sobre o texto
 * `"83205"`); numa **coluna de junção** ela faz o contrário: quebra o
 * relacionamento. O caso real é
 * `'INSTALAÇÕES REINCIDENTES'[protocolo_instalacao]` — o PBIP declara `int64`, a
 * camada M entrega texto, e o outro lado
 * (`'PROTOCOLOS GERAL'[N°PROTOCOLO]`, declarado `string`) fica texto. Converter só
 * um lado põe número contra texto: a junção não casa **nunca**, e os dois cards de
 * `instalacao-reincidente` erravam alto todo dia.
 *
 * O critério é estreito de propósito: só preserva quando as duas colunas chegam do
 * disco **na mesma espécie** e é a declaração que as separaria. Se elas já chegam
 * diferentes, o dado é que está errado, e aí a junção continua errando alto — que é
 * o guarda de `filter.restringe` e ele não deve ser enfraquecido.
 *
 * Preservar é uma decisão sobre o dado, então ela é **dita** (`notas`), nunca calada.
 */
export function preservaEspecieDeJuncao(
  model: SemanticModel,
  dir: string,
  plano: PlanoDeSnapshot,
): PreservacaoDeJuncao {
  const cabecalhos = new Map<string, CabecalhoDeSnapshot>();
  for (const t of plano.tabelas) {
    if (t.query === null) continue;
    cabecalhos.set(normaliza(t.nome), leCabecalho(arquivoDaQuery(dir, t.query)));
  }

  const ponta = (tabela: string, coluna: string) => {
    const col = model.column(tabela, coluna);
    const cab = cabecalhos.get(normaliza(tabela));
    const nomes = [col?.sourceColumn, col?.name, coluna]
      .filter((x): x is string => !!x)
      .map(normaliza);
    const disco = cab?.colunas.find((c) => nomes.includes(normaliza(c.nome)))?.tipo ?? null;
    // Coluna calculada nasce de DAX: o tipo declarado não a converte, e o disco
    // não a descreve. Fora do critério.
    const declarada = col && !col.calculated && col.type ? (ESPERADO[col.type] ?? null) : null;
    return { tabela, coluna, disco, final: declarada ?? disco, converte: declarada !== null };
  };

  const suprimir = new Set<string>();
  const notas: string[] = [];

  for (const r of model.relationships) {
    if (!r.active) continue;
    const a = ponta(r.fromTable, r.fromColumn);
    const b = ponta(r.toTable, r.toColumn);
    // Só quando as duas chegam do disco na mesma espécie utilizável. `vazia` e
    // `misto` não afirmam espécie nenhuma.
    if (a.disco === null || b.disco === null) continue;
    if (a.disco !== b.disco || a.disco === 'vazia' || a.disco === 'misto') continue;
    if (a.final === b.final) continue;

    for (const p of [a, b]) {
      if (!p.converte || p.final === p.disco) continue;
      const outra = p === a ? b : a;
      suprimir.add(chaveDeColuna(p.tabela, p.coluna));
      notas.push(
        `'${p.tabela}'[${p.coluna}] fica ${p.disco} (declara ${p.final}): a junção com ` +
          `'${outra.tabela}'[${outra.coluna}] exige a mesma espécie nos dois lados`,
      );
    }
  }

  return { suprimir, notas, cabecalhos };
}

/**
 * O tipo declarado da coluna vale ao materializar — também para coluna **física**.
 *
 * **É a mesma regra do [ACHADOS](../../../docs/ACHADOS.md) #31, um nível acima.**
 * Lá, `'PROTOCOLOS GERAL'[CONTAGEM]` era DAX `"1"` declarada `int64`, e a conversão
 * entrou no caminho da coluna *calculada*. Coluna física ficou de fora porque em
 * dado sintético o teste sempre põe número em coluna numérica. Contra a base real,
 * não: `'CONSOLIDADO CLIENTES'[authentication_totalizer]` declara `int64` e a camada
 * M entrega o texto `"83205"`, e o `AVERAGE` do gráfico errava alto.
 *
 * **Medido em 07/08/2026, sobre as 14 tabelas materializadas:** de todas as colunas
 * físicas, **14** declaram número e chegam texto. Nelas, **todo** valor não-nulo é
 * literal numérico limpo — nenhum `"1.234,56"`, nenhum `"R$ 10"` —, então a
 * conversão não troca "funciona" por "erra alto" em lugar nenhum.
 *
 * **O sentido contrário fica de fora, de propósito.** Quatro colunas declaram texto
 * e chegam número ou data (`'PROTOCOLOS GERAL'[DATA FINAL]` é data e se declara
 * `string`). Converter uma data de verdade para texto quebraria todo `YEAR()` sobre
 * ela — perda, não ganho. Ficam como estão, e este comentário é o registro.
 *
 * A conversão é decidida pelo **tipo apurado no cabeçalho** do snapshot, que foi
 * varrido sobre a coluna inteira. Coluna que já chega no tipo certo não é tocada, e
 * é por isso que o custo disto é proporcional às 14, não às centenas.
 */
/**
 * As colunas a converter, e o rótulo de cada uma. Sai de `aplicaTiposDeclarados`
 * para ser compartilhada com o caminho colunar — a ESCOLHA é a mesma nos dois; o
 * que muda é onde a conversão é aplicada (linha a linha, ou no dicionário).
 *
 * Duplicar esta escolha seria a falha cara: os dois caminhos convergiriam em teste
 * sintético e divergiriam na primeira coluna que um convertesse e o outro não.
 */
function colunasAConverter(
  t: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  omitidas: ReadonlySet<string>,
  suprimir: ReadonlySet<string>,
): { chave: string; col: (typeof t.columns)[number]; rotulo: string }[] {
  const doDisco = new Map(cabecalho.colunas.map((c) => [normaliza(c.nome), c]));
  const out: { chave: string; col: (typeof t.columns)[number]; rotulo: string }[] = [];

  for (const col of t.columns) {
    if (col.calculated || !col.type || !ESPERADO[col.type]) continue;
    if (suprimir.has(chaveDeColuna(t.name, col.name))) continue;
    const chave = [col.sourceColumn, col.name]
      .filter((x): x is string => !!x)
      .map(normaliza)
      .find((k) => doDisco.has(k));
    if (chave === undefined || omitidas.has(chave)) continue;
    const emDisco = doDisco.get(chave)!;
    // `vazia` é coluna só de nulos: não há o que converter.
    if (emDisco.tipo === 'vazia' || emDisco.tipo === ESPERADO[col.type]) continue;
    out.push({ chave, col, rotulo: `'${t.name}'[${col.name}] ${emDisco.tipo} -> ${col.type}` });
  }
  return out;
}

export function aplicaTiposDeclarados(
  t: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  linhas: Record<string, Escalar>[],
  /** Colunas que não foram carregadas. Converter uma delas a ressuscitaria como BLANK. */
  omitidas: ReadonlySet<string> = new Set(),
  /** Colunas de junção cuja conversão quebraria o relacionamento. Ver `preservaEspecieDeJuncao`. */
  suprimir: ReadonlySet<string> = new Set(),
): string[] {
  const converter = colunasAConverter(t, cabecalho, omitidas, suprimir);
  for (const linha of linhas) {
    for (const { chave, col } of converter) {
      linha[chave] = aplicaTipo(col, linha[chave] ?? null, t.name) as Escalar;
    }
  }
  return converter.map((c) => c.rotulo);
}

/**
 * O mesmo que `aplicaTiposDeclarados`, sobre armazenamento colunar: converte o
 * **dicionário** de cada coluna, e não cada linha.
 *
 * É exatamente equivalente porque `aplicaTipo` é função pura do valor — aplicá-la a
 * cada linha ou a cada valor DISTINTO dá o mesmo resultado. E é muito mais barato: a
 * conversão passa a custar o número de valores distintos, não o de linhas.
 *
 * **É também o que destrava a vista.** `aplicaTiposDeclarados` escreve em coluna
 * FÍSICA, e `VistaDeLinhas` recusa isso de propósito: numa vista, o valor convertido
 * tem de ir para a COLUNA, não para a linha. É aqui que ele vai.
 *
 * O erro alto de `aplicaTipo` continua alto — texto que não é literal numérico em
 * coluna declarada numérica estoura aqui como estouraria lá. O que muda é que estoura
 * uma vez por valor distinto em vez de uma por linha, e a mensagem nunca citou linha,
 * então ela sai idêntica.
 */
export function aplicaTiposDeclaradosColunar(
  t: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  tabela: TabelaColunar,
  omitidas: ReadonlySet<string> = new Set(),
  suprimir: ReadonlySet<string> = new Set(),
): string[] {
  const converter = colunasAConverter(t, cabecalho, omitidas, suprimir);
  for (const { chave, col } of converter) {
    // A coluna pode ter ficado fora da carga pela projeção: `omitidas` já cuida
    // disso, e este guarda cobre o caso de o cabeçalho citar coluna que a leitura
    // não trouxe — criar a coluna aqui seria ressuscitá-la valendo BLANK.
    if (!tabela.tem(chave)) continue;
    tabela.mapeia(chave, (v) => aplicaTipo(col, v, t.name) as Escalar);
  }
  return converter.map((c) => c.rotulo);
}

/** O caminho padrão do snapshot, a partir da raiz do repositório. */
export function diretorioPadrao(root: string): string {
  return path.join(root, 'snapshot');
}

/**
 * Todas as tabelas de grão reduzido, na forma COMPLETA — para `precisaFormaCompleta`
 * de quem carrega em LOTE (ferramenta de linha de comando), não pedido de tela.
 *
 * `backend/api/src/servidor.ts` calcula, por pedido, só o que aquele pedido de fato
 * precisa — é ali que o grão reduzido paga o que promete. Toda outra ferramenta
 * (congelar calculadas, extrair layout, medir paridade, bench, `powerbi`) não tem
 * pedido nenhum para restringir a: ela quer o dado certo, não o rápido, e sem isto
 * pediria a forma padrão por omissão e estouraria "não veio nos dados" na primeira
 * coluna de grão fino que tocasse — regressão de ferramenta que funcionava, não
 * bug de dado (ACHADOS #87).
 */
export function todaFormaCompleta(model: SemanticModel): string[] {
  return model.graoReduzido.map((g) => g.tabela);
}

/**
 * Confere que toda coluna calculada gravada no arquivo ainda corresponde ao DAX
 * que o modelo declara hoje.
 *
 * **É o guarda que torna materializar coluna calculada uma coisa segura de fazer.**
 * Uma coluna calculada em disco é um valor congelado, e o avaliador não desconfia
 * dela: `columnValue` acha o nome na linha e devolve o valor sem perguntar de onde
 * veio. Sem esta conferência, mudar o DAX no Power BI e rodar `npm run extract`
 * deixaria o relatório servindo o número velho **sem nenhum sinal** — que é o erro
 * plausível e silencioso que este projeto não pode cometer.
 *
 * Erra alto em vez de recalcular. Recalcular calado seria defensável se fosse
 * barato, e não é: são os 104 minutos do achado #46 reaparecendo no meio de uma
 * carga que deveria levar 25 segundos, sem ninguém entender por quê.
 */
function conferaColunasCalculadas(
  tabela: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  query: string,
  dir: string,
): void {
  for (const c of cabecalho.colunas) {
    if (c.daxSha === undefined) continue;
    const col = tabela.columns.find((x) => normaliza(x.name) === normaliza(c.nome));

    // A coluna deixou de ser calculada (ou sumiu) no modelo: o valor em disco não
    // tem mais dono, e mantê-lo seria servir o resultado de um DAX que não existe.
    if (!col?.calculated || !col.dax) {
      throw new Error(
        `Snapshot desatualizado: '${tabela.name}'[${c.nome}] está materializada em ` +
          `${arquivoDaQuery(dir, query)}, mas ${col ? 'não é mais coluna calculada' : 'não existe mais'} ` +
          `no modelo. Rode: npm run snapshot -- --query=${query}`,
      );
    }

    const agora = shaDeDax(col.dax);
    if (agora !== c.daxSha) {
      throw new Error(
        `Snapshot desatualizado: o DAX de '${tabela.name}'[${c.nome}] mudou desde a ` +
          `materialização (${c.daxSha} -> ${agora}). O valor em disco é o do DAX antigo. ` +
          `Rode: npm run snapshot -- --query=${query}`,
      );
    }
  }
}

/**
 * Confere que a tabela calculada em disco ainda corresponde ao DAX de hoje.
 *
 * **É o guarda que torna congelar tabela calculada uma coisa segura de fazer**, e é o
 * do ACHADOS #47 um nível acima. Lá, o `sha256` cobria o DAX de uma coluna; aqui cobre
 * o corpo da tabela **e** o de todas as colunas calculadas dela, porque mudar o corpo
 * muda quais linhas existem — e um valor de coluna gravado contra as linhas antigas não
 * tem como ser aproveitado.
 *
 * Erra alto em vez de recalcular calado. Recalcular seria defensável se fosse barato, e
 * não é: são os ~21 minutos do #53 reaparecendo no meio de uma carga que deveria levar
 * segundos, sem ninguém entender por quê.
 */
function confereTabelaCalculada(
  t: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  dir: string,
): void {
  // As aspas não são enfeite: duas das tabelas calculadas têm espaço no nome
  // (`Status Protocolo Dia`, `Base de Origem`), e sem elas o comando que esta
  // mensagem manda rodar quebra justamente na tabela que custa quatro minutos.
  const comando = `npm run snapshot:calculadas -- --tabela="${t.name}"`;
  if (cabecalho.tabelaSha === undefined) {
    throw new Error(
      `${arquivoDaCalculada(dir, t.name)} não declara 'tabelaSha' — ele não foi gravado ` +
        `como tabela calculada, ou é de um formato anterior. Rode: ${comando}`,
    );
  }
  const agora = shaDaCalculada(t);
  if (agora !== cabecalho.tabelaSha) {
    throw new Error(
      `Snapshot desatualizado: a definição de '${t.name}' mudou desde a materialização ` +
        `(${cabecalho.tabelaSha} -> ${agora}). As linhas em disco são as do DAX antigo — ` +
        `da tabela ou de alguma coluna calculada dela. Rode: ${comando}`,
    );
  }
}

/**
 * Confere que a tabela calculada em disco não é mais **velha que o dado** de que ela
 * nasceu.
 *
 * **É o buraco que o `tabelaSha` não cobre, e ele custou uma manhã de investigação.**
 * O sha responde "o DAX é o mesmo?"; ninguém respondia "as linhas de origem são as
 * mesmas?". `npm run snapshot` troca `protocolos-geral.jsonl` por baixo, o
 * `calc.*.jsonl` continua lá com o DAX idêntico, e o guarda deixa passar: a página
 * serve o número de anteontem **com cara de hoje**. É exatamente o "número plausível
 * e errado" que a regra 9 proíbe, e ele não deixava nenhum rastro.
 *
 * **O critério compara com a ORIGEM desta tabela** (`calculatedTableSourceTables`),
 * e cai para "a query mais recente do plano" quando não dá para apurar a origem.
 *
 * Até 18/09/2026 era só a régua conservadora, e o docstring aqui assumia o preço:
 * *"um falso positivo quando se rematerializa uma query que a tabela não usa"*.
 * Medido naquele dia, o preço era o defeito principal. O refresh automático roda em
 * três grupos e recongela as calculadas só no FIM de cada um, então o disco fica
 * inconsistente durante o grupo inteiro — **34,3% do relógio** (699,5 s de
 * materialização em 2.038 s, `snapshot/refresh-historico.log` de 18/09). Nessa
 * janela, todo pedido FRIO de página que tocasse calculada respondia HTTP 409.
 *
 * E a maior parte disso era falso positivo: as 7 calculadas desta base nascem de
 * apenas TRÊS queries — `PROTOCOLOS GERAL` (grupo `medio`), `FIELD AGENDA` (sem
 * cadência automática) e `PROTOCOLOS TELEFONIA` (grupo `quente`). O grupo `frio`
 * (`field-agenda-slot`, `clima-tempo`, `protocolos-produtividade`,
 * `protocolos-auxiliares`) não toca nenhuma delas, e mesmo assim invalidava as 7
 * durante os ~204 s que leva.
 *
 * **O lado permissivo continua sendo o perigoso**, e é por isso que a apuração
 * devolve `null` em vez de chutar: DAX que não faz parse, calculada sem `table_dax`
 * na recursão, ou varredura que não resolve tabela nenhuma voltam à régua antiga.
 * Permissivo só onde se sabe, nunca por omissão.
 */
function confereIdadeDaCalculada(
  t: ModelTable,
  cabecalho: CabecalhoDeSnapshot,
  maisNovoDeQuery: string | null,
  dir: string,
  model: SemanticModel,
  geradoEmPorTabela: ReadonlyMap<string, string>,
): void {
  if (maisNovoDeQuery === null) return;

  // A origem DESTA tabela, e não o plano inteiro. `null` = não deu para afirmar, e
  // aí volta a valer a régua conservadora — ver o docstring acima.
  const origens = calculatedTableSourceTables(model, t);
  let limite = maisNovoDeQuery;
  // As duas frases COMEÇAM igual de propósito: "materialização mais recente". É o
  // que quem lê log e quem escreveu teste já procuram, e o que muda depois dela é
  // ganho de informação, não outra mensagem.
  let comoFoiMedido = 'materialização mais recente das tabelas de origem';
  if (origens !== null) {
    let maior: string | null = null;
    const culpadas: string[] = [];
    for (const nome of origens) {
      const quando = geradoEmPorTabela.get(nome);
      // Origem fora do plano não foi carregada agora, então não há carimbo novo
      // para comparar — e ela não pode ter mudado nesta carga.
      if (quando === undefined) continue;
      culpadas.push(model.table(nome)?.name ?? nome);
      if (maior === null || quando > maior) maior = quando;
    }
    // Nenhuma origem desta tabela entrou no plano: nada que ela usa foi recarregado.
    if (maior === null) return;
    limite = maior;
    comoFoiMedido =
      `materialização mais recente de ${culpadas.map((x) => `'${x}'`).join(', ')}, ` +
      `de que ela nasce`;
  }

  if (cabecalho.geradoEm >= limite) return;
  throw new Error(
    `Snapshot desatualizado: '${t.name}' foi congelada em ${cabecalho.geradoEm}, antes da ` +
      `${comoFoiMedido} (${limite}). As linhas em ` +
      `${arquivoDaCalculada(dir, t.name)} são as do dado antigo, e o DAX igual não denuncia ` +
      `isso. Rode: npm run snapshot:calculadas -- --tabela="${t.name}"`,
  );
}

/**
 * Recalcula só as chaves que o tempo real trouxe e mantém o resto do arquivo congelado.
 *
 * **Por que existe.** A tradução nativa de `Status Protocolo Dia` sobre a FIELD AGENDA
 * inteira (632 mil linhas) custa 5,8–7,5 s na vista colunar — medido em 02/10/2026. Com
 * o poller mudando a tabela a cada 30 s, isso seria recalcular a página inteira o dia
 * todo. As traduções que declaram `particao` dependem só das linhas da mesma chave, então
 * recalcular as chaves do overlay e juntar com o resto do arquivo dá a MESMA tabela
 * (`carrega-parcial.test.ts`; ACHADOS #169).
 *
 * **Quem são as chaves do overlay.** Na vista colunar, linha do arquivo tem índice
 * (`indiceDaVista`) e linha do poller não — a mesma distinção que a conversão de tipo
 * acima já usa. Em modo objeto não há como distinguir, e devolve `null` (inteira).
 *
 * `null` também quando não dá para afirmar que o arquivo vale como base: sem partição
 * declarada, fonte tocada sem coluna de partição, sem arquivo, ou arquivo velho em
 * relação às origens (`confere` erra) — recalcular por cima de base velha misturaria
 * dado antigo com novo, o número plausível e errado.
 */
async function recalculoParcial(
  t: ModelTable,
  tr: TraducaoNativa,
  fontes: readonly Record<string, Escalar>[][],
  tocadas: readonly string[],
  arq: string,
  dir: string,
  o: {
    colunar: boolean;
    confere: (cab: CabecalhoDeSnapshot) => void;
    aoVivo?: readonly Record<string, Escalar>[] | undefined;
  },
): Promise<{ linhas: Record<string, Escalar>[]; chaves: number } | null> {
  if (!tr.particao || !o.colunar || !fs.existsSync(arq)) return null;
  const tocadasNorm = new Set(tocadas.map(normaliza));
  const chaves = new Set<string>();
  for (let i = 0; i < tr.fontes.length; i++) {
    if (!tocadasNorm.has(normaliza(tr.fontes[i]!))) continue;
    const coluna = tr.particao.porFonte[i];
    if (!coluna) return null;
    for (const l of fontes[i] ?? []) {
      if (indiceDaVista(l as never) === null) chaves.add(chaveDeParticao(l[coluna] ?? null));
    }
  }
  // Toda linha da fonte ao vivo é mudança: ela só existe no overlay.
  const colunaViva = tr.aoVivo?.coluna;
  if (o.aoVivo && colunaViva) for (const l of o.aoVivo) chaves.add(chaveDeParticao(l[colunaViva] ?? null));
  try {
    o.confere(leCabecalho(arq));
  } catch {
    return null;
  }
  const { linhas: congeladas } = await le(arq);
  const saida = tr.particao.saida;
  const mantidas = (congeladas as Record<string, Escalar>[]).filter(
    (l) => !chaves.has(chaveDeParticao(l[saida] ?? null)),
  );
  const recortes = tr.fontes.map((_, i) => {
    const coluna = tr.particao!.porFonte[i]!;
    return (fontes[i] ?? []).filter((l) => chaves.has(chaveDeParticao(l[coluna] ?? null)));
  });
  return { linhas: [...mantidas, ...tr.calcula(recortes, o.aoVivo)], chaves: chaves.size };
}
