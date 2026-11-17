#!/usr/bin/env node
// O processo filho de UMA busca ao vivo (`geracao-em-processo.ts`): monta o próprio
// contexto (pools no SRD e no Maria), gera o conjunto pedido na pasta pedida e sai —
// devolvendo ao sistema toda a memória que a busca usou.
//
// Recebe o `PedidoDeGeracao` em JSON no argv. Na saída padrão, uma linha JSON com o que
// veio e o pico de memória do processo; erro vai para a saída de erro e o código é ≠ 0.
// REGRA DE SAÍDA: contagem, tempo e memória. Nunca valor de linha.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDotEnv } from '../../packages/query-engine/src/config.ts';
import { montaContextoAoVivo } from './contexto-ao-vivo.ts';
import { geraConjunto, type PedidoDeGeracao } from './geracao-do-conjunto.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
applyDotEnv(ROOT);

const pedido = JSON.parse(process.argv[2] ?? 'null') as PedidoDeGeracao | null;
if (!pedido?.conjunto || !pedido.dir) {
  console.error('uso: node filho-ao-vivo.ts <PedidoDeGeracao em JSON>');
  process.exit(2);
}
const contexto = await montaContextoAoVivo(ROOT);
if ('porque' in contexto) {
  console.error(`[ao-vivo] ${contexto.porque}`);
  process.exit(1);
}
try {
  const r = await geraConjunto(contexto, ROOT, pedido);
  // `maxRSS` vem em KB.
  process.stdout.write(`${JSON.stringify({ ...r, picoMB: Math.round(process.resourceUsage().maxRSS / 1024) })}\n`);
} finally {
  await contexto.fecha();
}
process.exit(0);
