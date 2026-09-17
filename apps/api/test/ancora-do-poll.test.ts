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
import { costura } from '../../../packages/snapshot/src/incremental.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPECS = path.join(ROOT, 'specs');

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
      costura: [cfg.costura],
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
