// Toda ferramenta que roda a camada M tem de honrar `backend/specs/_catalog/juncoes.yaml`.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ESTE TESTE EXISTE, E POR QUE ELE LÊ CÓDIGO-FONTE
//
// A reconciliação de mesclagem morta entrou no materializador em 14/08/2026
// (achado #64, commit `d2293e9`) e **saiu em 26/08 no commit que se chamava
// "restaurar 100% do estado"** (`0aae15c`) — o episódio que
// `docs/RECUPERACAO-27-08.md` registra. Ficou fora por 20 dias.
//
// O efeito não foi uma falha: foi `BACKLOG AGENDADO FUTURO`
// ['PROTOCOLOS GERAL.TIPO DE PROTOCOLO'] e `PROTOCOLOS GERAL`
// ['TECNICOS AUXILIARES.AUXILIAR'] saindo **inteiras nulas** de toda
// materialização, e as páginas que as leem mostrando BLANK. Número plausível,
// sem erro nenhum — a única classe de defeito que este projeto não aceita.
//
// `npm run snapshot:confere` acusou as duas o tempo todo. O alarme funcionou; o
// que faltou foi alguém ligar o alarme à causa. Este teste é essa ligação.
//
// **Ele lê o FONTE, e isso é uma escolha, não preguiça.** O que se quer afirmar é
// "a ligação existe no programa", e os dois programas são CLIs que só rodam com
// banco e credencial — não dá para instanciá-los num teste. Um teste de fonte é
// grosseiro e pega pouco (não vê se `reconcilia` foi passado para a chamada
// certa), mas pega EXATAMENTE o que aconteceu: a linha desaparecer.
//
// Se um dia a materialização puder rodar contra uma fonte falsa, este teste deve
// ser trocado por um que materialize e confira a coluna. Até lá, ele é o guarda
// que não existia.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Quem roda a camada M e, portanto, tem de honrar a decisão registrada. */
const FERRAMENTAS = [
  ['backend/tools/snapshot/src/index.ts', 'materializa o snapshot que a API serve'],
  ['backend/tools/mrun/src/index.ts', 'diagnostica a camada M (achado #73)'],
] as const;

for (const [rel, papel] of FERRAMENTAS) {
  test(`${rel} honra juncoes.yaml — ${papel}`, () => {
    const fonte = fs.readFileSync(path.join(ROOT, rel), 'utf8');

    assert.ok(
      fonte.includes('reconciliadorDe'),
      `${rel} não monta o reconciliador. Sem ele, mesclagem que o ` +
        `backend/specs/_catalog/juncoes.yaml libera continua morta, e a coluna aninhada sai ` +
        `INTEIRA NULA — a tela lê BLANK e nada erra alto. Ver achado #64.`,
    );

    assert.ok(
      /\breconcilia\b\s*[,:]/.test(fonte),
      `${rel} monta o reconciliador e não o PASSA para \`runQueries\`. ` +
        `Montar sem passar é pior que não montar: o programa carrega a decisão ` +
        `humana e a ignora.`,
    );
  });
}

test('as duas ferramentas honram a MESMA decisão', () => {
  // Se só uma reconciliar, o diagnóstico diverge da materialização — e é a
  // ferramenta de investigar que passa a mentir sobre o que a de gravar faz. Foi
  // esse o achado #73, na direção contrária (faltava no `mrun`).
  const ligadas = FERRAMENTAS.filter(([rel]) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('reconciliadorDe'),
  );
  assert.equal(
    ligadas.length,
    FERRAMENTAS.length,
    `só ${ligadas.length} de ${FERRAMENTAS.length} ferramentas reconciliam. As duas ` +
      `rodam a mesma camada M: com uma só, investigar e gravar dão respostas diferentes.`,
  );
});

test('o juncoes.yaml existe e as entradas de hoje continuam declaradas', () => {
  // Não fixa o conteúdo — a decisão é humana e pode mudar. Fixa que o arquivo é
  // legível e que as duas reconciliações medidas em 13/08/2026 não sumiram sem
  // ninguém dizer nada, que é como esta família de defeito acontece.
  const p = path.join(ROOT, 'backend', 'specs', '_catalog', 'juncoes.yaml');
  assert.ok(fs.existsSync(p), 'backend/specs/_catalog/juncoes.yaml sumiu');
  const texto = fs.readFileSync(p, 'utf8');
  assert.match(texto, /reconciliar_como_inteiro:/);
  for (const q of ['backlog-agendado-futuro', 'protocolos-geral']) {
    assert.ok(
      texto.includes(`query: ${q}`),
      `a reconciliação de '${q}' saiu do juncoes.yaml. Ela foi decidida e MEDIDA em ` +
        `13/08/2026; tirá-la faz uma coluna voltar a sair inteira nula.`,
    );
  }
});
