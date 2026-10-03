// A âncora de costura de CADA query de `realtime-poll.yaml` casa no SQL real da spec?
//
// **O defeito que este arquivo existe para impedir, e ele já aconteceu.** A migração de
// `protocolos-telefonia` de 46 passos de M para 5 (commit ec53ca3, 16/09/2026) reindentou
// a linha final do `where` de dois tabs para um e acrescentou uma vírgula — ela virou o
// fecho de uma CTE. A âncora declarada em `realtime-poll.yaml` continuou pedindo dois
// tabs. Resultado: o poller de quase-realtime daquela tabela passou a falhar em TODA
// volta de 12 s, com esta mensagem:
//
//   [poller] PROTOCOLOS TELEFONIA: a âncora da costura incremental aparece 0 vez(es)
//   no SQL, esperado exatamente 1. (…) — tenta de novo na próxima volta
//
// A guarda de `costura()` fez o trabalho dela: errou alto em vez de poluir o SQL em
// silêncio. O que faltou foi alguém lendo. O erro só apareceu porque a stack foi subida
// à mão em 17/09 e alguém olhou o terminal — a suíte inteira passava verde, porque
// nenhum teste ligava as duas pontas.
//
// **Por que isto é teste e não revisão.** As duas pontas moram em arquivos diferentes,
// mantidos por motivos diferentes: o `sql:` da spec muda por migração ou por correção de
// número; a âncora muda por decisão de quase-realtime. Nada no editor liga uma à outra,
// e o custo de esquecer é um poller morto que nunca aparece na suíte.
//
// **Usa o caminho de produção de propósito.** `leConfigDePoll` é a mesma função que o
// `PollerRealtime` chama, e `costura()` é a mesma que ele aplica a cada volta — duas
// cópias divergem sem ninguém notar, que é a lição de `nativas.ts` (`shaConferido`).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { leConfigDePoll } from '../src/poller-realtime.ts';
import { costura } from '../../packages/snapshot/src/incremental.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'backend', 'specs');

/** O `sql:` da spec, lido como o `#sqlDe` do poller o lê. */
function sqlDaSpec(queryId: string): string {
  const arq = path.join(SPECS, '_catalog', 'queries', `${queryId}.spec.yaml`);
  const spec = parseYaml(fs.readFileSync(arq, 'utf8')) as { sql?: string };
  assert.ok(spec.sql, `${arq}: sem campo 'sql:' — o poller não teria o que rodar.`);
  return spec.sql!;
}

const configs = leConfigDePoll(SPECS);

test('realtime-poll.yaml: o arquivo real carrega e declara pelo menos uma query', () => {
  assert.ok(configs.size > 0, 'sem queries, este arquivo inteiro não testa nada');
});

// Um teste POR QUERY, e não um laço dentro de um teste, para que a saída diga QUAL
// quebrou sem obrigar quem lê a abrir o stack trace.
for (const [queryId, cfg] of configs) {
  if (cfg.alvos) {
    // Dois passos (ACHADOS #166): não há costura. As pontas que se ligam são o `sql:` da
    // spec — que tem de ler a view uma vez só, para `montaBuscaPorIds` trocá-la — e os
    // `alvos`, que têm de citar `:desde`. As âncoras DENTRO da view só existem no banco:
    // quem as confere é o poller na primeira busca de cada subida, errando alto.
    test(`realtime-poll.yaml: '${queryId}' em dois passos lê a view uma vez e os alvos citam :desde`, () => {
      const sql = sqlDaSpec(cfg.query);
      const view = cfg.buscaPorIds!.view;
      const ocorrencias = sql.match(new RegExp(`FROM\\s+${view}\\s+\\w+`, 'g')) ?? [];
      assert.equal(ocorrencias.length, 1, `o sql: de ${queryId} tem de ter exatamente um FROM ${view} <alias>`);
      assert.ok(cfg.alvos!.includes(':desde'), 'os alvos têm de citar :desde, senão não recortam nada');
    });
    continue;
  }
  test(`realtime-poll.yaml: a âncora de '${queryId}' casa exatamente 1x no SQL da spec`, () => {
    const sql = sqlDaSpec(cfg.query);
    const politica = {
      query: cfg.query,
      parametro: 'desde',
      piso: '1970-01-01',
      marca: cfg.marca,
      chave: cfg.chave,
      margemDias: 0,
      idadeMaximaDias: Number.MAX_SAFE_INTEGER,
      costura: [cfg.costura!],
    };
    // `costura()` lança quando a âncora não casa, ou casa mais de uma vez. É a MESMA
    // chamada que `PollerRealtime` faz a cada 12 s — se ela passa aqui, o poller sobe.
    const costurado = costura(sql, politica);
    assert.notEqual(costurado, sql, 'a costura não mudou nada — o `para` é igual ao `de`?');
    assert.ok(
      costurado.includes(':desde'),
      'o SQL costurado tem de citar o parâmetro `:desde`, senão o recorte não acontece',
    );
  });
}

// A âncora tem de ser RECORTADA do SQL de verdade, nunca redigitada. Reindentar é o
// jeito mais fácil de quebrá-la sem mudar uma letra do que a consulta faz — foi
// exatamente assim que `protocolos-telefonia` quebrou em 16/09/2026.
//
// **O teste que eu quase deixei aqui estava errado**, e vale registrar: escrevi uma
// asserção proibindo espaço no fim de linha dentro das âncoras, achando que fosse
// higiene. Ela reprovou `instalacoes-reincidentes`, cuja âncora tem `    CASE ` com
// espaço final — **porque o SQL da spec tem**. Âncora não é texto bem-formatado, é
// recorte literal: tudo o que estiver no SQL tem de estar nela, espaço final incluído.
// Proibir isso reprovaria configuração correta e empurraria alguém a "limpar" a âncora
// até ela parar de casar. O invariante verdadeiro é o de cima, e é só ele.

// ---------------------------------------------------------------------------
// A SEGUNDA PONTA SOLTA DO MESMO PAR DE ARQUIVOS (18/09/2026, ACHADOS #135).
//
// O poll de 12 s NÃO substitui o refresh: ele produz um OVERLAY por cima do
// snapshot, e a janela dele começa no ARRANQUE DA API (`novoDelta(agora)` em
// `poller-realtime.ts`), não na marca do snapshot. Toda linha cuja marca caia
// entre as duas — snapshot velho aqui, API subida depois — não está em lugar
// nenhum: nem no arquivo, nem no overlay.
//
// Para as queries COM grupo, essa fresta se fecha sozinha em 15 a 30 minutos: o
// grupo refaz o snapshot e a marca alcança o arranque. Para uma query SEM grupo,
// ela não se fecha nunca — só cresce.
//
// Medido em 18/09/2026, quando `protocolos-auxiliares` era a única query polida
// fora de todo grupo: snapshot de 16/09 14:32, API subida em 17/09 13:49,
// **495 linhas na fresta**. Não é hipótese, é contagem.
//
// Este teste liga as duas pontas, que é o que faltava no #131: lá o `sql:` e a
// âncora moravam em arquivos diferentes e nada os conferia junto; aqui são o
// `realtime-poll.yaml` e o `refresh.yaml`.
test('toda query com poll de quase-realtime tem um grupo de refresh atrás dela', () => {
  const polls = [...leConfigDePoll(SPECS).keys()];
  assert.ok(polls.length > 0, 'realtime-poll.yaml não declara query nenhuma');

  const grupos = parseYaml(
    fs.readFileSync(path.join(SPECS, '_catalog', 'refresh.yaml'), 'utf8'),
  ) as { grupos?: Record<string, { queries?: string[] }> };
  const comGrupo = new Set(
    Object.values(grupos.grupos ?? {}).flatMap((g) => g.queries ?? []),
  );

  const orfas = polls.filter((q) => !comGrupo.has(q));
  assert.deepEqual(
    orfas,
    [],
    `estas queries têm poll de 12 s e NENHUM grupo de refresh: ${orfas.join(', ')}. ` +
      'O poll não cobre a fresta entre a marca do snapshot e o arranque da API — ' +
      'sem grupo, essa fresta nunca fecha. Ponha cada uma num grupo de ' +
      'backend/specs/_catalog/refresh.yaml (o `frio` costuma bastar: quem dá frescor é o poll, ' +
      'o grupo só precisa fazer a marca alcançar o arranque).',
  );
});
