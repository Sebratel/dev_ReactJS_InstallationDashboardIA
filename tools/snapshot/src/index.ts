#!/usr/bin/env node
// `npm run snapshot` — materializa a camada M em disco.
//
// **A costura que faltava.** `toDatasetRows` — a ponte entre a camada M e o
// `Dataset` do avaliador — existia desde a fase 2b.8 e só era chamada em teste.
// Sem ela num caminho de produção, as engines calculavam sobre dado sintético e
// nada na plataforma tocava número real.
//
// **Por que disco, e não memória no arranque da API.** O `mrun` já mediu: o
// avaliador de M mantém *todos* os passos vivos ao mesmo tempo — em M qualquer
// passo pode citar qualquer outro — e rodar as queries num processo só estourou o
// heap em 4 GB. A saída de lá é UMA QUERY POR PROCESSO, e ela vale aqui igual: com
// o processo morrendo entre uma query e outra, a memória volta ao sistema e uma
// query grande derruba só a si mesma. Uma API que rodasse a camada M no arranque
// seria exatamente o processo que já se sabe que não cabe.
//
// O que sobra em disco é a tabela **final** — não os 60 passos que a produziram.
//
// **O arquivo é dado de cliente.** `field-agenda` tem endereço, `QUADRO FUNCIONAL`
// tem CPF e RG. O diretório de saída está no `.gitignore`, e a saída deste
// programa nunca imprime valor de linha: só id, contagem, nome de coluna e tempo —
// a mesma regra do `mrun`, para poder colar em ticket.
//
// Uso:
//   npm run snapshot -- --pagina=diario-instalacao
//   npm run snapshot -- --todas --memoria=8192
//   npm run snapshot -- --pagina=visao-geral --plano     # só diz o que faria
//   npm run snapshot -- --query=protocolos-geral --refazer
//   npm run snapshot -- --query=x --refazer --sem-calculadas  # não congela o DAX no fim
//   npm run snapshot -- --todas --incremental                 # só o que mudou desde a última
//   npm run snapshot -- --query=field-agenda --refazer --isolar-colunas  # ver Args.isolarColunas
//   npm run snapshot -- --todas --sem-comprimir              # grava .jsonl cru, não .jsonl.gz

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { MemoryCache } from '../../../packages/query-engine/src/cache-memory.ts';
import { applyDotEnv, loadConfig, missingFor } from '../../../packages/query-engine/src/config.ts';
import {
  createMariaConnector,
  createMariaPool,
  createVoalleConnector,
  createVoallePool,
} from '../../../packages/query-engine/src/connectors-sql.ts';
import {
  GoogleSheetsConnector,
  tokenComCache,
} from '../../../packages/query-engine/src/connectors-gsheets.ts';
import { buscadorWeb } from '../../../packages/query-engine/src/connectors-web.ts';
import { QueryEngine } from '../../../packages/query-engine/src/engine.ts';
import {
  accessToken,
  readServiceAccount,
  SCOPE_SHEETS_READONLY,
} from '../../../packages/query-engine/src/google-auth.ts';
import { QueryRegistry } from '../../../packages/query-engine/src/registry.ts';
import type { Connector, ResolvedQuery } from '../../../packages/query-engine/src/types.ts';
import { fonteDoEngine } from '../../../packages/transform-engine/src/fonte.ts';
import { queryDependencies, runQueries } from '../../../packages/transform-engine/src/runner.ts';
import { toDatasetRows } from '../../../packages/transform-engine/src/value.ts';
import { normalizeName, SemanticModel } from '../../../packages/semantic-model/src/model.ts';
import { leJuncoes, reconciliadorDe } from '../../../packages/semantic-model/src/juncoes.ts';
import type { ModelTable } from '../../../packages/semantic-model/src/types.ts';
import { loadDashboards } from '../../../packages/widget-engine/src/spec.ts';
import { planeja } from '../../../packages/snapshot/src/plano.ts';
import { escreve, le, leCabecalho, type Escalar } from '../../../packages/snapshot/src/formato.ts';
import {
  comoDia,
  lePoliticas,
  marcaDe,
  mescla,
  planejaBusca,
  type CabecalhoAnterior,
} from '../../../packages/snapshot/src/incremental.ts';
import {
  DIRETORIO_PADRAO,
  arquivoDaQuery,
  arquivoDeEscrita,
  escreveManifesto,
  leManifesto,
  type EntradaDeManifesto,
} from '../../../packages/snapshot/src/manifesto.ts';
import {
  esqueceCalculadas,
  materializaColunas,
  materializaColunasPorGrao,
  materializaveis as colunasMaterializaveis,
} from '../../../packages/snapshot/src/colunas-calculadas.ts';
import {
  queriesQueAlimentamCalculada,
  shaDasChaves,
} from '../../../packages/snapshot/src/tabelas-calculadas.ts';
import { resumoDoErro } from '../../../packages/snapshot/src/erro.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

/** Prefixo da linha de resultado do filho. Só ela é dado; o resto é log. */
const MARCA = '##SNAP##';

/**
 * Um só instante para a execução inteira — ver o comentário em `materializa()`
 * sobre por que duas colunas com `NOW()` em arquivos diferentes seriam uma
 * divergência inexplicável.
 */
const AGORA = new Date();

/** As políticas de carga incremental declaradas em `specs/_catalog/incremental.yaml`. */
const politicas = lePoliticas(path.join(ROOT, 'specs'));

/**
 * Nenhuma query fica fora hoje. `clima-tempo` ficava, por causa do `Web.Contents`
 * sem connector; passou a ter (achado #42). A lista continua porque é aqui que a
 * próxima exclusão vai querer o motivo escrito ao lado.
 */
const FORA_DO_ESCOPO = new Set<string>();

// ------------------------------------------------------------------ argumentos
interface Args {
  paginas: string[];
  queries: string[];
  todas: boolean;
  plano: boolean;
  refazer: boolean;
  saida: string;
  memoria: number | null;
  segundos: number;
  uma: string | null;
  /** Não encadeia o congelamento das calculadas no fim. Ver o rodapé deste arquivo. */
  semCalculadas: boolean;
  /**
   * Modo neto: calcula UMA coluna calculada de UMA tabela, isolada num processo
   * próprio. Ver `materializaColunasDaTabela` e ACHADOS #82. As quatro só existem
   * juntas — validado logo depois do parse.
   */
  colunaTabela: string | null;
  colunaNome: string | null;
  colunaEntrada: string | null;
  colunaSaida: string | null;
  colunaAgora: string | null;
  /**
   * Busca só o que mudou, em quem tem política em `specs/_catalog/incremental.yaml`.
   *
   * Implica refazer **todas** as pedidas: quem tem política paga o delta, quem não
   * tem é buscada inteira. A alternativa — pular as que já estão em disco — deixaria
   * o refresh incompleto justamente na volta que ele deveria ser barato o bastante
   * para rodar sempre.
   */
  incremental: boolean;
  /**
   * Isola cada coluna calculada de tabela grande num processo próprio (ACHADOS #82).
   *
   * Fica de fora por padrão, e é o oposto de `calculadas.ts` (que isola sozinho, sem
   * pedir). Lá a medição confirmou processo compartilhado como causa (#66/#67, 36×);
   * aqui a mesma técnica foi medida ao vivo em `field-agenda` e o total **piorou** 18%
   * — o custo real é intrínseco a UMA coluna (`RankAtualProtocolo`, CALCULATE+FILTER+
   * MAX auto-referente), não o processo compartilhado. Isolar por padrão regrediria o
   * refresh normal. Existe como opção manual para o dia em que fizer sentido testar de
   * novo — ex.: se `protocolos-geral` tiver o defeito de memória que #66/#67 tinham.
   */
  isolarColunas: boolean;
  /**
   * Gravar `.jsonl.gz` em vez de `.jsonl`. LIGADO por padrão.
   *
   * Medido em 04/09/2026 sobre `field-agenda` (448,2 MB): o arquivo cai para 14,6 MB
   * — 96,7% —, a gravação custa +1,7 s e a leitura +0,3 s. A tabela completa está no
   * topo de `packages/snapshot/src/formato.ts`.
   *
   * `--sem-comprimir` existe para quem precisa abrir o arquivo com `head`/`grep` sem
   * passar por `zcat`, e para medir o custo dos dois lados. Trocar de um para o outro
   * não deixa resto: `escreve()` apaga o gêmeo do outro sufixo depois de gravar.
   */
  comprime: boolean;
}

/**
 * Teto de `statement_timeout` desta ferramenta, em segundos.
 *
 * **Materialização não é pedido de tela.** O `.env` traz 30 s, que é o teto certo
 * para um widget: passou disso, o usuário está esperando e alguma coisa está
 * errada. `protocolos-geral` e `protocolos-auxiliares` batem nesse teto — medido
 * em 07/08/2026, as duas foram canceladas pelo servidor —, e elas não estão
 * erradas: são varreduras grandes que rodam uma vez por refresh.
 *
 * Sobrescrever calado o valor do `.env` seria pior que o timeout. Por isso este
 * default é impresso na saída, com o número que substituiu, e `--timeout=` manda.
 */
const TIMEOUT_PADRAO_S = 600;

function parseArgs(argv: string[]): Args {
  const a: Args = {
    paginas: [],
    queries: [],
    todas: false,
    plano: false,
    refazer: false,
    saida: path.join(ROOT, DIRETORIO_PADRAO),
    memoria: null,
    segundos: TIMEOUT_PADRAO_S,
    uma: null,
    semCalculadas: false,
    incremental: false,
    isolarColunas: false,
    comprime: true,
    colunaTabela: null,
    colunaNome: null,
    colunaEntrada: null,
    colunaSaida: null,
    colunaAgora: null,
  };
  const lista = (raw: string, pref: string): string[] =>
    raw.slice(pref.length).split(',').map((s) => s.trim()).filter(Boolean);

  for (const raw of argv) {
    if (raw === '--todas') a.todas = true;
    else if (raw === '--plano') a.plano = true;
    else if (raw === '--refazer') a.refazer = true;
    else if (raw === '--sem-calculadas') a.semCalculadas = true;
    else if (raw === '--incremental') a.incremental = true;
    else if (raw === '--isolar-colunas') a.isolarColunas = true;
    else if (raw === '--sem-comprimir') a.comprime = false;
    else if (raw.startsWith('--pagina=')) a.paginas.push(...lista(raw, '--pagina='));
    else if (raw.startsWith('--query=')) a.queries.push(...lista(raw, '--query='));
    else if (raw.startsWith('--saida=')) a.saida = path.resolve(ROOT, raw.slice('--saida='.length));
    else if (raw.startsWith('--uma=')) a.uma = raw.slice('--uma='.length);
    else if (raw.startsWith('--coluna-tabela=')) a.colunaTabela = raw.slice('--coluna-tabela='.length);
    else if (raw.startsWith('--coluna-nome=')) a.colunaNome = raw.slice('--coluna-nome='.length);
    else if (raw.startsWith('--coluna-entrada=')) a.colunaEntrada = raw.slice('--coluna-entrada='.length);
    else if (raw.startsWith('--coluna-saida=')) a.colunaSaida = raw.slice('--coluna-saida='.length);
    else if (raw.startsWith('--coluna-agora=')) a.colunaAgora = raw.slice('--coluna-agora='.length);
    else if (raw.startsWith('--timeout=')) {
      const n = Number.parseInt(raw.slice('--timeout='.length), 10);
      if (!Number.isFinite(n) || n < 1) {
        console.error('--timeout espera segundos (mínimo 1)');
        process.exit(2);
      }
      a.segundos = n;
    } else if (raw.startsWith('--memoria=')) {
      const n = Number.parseInt(raw.slice('--memoria='.length), 10);
      if (!Number.isFinite(n) || n < 256) {
        console.error('--memoria espera MB (mínimo 256)');
        process.exit(2);
      }
      a.memoria = n;
    } else {
      console.error(`argumento desconhecido: ${raw}`);
      process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

// ------------------------------------------------------------------- catálogo
const registry = QueryRegistry.fromSpecsDir(path.join(ROOT, 'specs'));
const model = SemanticModel.fromSpecsDir(path.join(ROOT, 'specs'));

// -------------------------------------------------------- modo neto (uma coluna)
//
// Calcula UMA coluna calculada de UMA tabela, isolada num processo próprio — sem
// abrir conector nenhum, porque as linhas físicas já chegam prontas no arquivo de
// entrada que o processo pai (`materializaColunasDaTabela`) escreveu. É a mesma
// receita de `calculadas.ts` (ACHADOS #67), estendida ao caminho de query
// (ACHADOS #82): uma coluna-irmã que a expressão cite não precisa estar aqui —
// `Evaluator.columnValue` a resolve sozinho, na hora, contanto que o modelo e a
// linha inteira estejam presentes, e estão.
if (args.colunaTabela) {
  if (!args.colunaNome || !args.colunaEntrada || !args.colunaSaida || !args.colunaAgora) {
    console.error(
      '--coluna-tabela= exige --coluna-nome=, --coluna-entrada=, --coluna-saida= e --coluna-agora=.',
    );
    process.exit(2);
  }
  const t = model.table(args.colunaTabela);
  if (!t) {
    console.error(`tabela não existe no modelo: ${args.colunaTabela}`);
    process.exit(2);
  }
  const { cabecalho, linhas } = await le(args.colunaEntrada);
  const m = materializaColunas(
    t,
    model,
    linhas,
    new Date(args.colunaAgora),
    new Set([normalizeName(args.colunaNome)]),
  );
  if (m.colunas.length !== 1) {
    console.error(
      `coluna '${args.colunaNome}' de '${t.name}' não é materializável aqui — precisa ser ` +
        'calculada e depender só da própria tabela.',
    );
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(args.colunaSaida), { recursive: true });
  await escreve(
    args.colunaSaida,
    { query: `_scratch.coluna.${normalizeName(t.name)}`, tabelas: [t.name], geradoEm: new Date().toISOString() },
    [...cabecalho.colunas.map((c) => c.nome), args.colunaNome],
    linhas,
    m.daxSha,
  );
  process.exit(0);
}

const cfg = loadConfig();

const culture = (
  yaml.parse(fs.readFileSync(path.join(ROOT, 'specs', '_catalog', 'model.yaml'), 'utf8')) as {
    culture?: string | null;
  }
).culture ?? null;

/**
 * Quais mesclagens mortas podem comparar a chave como inteiro.
 *
 * Decisão humana, em `specs/_catalog/juncoes.yaml`. Vazio = nenhuma, e a nota da
 * materialização diz o número que justificaria cada uma.
 *
 * ⚠ **Isto já esteve aqui e sumiu, e ninguém percebeu por 20 dias.** Entrou em
 * 14/08/2026 com o achado #64 e saiu em 26/08 no commit que se chamava "restaurar
 * 100% do estado" — o mesmo episódio que a `docs/RECUPERACAO-27-08.md` registra.
 * Sem esta linha, `BACKLOG AGENDADO FUTURO['PROTOCOLOS GERAL.TIPO DE PROTOCOLO']` e
 * `PROTOCOLOS GERAL['TECNICOS AUXILIARES.AUXILIAR']` saem **inteiras nulas** de toda
 * materialização, e as páginas que as leem mostram BLANK — número plausível, sem
 * erro nenhum. `npm run snapshot:confere` acusa as duas; era o alarme tocando.
 *
 * O `tools/mrun` também a injeta (achado #73). **As duas ferramentas rodam a MESMA
 * camada M**: se só uma reconciliar, o diagnóstico diverge da materialização, que é
 * pior do que as duas estarem erradas juntas.
 */
const reconcilia = reconciliadorDe(leJuncoes(path.join(ROOT, 'specs')));

const todasAsQueries = registry.list().filter((q) => q.m_expression && !FORA_DO_ESCOPO.has(q.id));

/**
 * Colunas calculadas que dão o MESMO valor em toda linha duplicada por um `LEFT
 * JOIN` multiplicador — e a chave física que prova isso (ACHADOS #86,
 * `docs/DECISAO-GRAO-FIELD-AGENDA.md`).
 *
 * Hoje só `field-agenda`: os joins com `reports`/`people`/`skills` multiplicam cada
 * slot por (relato × skill) — 643.797 linhas onde o `vsdspi` de origem tem uma ordem
 * de grandeza a menos. Cinco das sete colunas calculadas (`Data`, `RankDataProtocolo`,
 * `RankAtualProtocolo`, `Turno`, `Status SLA`) só citam colunas que vêm do lado SEM
 * join (`vsdspi`) — `ClassificacaoRelato`/`CategoriaProdutividade` citam `Relato`
 * (`reports`) e continuam de fora, calculadas do jeito de sempre.
 *
 * `chave` é TODA coluna de origem `vsdspi` na query, não só Protocolo+Slot: duas
 * linhas iguais nelas são, por construção do `LEFT JOIN`, a mesma linha de origem
 * antes dos joins — não é uma aposta de que essas duas bastam.
 *
 * Medido ao vivo (ACHADOS #85): sem isto, `RankAtualProtocolo` sozinha custava 864s
 * — 76% do tempo total de `materializaColunas` — porque seu `FILTER` varre a tabela
 * ADOTADA inteira por linha. Adotando só as ~30 mil representantes de slot, o mesmo
 * `FILTER` varre 20× menos.
 */
const GRAO_REDUZIDO_DE = new Map<string, { chave: string[]; colunas: string[] }>([
  [
    'field-agenda',
    {
      chave: [
        'Protocolo', 'Tipo de Protocolo', 'Status Protocolo', 'Base', 'Instalador',
        'Data Criado', 'Reagenda', 'Data finalizado atendimento app',
        'Data primeiro Play app', 'Data ultimo play app', 'Prazo SLA',
        'Inicio relato', 'Fim relato', 'Slot Agenda',
      ],
      colunas: ['Data', 'RankDataProtocolo', 'RankAtualProtocolo', 'Turno', 'Status SLA'],
    },
  ],
]);

/**
 * Queries que não são o `queryRef` de tabela nenhuma do modelo — hoje só
 * `field-agenda-slot` (ACHADOS #87). Ela é uma fonte ALTERNATIVA de `FIELD AGENDA`
 * (mesma tabela, escolhida em tempo de carga por `packages/snapshot/src/
 * carrega.ts`, não uma tabela própria), então `tabelasDaQuery` nunca a alcança —
 * mas ela ainda precisa das mesmas colunas calculadas de grão de slot que
 * `GRAO_REDUZIDO_DE` já declara para `field-agenda`. Reaproveitada daqui, não
 * duplicada: se a lista de colunas de grão de slot mudar um dia, muda num só lugar.
 *
 * Suas linhas já nascem no grão de slot — sem os `JOIN`s que duplicam, então sem
 * duplicação nenhuma para desfazer. O cálculo é direto (`materializaColunas`, sem
 * `materializaColunasPorGrao`), restrito a estas colunas: pedir
 * `ClassificacaoRelato`/`CategoriaProdutividade` aqui erraria alto (o arquivo não
 * tem `Relato`), e é isso mesmo que deve acontecer se algum dia alguém tentar.
 */
const TABELA_SEM_QUERY_REF = new Map<string, { tabela: string; colunas: string[] }>([
  ['field-agenda-slot', { tabela: 'FIELD AGENDA', colunas: GRAO_REDUZIDO_DE.get('field-agenda')!.colunas }],
]);

/** As tabelas do modelo que carregam do arquivo desta query. */
function tabelasDaQuery(id: string): string[] {
  const proprias = [...model.tables.values()].filter((t) => t.queryRef === id).map((t) => t.name);
  if (proprias.length) return proprias;
  const semQueryRef = TABELA_SEM_QUERY_REF.get(id);
  return semQueryRef ? [semQueryRef.tabela] : [];
}

// ------------------------------------------------------------------ connectors
async function montaConnectors(
  precisa: ReadonlySet<string>,
): Promise<{ connectors: Map<string, Connector>; fechar: (() => Promise<void>)[] }> {
  const connectors = new Map<string, Connector>();
  const fechar: (() => Promise<void>)[] = [];

  // O teto de tempo é desta execução, não do `.env`: ver TIMEOUT_PADRAO_S.
  const statementTimeoutMs = args.segundos * 1000;

  if (precisa.has('dbVoalle')) {
    const falta = missingFor('voalle');
    if (falta.length) throw new Error(`dbVoalle: falta no .env ${falta.join(', ')}`);
    const pool = await createVoallePool({ ...cfg.voalle, statementTimeoutMs });
    connectors.set('dbVoalle', createVoalleConnector(pool));
    fechar.push(() => pool.end());
  }
  if (precisa.has('dbMaria')) {
    const falta = missingFor('maria');
    if (falta.length) throw new Error(`dbMaria: falta no .env ${falta.join(', ')}`);
    const pool = await createMariaPool({ ...cfg.maria, statementTimeoutMs });
    connectors.set('dbMaria', createMariaConnector(pool));
    fechar.push(() => pool.end());
  }
  if (precisa.has('gsheets')) {
    const sa = readServiceAccount(cfg.gsheets.credentialsPath);
    connectors.set(
      'gsheets',
      new GoogleSheetsConnector({
        token: tokenComCache(() => accessToken(sa, [SCOPE_SHEETS_READONLY])),
        contaDeServico: sa.client_email,
      }),
    );
  }
  return { connectors, fechar };
}

/**
 * Datasources que a query e suas dependências de M usam.
 *
 * O fechamento importa nos dois sentidos: `protocolos-produtividade` é `dbVoalle`
 * na spec e mescla com `QUADRO FUNCIONAL`, que é planilha; e materializar
 * `contratos` não deve abrir pool no MariaDB nem ler credencial do Google.
 */
function fontesDe(id: string): Set<string> {
  const porNome = new Map(todasAsQueries.map((q) => [q.name, q]));
  const nomes = new Set(porNome.keys());
  const fontes = new Set<string>();
  const vistas = new Set<string>();
  const anda = (q: ResolvedQuery): void => {
    if (vistas.has(q.id)) return;
    vistas.add(q.id);
    if (q.datasource) fontes.add(q.datasource);
    for (const dep of queryDependencies(q.m_expression!, nomes).dependencias) {
      const d = porNome.get(dep);
      if (d) anda(d);
    }
  };
  const inicial = todasAsQueries.find((q) => q.id === id);
  if (inicial) anda(inicial);
  return fontes;
}

/**
 * A partir de quantas linhas vale isolar cada coluna calculada num processo próprio,
 * QUANDO `--isolar-colunas` pede. Mesmo número de `calculadas.ts` (ACHADOS #67), só
 * como piso de bom senso — não é mais uma expectativa de ganho, ver o comentário de
 * `isolarColunas` em `Args`.
 */
const MINIMO_PARA_ISOLAR_COLUNAS = 5_000;

/**
 * Materializa as colunas calculadas de UMA tabela — isolando cada uma num processo
 * próprio só se `--isolar-colunas` foi pedido (ver `Args.isolarColunas`). Por padrão
 * cai direto em `materializaColunas`, sem spawn nenhum.
 *
 * `colunasAtuais` vai inteiro para o arquivo de entrada de cada filho: é o conjunto de
 * colunas que `rows` tem agora, físicas mais o que uma tabela anterior no mesmo laço
 * já tiver acrescentado (nenhuma query faz isso hoje, mas nada impede). O filho grava
 * de volta as MESMAS colunas mais a sua, e `shaDasChaves` confere que as linhas do
 * filho descrevem a mesma tabela na mesma ordem antes de aceitar o valor — juntar por
 * posição sem essa conferência poria o valor de uma linha em outra.
 */
async function materializaColunasDaTabela(
  t: ModelTable,
  rows: Record<string, Escalar>[],
  colunasAtuais: readonly string[],
  saida: string,
  queryId: string,
): Promise<{ colunas: string[]; daxSha: Map<string, string>; ms: number }> {
  const alvo = colunasMaterializaveis(t, model);
  if (!args.isolarColunas || alvo.length < 2 || rows.length < MINIMO_PARA_ISOLAR_COLUNAS) {
    return materializaColunas(t, model, rows, AGORA);
  }

  const inicio = Date.now();
  const slug = normalizeName(t.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const dir = path.join(saida, '_parciais_colunas');
  fs.mkdirSync(dir, { recursive: true });
  const entrada = path.join(dir, `${queryId}.${slug}.entrada.jsonl`);
  const parciais = alvo.map((c, k) => path.join(dir, `${slug}.${k}.jsonl`));
  for (const p of [entrada, ...parciais]) fs.rmSync(p, { force: true });

  console.error(
    `    ${t.name}: ${alvo.length} coluna(s) calculada(s) em ${rows.length.toLocaleString('pt-BR')} ` +
      `linha(s) — um processo por coluna (ACHADOS #82)`,
  );

  try {
    await escreve(
      entrada,
      { query: `_scratch.colunas.${queryId}`, tabelas: [t.name], geradoEm: new Date().toISOString() },
      colunasAtuais,
      rows,
    );

    const daxSha = new Map<string, string>();
    const baseSha = shaDasChaves(rows, colunasAtuais);
    for (const [k, c] of alvo.entries()) {
      const tc = Date.now();
      const r = spawnSync(
        process.execPath,
        [
          ...process.execArgv,
          fileURLToPath(import.meta.url),
          `--coluna-tabela=${t.name}`,
          `--coluna-nome=${c.nome}`,
          `--coluna-entrada=${entrada}`,
          `--coluna-saida=${parciais[k]}`,
          `--coluna-agora=${AGORA.toISOString()}`,
        ],
        { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
      );
      if (r.status !== 0) {
        throw new Error(
          `coluna calculada '${c.nome}' de '${t.name}': processo filho saiu com ${r.status ?? r.signal}. ` +
            'Nada foi mesclado.',
        );
      }
      console.error(`      [${c.nome}] ${(Date.now() - tc).toLocaleString('pt-BR')} ms`);

      const { cabecalho, linhas } = await le(parciais[k]!);
      const chave = normalizeName(c.nome);
      const s = shaDasChaves(linhas, colunasAtuais);
      if (linhas.length !== rows.length || s !== baseSha) {
        throw new Error(
          `coluna calculada '${c.nome}' de '${t.name}' descreve linhas diferentes das originais ` +
            `(${linhas.length}/${s} contra ${rows.length}/${baseSha}). Juntar por posição poria o ` +
            'valor de uma linha em outra. Nada foi mesclado.',
        );
      }
      // Sob as DUAS chaves, exatamente como o caminho não isolado deixa (evaluator.ts
      // memoiza a normalizada, e `materializaColunas` grava a de exibição por cima):
      // `columns` mais adiante ganha `c.nome` (exibição), e é por ela que `escreve()`
      // lê o valor. Gravar só a normalizada aqui reproduziria o defeito do #54 —
      // coluna calculada saindo `null` no arquivo final, calada.
      for (let i = 0; i < linhas.length; i++) {
        const v = linhas[i]![chave]!;
        rows[i]![c.nome] = v;
        rows[i]![chave] = v;
      }
      const sha = cabecalho.colunas.find((x) => normalizeName(x.nome) === chave)?.daxSha;
      if (sha) daxSha.set(c.nome, sha);
    }
    return { colunas: alvo.map((c) => c.nome), daxSha, ms: Date.now() - inicio };
  } finally {
    for (const p of [entrada, ...parciais]) fs.rmSync(p, { force: true });
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      // Resto de outra execução em curso: apagar seria pior que deixar.
    }
  }
}

// ------------------------------------------------------------------ modo filho
interface Resultado {
  query: string;
  ok: boolean;
  linhas: number | null;
  colunas: number | null;
  bytes: number | null;
  ms: number;
  erro?: string;
  /** Avisos que não impedem o resultado, mas quem lê precisa ver — ex.: junção morta. */
  notas?: string[];
  /** Ausente para query sem política — não há o que dizer. */
  modo?: 'completo' | 'incremental';
}

async function materializa(q: ResolvedQuery, saida: string): Promise<Resultado> {
  const inicio = Date.now();
  const avisos: string[] = [];
  // Dois caminhos, e a diferença importa. O ANTERIOR é o que está em disco — pode ser
  // `.jsonl` de antes da compressão, e é dele que a incremental lê a marca e as linhas.
  // O DESTINO é onde esta carga grava, e o sufixo dele vem de `--sem-comprimir`, não do
  // disco: se viesse do disco, um `.jsonl` já existente prenderia a query no formato
  // velho para sempre. `escreve()` apaga o gêmeo depois de gravar, então os dois nunca
  // coexistem — é o que `escolheGemeo` cobra.
  const arquivoAnterior = arquivoDaQuery(saida, q.id);
  const arquivo = arquivoDeEscrita(saida, q.id, args.comprime);

  // Decide COMO buscar antes de abrir conexão nenhuma: sem política, ou sem
  // --incremental, ou sem arquivo anterior, `planejaBusca` já devolve o caminho de
  // sempre (carga completa) — ver o docstring dela para o porquê de cada caso.
  const politica = politicas.get(q.id);
  let cabAnterior: CabecalhoAnterior | null = null;
  if (politica && args.incremental) {
    try {
      cabAnterior = leCabecalho(arquivoAnterior);
    } catch {
      cabAnterior = null; // sem arquivo ainda, ou ilegível: trata como primeira carga
    }
  }
  const { plano, aviso } = planejaBusca(q.sql ?? '', cabAnterior, politica, AGORA, args.incremental);
  if (aviso) avisos.push(aviso);

  const { connectors, fechar } = await montaConnectors(fontesDe(q.id));
  const engine = new QueryEngine({ registry, connectors, cache: new MemoryCache() });
  // O SQL costurado só chega ao connector desta forma: `QueryEngine` resolve o SQL
  // pelo PRÓPRIO registry (`this.#registry.get(queryId)`), não pelo array `specs`
  // que `runQueries` recebe — trocar `q.sql` sozinho não bastaria. É seguro mutar o
  // registry aqui porque este processo materializa exatamente UMA query (`--uma=`)
  // e termina: nada mais neste processo volta a ler o SQL original desta query.
  if (plano.modo === 'incremental') {
    registry.queries.set(q.id, { ...q, sql: plano.sql });
  }
  // Por id, não um objeto global: o M desta query pode citar OUTRAS como
  // dependência (protocolos-produtividade cita alocacao-patrimonio), e um
  // params sem escopo vazaria :desde para elas — traduzParametros erraria "parâmetro
  // sem uso no SQL", corretamente, porque a dependência não foi costurada.
  // Onde o tempo foi, por sub-busca (a própria query e qualquer dependência de M,
  // como alocacao-patrimonio para protocolos-produtividade ou GESTORES EQUIPES para
  // protocolos-geral) — sem isto, "a query demorou X" não diz se X é banco, rede
  // ou a conversão de linha em JS. ACHADOS #82 (field-agenda: 22,0s documentados
  // eram só SQL isolado, não os 21min49s reais) é exatamente o buraco que isto tapa.
  const fonte = fonteDoEngine(engine, {
    ...(Object.keys(plano.params).length ? { paramsPorQuery: { [q.id]: plano.params } } : {}),
    onBusca: (e) => {
      if (e.erro) return; // o erro real já sobe pela exceção; nada a medir aqui
      console.error(
        `    busca ${e.id}: ${e.linhas?.toLocaleString('pt-BR')} linha(s), ` +
          `${e.msExecute} ms banco/rede + ${e.msConversao} ms conversão`,
      );
    },
  });
  // Allowlist só do que ESTA query declara em `endpoints` (gerado do PBIP).
  const web = q.endpoints?.length ? buscadorWeb({ permitidos: q.endpoints }) : undefined;

  try {
    const tBusca = Date.now();
    // `guardaPassos: false` — este caminho nunca leu `passos`, e guarda-los mantinha
    // as 56 tabelas intermediarias de `protocolos-geral` vivas ao mesmo tempo: 9,8 GB
    // de pico, contra o teto de 8 GB do daemon de refresh. Ver `avaliaQuery`.
    const feitas = await runQueries({
      specs: todasAsQueries,
      apenas: [q.id],
      culture,
      fonte,
      web,
      guardaPassos: false,
      reconcilia,
    });
    console.error(`    busca + avaliação de M: ${Date.now() - tBusca} ms`);

    const tConverte = Date.now();
    const { columns, rows: buscadas } = toDatasetRows(feitas.get(q.id)!.tabela, q.id);
    console.error(`    toDatasetRows: ${Date.now() - tConverte} ms`);

    // Modo incremental: o que a busca trouxe é só a janela reentregue — junta com
    // o que já estava no arquivo antes de seguir.
    //
    // **Este comentário afirmava uma garantia que o código NÃO dava, e a correção
    // é a chamada a `esqueceCalculadas` logo abaixo (22/09/2026).** Ele dizia:
    // *"`linhasAntigas` já tem qualquer coluna calculada de execuções passadas;
    // `materializaColunas` roda de novo sobre o conjunto inteiro logo abaixo, então
    // elas saem recalculadas também"*. Elas não saíam: `columnValue` devolve o valor
    // já gravado na linha sem reavaliar, então as antigas mantinham o valor de antes
    // — e, pior, as linhas NOVAS saíam `null`, porque uma única linha antiga com a
    // chave presente faz `adotaTabela` promover a coluna a física e o avaliador
    // devolver BLANK para quem não a tem. Medido; ver `esqueceCalculadas`.
    //
    // Isso nunca produziu número errado em produção porque nenhuma query roda hoje
    // com `incremental: true` (`refresh.yaml` traz `incremental: false` nos três
    // grupos). Era defeito LATENTE na única política que existe
    // (`protocolos-produtividade`, 3 colunas calculadas, uma delas citando
    // `NOW()`/`TODAY()`) — e `incremental.yaml` chamava ligá-la de "barato".
    let rows = buscadas;
    if (plano.modo === 'incremental') {
      const { linhas: antigas } = await le(arquivoAnterior);
      const m = mescla({
        antigas,
        novas: buscadas,
        chave: politica!.chave,
        marca: politica!.marca,
        corte: plano.corte!,
      });
      rows = m.linhas;
      avisos.push(
        `incremental: +${m.novas} nova(s), ${m.substituidas} substituída(s), ` +
          `${m.sumidas} sumida(s), ${m.mantidas} mantida(s) de antes.`,
      );

      // **Agora a garantia é real: o arquivo inteiro compartilha o mesmo `AGORA`.**
      // Apagar de TODAS as linhas (não só das antigas) é o que importa — deixar a
      // coluna em qualquer uma delas basta para zerar as outras. Recalcular tudo é
      // mais caro que reaproveitar, e é deliberado: correto primeiro. Reter o que
      // não mudou é otimização possível, mas exige saber, coluna a coluna, quais
      // são função do relógio (`Status SLA` é) e quais são por partição
      // (`RankDataProtocolo`/`RankAtualProtocolo` são, por `protocolo`) — e
      // reter sem essa distinção é exatamente o congelamento que esta linha
      // conserta.
      let tocadas = 0;
      for (const nome of tabelasDaQuery(q.id)) {
        const t = model.table(nome);
        if (t) tocadas = Math.max(tocadas, esqueceCalculadas(t, model, rows));
      }
      if (tocadas > 0) {
        console.error(
          `    ${tocadas.toLocaleString('pt-BR')} linha(s) com coluna calculada de antes — ` +
            `apagadas para recalcular sobre o mesmo AGORA`,
        );
      }
    }

    // Colunas calculadas em DAX entram no arquivo, como o Power BI faz no refresh
    // (ACHADOS #47). Só as que dependem da própria tabela — o resto continua
    // nascendo no carregamento. `AGORA` é o mesmo para toda a execução: `Status SLA`
    // usa `NOW()`, e duas colunas com instantes diferentes no mesmo arquivo seriam
    // uma divergência que ninguém conseguiria explicar depois.
    const daxSha = new Map<string, string>();
    for (const nome of tabelasDaQuery(q.id)) {
      const t = model.table(nome);
      if (!t) continue;

      const semQueryRef = TABELA_SEM_QUERY_REF.get(q.id);
      if (semQueryRef) {
        const tSemRef = Date.now();
        const m = materializaColunas(t, model, rows, AGORA, new Set(semQueryRef.colunas.map(normalizeName)));
        for (const c of m.colunas) if (!columns.includes(c)) columns.push(c);
        for (const [k, v] of m.daxSha) daxSha.set(k, v);
        if (m.colunas.length) {
          console.error(
            `    ${m.colunas.length} coluna(s) calculada(s) (grão de slot nativo) em ` +
              `${Date.now() - tSemRef} ms (ACHADOS #87)`,
          );
        }
        continue;
      }

      const grao = GRAO_REDUZIDO_DE.get(q.id);
      if (grao) {
        const tGrao = Date.now();
        const mGrao = materializaColunasPorGrao(
          t,
          model,
          rows,
          AGORA,
          grao.chave,
          new Set(grao.colunas.map(normalizeName)),
        );
        for (const c of mGrao.colunas) if (!columns.includes(c)) columns.push(c);
        for (const [k, v] of mGrao.daxSha) daxSha.set(k, v);
        if (mGrao.colunas.length) {
          console.error(
            `    ${mGrao.colunas.length} coluna(s) calculada(s) por grão reduzido em ` +
              `${Date.now() - tGrao} ms (ACHADOS #86)`,
          );
        }
      }

      // As colunas do grão reduzido já estão memorizadas na própria linha — esta
      // chamada as revisita de graça (`columnValue` devolve na hora, sem reavaliar
      // DAX) e calcula só o que sobrou (ex.: `ClassificacaoRelato`/
      // `CategoriaProdutividade`, que citam `Relato` e não entram no grão reduzido).
      const m = await materializaColunasDaTabela(t, rows, columns, saida, q.id);
      for (const c of m.colunas) if (!columns.includes(c)) columns.push(c);
      for (const [k, v] of m.daxSha) daxSha.set(k, v);
      if (m.colunas.length) {
        console.error(`    ${m.colunas.length} coluna(s) calculada(s) em ${m.ms} ms`);
      }
    }

    // A marca d'água só existe para quem tem política — sem ela não há o que
    // `decideIncremental` leia numa próxima carga.
    const marca = politica ? marcaDe(rows, politica.marca) : null;

    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    // `escreve()` já grava em temporário e renomeia por dentro (packages/snapshot/src/
    // formato.ts) — inclusive com novas tentativas se o destino estiver aberto por um
    // leitor (Windows/NTFS, ver DEPLOY.md §4.2). Não duplicar o temp/rename aqui.
    const tEscreve = Date.now();
    const cab = await escreve(
      arquivo,
      {
        query: q.id,
        tabelas: tabelasDaQuery(q.id),
        geradoEm: new Date().toISOString(),
        ...(marca ? { marca: marca.toISOString() } : {}),
        ...(politica ? { modo: plano.modo, completoEm: plano.completoEm } : {}),
      },
      columns,
      rows,
    );
    console.error(`    escreve(): ${Date.now() - tEscreve} ms`);

    return {
      query: q.id,
      ok: true,
      linhas: cab.linhas,
      colunas: cab.colunas.length,
      bytes: fs.statSync(arquivo).size,
      ms: Date.now() - inicio,
      ...(politica ? { modo: plano.modo } : {}),
      ...(avisos.length ? { notas: avisos } : {}),
    };
  } catch (err) {
    return {
      query: q.id,
      ok: false,
      linhas: null,
      colunas: null,
      bytes: null,
      ms: Date.now() - inicio,
      erro: err instanceof Error ? err.message : String(err),
      // A janela escolhida vai junto: um erro de carga incremental sem saber com
      // que `:desde` ela rodou é um erro que não dá para reproduzir.
      ...(avisos.length ? { notas: avisos } : {}),
    };
  } finally {
    for (const f of fechar) await f().catch(() => {});
  }
}

if (args.uma) {
  const q = todasAsQueries.find((x) => x.id === args.uma);
  if (!q) {
    console.error(`id não existe ou está fora do escopo: ${args.uma}`);
    process.exit(2);
  }
  console.log(MARCA + JSON.stringify(await materializa(q, args.saida)));
  process.exit(0);
}

// ------------------------------------------------------------------- modo pai
const dashboards = loadDashboards(path.join(ROOT, 'specs'));

if (!args.todas && args.paginas.length === 0 && args.queries.length === 0) {
  console.error(
    'Escolha o que materializar: --pagina=id, --query=id ou --todas.\n' +
      'Não há default de propósito: --todas puxa a base das fontes reais.\n' +
      `Páginas: ${dashboards.map((d) => d.id).join(', ')}`,
  );
  process.exit(2);
}

const pedidas = args.todas
  ? dashboards
  : dashboards.filter((d) => args.paginas.includes(d.id));
const paginasInvalidas = args.paginas.filter((p) => !dashboards.some((d) => d.id === p));
if (paginasInvalidas.length) {
  console.error(`páginas que não existem: ${paginasInvalidas.join(', ')}`);
  process.exit(2);
}

const plano = pedidas.length > 0 ? planeja(pedidas, model) : null;
let alvo = [...new Set([...(plano?.queries ?? []), ...args.queries])].sort();

// Emparelhado, sempre: `field-agenda-slot` não é `queryRef` de tabela nenhuma
// (ACHADOS #87), então `planeja()` nunca o alcança sozinho — e sem isto, o dia em
// que alguém rematerializa `field-agenda` sem lembrar do par deixaria
// `field-agenda-slot.jsonl` velho, servindo grão de slot desatualizado sem aviso
// nenhum. É o mesmo erro do #53/#78 (query e calculada saindo de sincronia), um
// nível acima: aqui são duas QUERIES da mesma tabela.
if (alvo.includes('field-agenda') && !alvo.includes('field-agenda-slot')) {
  alvo = [...alvo, 'field-agenda-slot'].sort();
}

const foraDoEscopo = alvo.filter((id) => FORA_DO_ESCOPO.has(id));
const desconhecidas = alvo.filter(
  (id) => !FORA_DO_ESCOPO.has(id) && !todasAsQueries.some((q) => q.id === id),
);
const materializaveis = alvo.filter((id) => todasAsQueries.some((q) => q.id === id));

console.log(`\nsnapshot em ${path.relative(ROOT, args.saida) || '.'}`);
if (plano) {
  console.log(
    `${plano.dashboards.length} página(s): ${plano.tabelas.length} tabelas, ` +
      `${plano.queries.length} de query e ${plano.calculadas.length} calculada(s) no carregamento` +
      (plano.medidas.length ? `, ${plano.medidas.length} medidas` : ''),
  );
  for (const t of plano.tabelas) {
    console.log(`  ${t.nome.padEnd(28)}${(t.query ?? '(calculada)').padEnd(26)}${t.porque}`);
  }
}
if (foraDoEscopo.length) {
  console.log(
    `\n  fora do escopo da camada M, não materializa: ${foraDoEscopo.join(', ')} ` +
      `(define função dentro de 'let' e lê Web.Contents)`,
  );
}
if (desconhecidas.length) {
  console.error(`\nids que o Query Registry não tem: ${desconhecidas.join(', ')}`);
  process.exit(2);
}

if (args.plano) {
  console.log(`\n--plano: nada foi buscado. Materializaria ${materializaveis.length} query(s).`);
  process.exit(0);
}

/**
 * A entrada de manifesto de um arquivo que já está em disco.
 *
 * Copia do cabeçalho, que é quem manda: `linhas`, `marca` e `modo` são
 * propriedades do arquivo, e o manifesto é só o índice delas.
 */
function entradaDoArquivo(id: string, arquivo: string): EntradaDeManifesto {
  const cab = leCabecalho(arquivo);
  return {
    query: id,
    tabelas: cab.tabelas,
    linhas: cab.linhas,
    colunas: cab.colunas.length,
    bytes: fs.statSync(arquivo).size,
    geradoEm: cab.geradoEm,
    ...(cab.marca ? { marca: cab.marca } : {}),
    ...(cab.modo ? { modo: cab.modo } : {}),
    ...(cab.completoEm ? { completoEm: cab.completoEm } : {}),
  };
}

/**
 * O que já está em disco e continua válido — não se busca de novo sem `--refazer`.
 *
 * `--incremental` esvazia esta lista de propósito: ele existe para **refrescar** o
 * conjunto inteiro barato, e pular o que já está em disco daria um refresh que não
 * refresca. Quem tem política paga só o delta; quem não tem é buscada inteira.
 */
const jaTem = new Map<string, EntradaDeManifesto>();
for (const id of materializaveis) {
  const arquivo = arquivoDaQuery(args.saida, id);
  if (args.refazer || args.incremental || !fs.existsSync(arquivo)) continue;
  try {
    jaTem.set(id, entradaDoArquivo(id, arquivo));
  } catch {
    // Cabeçalho ilegível é arquivo de versão antiga ou truncado: refaz.
  }
}

const aBuscar = materializaveis.filter((id) => !jaTem.has(id));
console.log(
  `\n${aBuscar.length} query(s) a buscar` +
    (jaTem.size ? `, ${jaTem.size} já em disco (use --refazer para rebuscar)` : '') +
    `${args.memoria ? `, heap de ${args.memoria} MB por processo` : ''}`,
);
if (args.incremental) {
  const comPolitica = aBuscar.filter((id) => politicas.has(id));
  console.log(
    `  --incremental: ${comPolitica.length} com política` +
      (comPolitica.length ? ` (${comPolitica.join(', ')})` : '') +
      `, ${aBuscar.length - comPolitica.length} buscada(s) inteira(s).`,
  );
  if (comPolitica.length === 0) {
    console.log(
      `  Nenhuma das pedidas é incremental — isto vai custar o mesmo que --refazer. ` +
        `As políticas vivem em specs/_catalog/incremental.yaml.`,
    );
  }
}
if (aBuscar.length) {
  const doEnv = Math.round(cfg.voalle.statementTimeoutMs / 1000);
  console.log(
    `  statement_timeout de ${args.segundos}s nesta execução` +
      (doEnv !== args.segundos
        ? ` (o .env traz ${doEnv}s — teto de pedido de tela, não de materialização; --timeout= manda)`
        : ''),
  );
}
console.log('');

/**
 * O stderr inteiro num arquivo ao lado do snapshot, e o caminho dele na mensagem.
 *
 * 400 caracteres de resumo servem para ler no terminal; não servem para achar em que
 * linha de que arquivo o erro nasceu. O diretório já está no `.gitignore` e já contém
 * dado de cliente, então é o lugar certo — e o nome termina em `.erro.log` para não
 * ser confundido com tabela por `leManifesto`.
 */
function guardaErro(id: string, erro: string): string {
  if (!erro.trim()) return '';
  try {
    const alvo = path.join(args.saida, `${id}.erro.log`);
    fs.writeFileSync(alvo, erro, 'utf8');
    return ` — stderr completo em ${alvo}`;
  } catch {
    return '';
  }
}

async function rodaEmSubprocesso(id: string): Promise<Resultado> {
  const inicio = Date.now();
  const argv = [
    ...(args.memoria ? [`--max-old-space-size=${args.memoria}`] : []),
    fileURLToPath(import.meta.url),
    `--uma=${id}`,
    `--saida=${args.saida}`,
    `--timeout=${args.segundos}`,
    // Quem decide se a carga é incremental é o filho, olhando o cabeçalho do
    // arquivo — mas a intenção é do pai, e só chega lá por aqui.
    ...(args.incremental ? ['--incremental'] : []),
    ...(args.isolarColunas ? ['--isolar-colunas'] : []),
  ];
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, argv, { cwd: ROOT });
    let saida = '';
    let erro = '';
    filho.stdout.on('data', (d: Buffer) => (saida += d.toString()));
    filho.stderr.on('data', (d: Buffer) => (erro += d.toString()));
    filho.on('close', (code, signal) => {
      const linha = saida.split(/\r?\n/).find((l) => l.startsWith(MARCA));
      if (linha) {
        resolve(JSON.parse(linha.slice(MARCA.length)) as Resultado);
        return;
      }
      const semMemoria = /heap out of memory|Ineffective mark-compacts/.test(erro);
      resolve({
        query: id,
        ok: false,
        linhas: null,
        colunas: null,
        bytes: null,
        ms: Date.now() - inicio,
        erro: semMemoria
          ? `estourou o heap${args.memoria ? ` (${args.memoria} MB)` : ''}. ` +
            'O avaliador de M guarda todos os passos vivos: tente --memoria=8192.'
          : `processo terminou sem resultado (código ${code}, sinal ${signal}): ` +
            resumoDoErro(erro) + guardaErro(id, erro),
      });
    });
  });
}

const alimentam = queriesQueAlimentamCalculada(model);

/**
 * O índice da ÚLTIMA query desta execução que alimenta calculada.
 *
 * Congelar logo depois dela — em vez de no fim de tudo — é o que fecha a janela em que
 * o disco tem query nova e calculada velha. Medido em 18/09/2026 no grupo `frio`:
 * `field-agenda-slot` gravou às 13:46:02 e o congelamento só rodou às 13:49:05, porque
 * esperava `protocolos-produtividade` (2 min sozinha) e `protocolos-auxiliares` — duas
 * queries que não alimentam calculada nenhuma. Foram **192 s** de `agendamento-field`
 * recusando pedido frio por causa de dado que ela não usa.
 *
 * É a ÚLTIMA, e não a primeira: congelar depois de `field-agenda-slot` mas antes de
 * `protocolos-geral` deixaria as calculadas velhas outra vez, agora sem ninguém para
 * corrigi-las até o fim da execução.
 */
const ultimaQueAlimenta = alimentam.seguro
  ? aBuscar.reduce((ultimo, id, i) => (alimentam.queries.has(id) ? i : ultimo), -1)
  : -1;

/** Congela as calculadas num subprocesso. `true` se deu certo. */
function congelaCalculadas(): boolean {
  console.log('\n── Congelando as tabelas calculadas (a outra metade do refresh) ──');
  const calc = spawnSync(
    process.execPath,
    [
      ...(args.memoria ? [`--max-old-space-size=${args.memoria}`] : []),
      path.join(ROOT, 'tools', 'snapshot', 'src', 'calculadas.ts'),
      '--todas',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  return calc.status === 0;
}

const resultados: Resultado[] = [];
/** Congelou no meio do laço? Então o bloco do fim não repete o trabalho. */
let congelouCedo = false;
let congelouCedoOk = true;
for (const [i, id] of aBuscar.entries()) {
  process.stderr.write(`  ${id}… `);
  const r = await rodaEmSubprocesso(id);
  process.stderr.write(`${r.ok ? 'ok' : 'FALHOU'} (${r.ms} ms)\n`);
  // Logo abaixo da linha da query, e não num resumo no fim: quem materializa uma
  // mesclagem morta precisa ver a nota ao lado do nome dela, não a três telas de
  // distância. Junção que não casa nada é a diferença entre dado e BLANK (#64).
  for (const n of r.notas ?? []) process.stderr.write(`      ${n}\n`);
  resultados.push(r);

  // A última que alimenta calculada acabou de gravar: congela AGORA. O que vem depois
  // não é origem de calculada nenhuma, então não as envelhece — é a mesma apuração de
  // dependência que `confereIdadeDaCalculada` usa para decidir se recusa (ver o
  // docstring dela em `packages/snapshot/src/carrega.ts`).
  if (!args.semCalculadas && i === ultimaQueAlimenta && resultados.some((x) => x.ok)) {
    const faltam = aBuscar.length - 1 - i;
    console.log(
      `\n  Congelando as calculadas AGORA: '${id}' era a última desta execução que as` +
        ` alimenta.${faltam > 0 ? ` As ${faltam} restante(s) não são origem de nenhuma.` : ''}`,
    );
    congelouCedo = true;
    congelouCedoOk = congelaCalculadas();
  }
}

// ------------------------------------------------------------------ manifesto
const entradas: EntradaDeManifesto[] = [...jaTem.values()];
for (const r of resultados) {
  if (!r.ok) continue;
  entradas.push(entradaDoArquivo(r.query, arquivoDaQuery(args.saida, r.query)));
}

// O manifesto acumula: materializar `visao-geral` depois de `diario-instalacao`
// não pode apagar do índice o que a primeira deixou em disco.
const anterior = leManifesto(args.saida);
const porQuery = new Map(anterior?.tabelas.map((e) => [e.query, e]) ?? []);
for (const e of entradas) porQuery.set(e.query, e);
const manifesto = await escreveManifesto(args.saida, [...porQuery.values()].sort((a, b) => a.query.localeCompare(b.query)));

// ------------------------------------------------------------------ relatório
const n = (v: number | null): string => (v === null ? '-' : v.toLocaleString('pt-BR'));
const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(1)} MB`;

if (resultados.length) {
  console.log(
    '\n' + 'query'.padEnd(28) + 'linhas'.padStart(12) + 'cols'.padStart(6) +
      'tamanho'.padStart(11) + 'ms'.padStart(9) + '  modo',
  );
  console.log('-'.repeat(80));
  for (const r of resultados) {
    console.log(
      `${r.ok ? ' ' : '✖'}${r.query.padEnd(27)}${n(r.linhas).padStart(12)}` +
        `${n(r.colunas).padStart(6)}${(r.bytes === null ? '-' : mb(r.bytes)).padStart(11)}` +
        `${String(r.ms).padStart(9)}  ${r.modo ?? '-'}`,
    );
  }
}

const falhas = resultados.filter((r) => !r.ok);
if (falhas.length) {
  console.log('\n── Falhas ──');
  for (const r of falhas) console.log(`  ${r.query}: ${r.erro}`);
}

console.log(
  `\nsnapshot: ${manifesto.tabelas.length} query(s), ` +
    `${n(manifesto.tabelas.reduce((a, e) => a + e.linhas, 0))} linhas, ` +
    `${mb(manifesto.tabelas.reduce((a, e) => a + e.bytes, 0))} em disco.`,
);
if (plano?.calculadas.length) {
  console.log(
    `  ${plano.calculadas.length} tabela(s) nascem de DAX no carregamento, não em disco: ` +
      plano.calculadas.join(', '),
  );
}

// A idade da última carga COMPLETA, por query incremental.
//
// Sai sempre que houver política, e não só quando `--incremental` roda: é a
// pergunta que ninguém faz sozinho e que decide se o conjunto ainda é confiável.
// A incremental não enxerga linha que sumiu da fonte sem deixar data, e o único
// remédio é a completa — então o relógio dela tem de ficar à vista.
const incrementais = manifesto.tabelas.filter((e) => politicas.has(e.query));
if (incrementais.length) {
  console.log('\n── Carga incremental ──');
  for (const e of incrementais) {
    const p = politicas.get(e.query)!;
    const completoEm = e.completoEm ?? e.geradoEm;
    const dias = (Date.now() - new Date(completoEm).getTime()) / 86_400_000;
    const marca = e.marca ? comoDia(new Date(e.marca)) : '(sem marca)';
    const alerta = dias > p.idadeMaximaDias ? '  ← PASSOU DO TETO' : '';
    console.log(
      `  ${e.query.padEnd(28)}${(e.modo ?? 'completo').padEnd(13)}` +
        `marca até ${marca}   última completa há ${dias.toFixed(1)} d ` +
        `(teto ${p.idadeMaximaDias})${alerta}`,
    );
  }
  const vencidas = incrementais.filter((e) => {
    const p = politicas.get(e.query)!;
    return (Date.now() - new Date(e.completoEm ?? e.geradoEm).getTime()) / 86_400_000 > p.idadeMaximaDias;
  });
  if (vencidas.length) {
    console.log(
      `\n  Rode uma carga completa: npm run snapshot -- --query=${vencidas.map((e) => e.query).join(',')} --refazer`,
    );
  }
}

console.log('\n  Contém dado de cliente. O diretório está no .gitignore.');

// ------------------------------------------------- a segunda metade do refresh
//
// **Buscar das fontes é metade do trabalho; a outra metade é congelar o DAX.** As
// tabelas calculadas nascem das que acabaram de ser materializadas, então uma query
// nova as deixa velhas no mesmo instante — e o carregamento tem uma trava contra
// exatamente isso (`packages/snapshot/src/confere.ts`), que responde **HTTP 409** e
// derruba a página inteira.
//
// Era um passo separado que só a memória de quem rodava ligava ao primeiro. Em
// 24/08/2026 as queries foram refeitas às 21:42 e as calculadas ficaram nas 18:41:
// cinco das catorze páginas pararam de abrir, e a mensagem que sobrou para o usuário
// foi "nada está carregando". O comando existia e estava certo; o que faltava era
// alguém lembrar de rodá-lo.
//
// Encadear é a correção. `--sem-calculadas` sai fora para quem está depurando uma
// query só e não quer pagar o congelamento a cada tentativa.
//
// **Desde 18/09/2026 este bloco costuma NÃO rodar**, e isso é a correção, não uma
// regressão: quando a origem de toda calculada é apurável, o congelamento já
// aconteceu lá em cima, logo depois da última query que as alimenta. Aqui ele só
// pega dois casos, e os dois de propósito:
//
//   1. `ultimaQueAlimenta === -1` — ou nenhuma query desta execução alimenta
//      calculada (e aí congelar é barato e protege contra a apuração estar
//      incompleta), ou a apuração recusou (`seguro: false`) e vale a régua antiga;
//   2. o congelamento antecipado FALHOU — a mensagem abaixo é a que importa.
if (!args.semCalculadas && resultados.some((r) => r.ok) && !(congelouCedo && congelouCedoOk)) {
  const ok = congelouCedo ? false : congelaCalculadas();
  if (!ok) {
    console.error(
      '\nAs queries foram materializadas, mas o congelamento das calculadas FALHOU.\n' +
        'O snapshot está inconsistente e as páginas vão responder 409 até isto rodar:\n' +
        '  npm run snapshot:calculadas -- --todas',
    );
    process.exit(1);
  }
}

process.exit(falhas.length ? 1 : 0);
