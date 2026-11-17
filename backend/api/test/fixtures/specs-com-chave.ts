// Uma raiz de repositório com as specs copiadas e `completa_no_snapshot` (projecao.yaml) no
// valor pedido — para os testes do caminho do snapshot com e sem a agenda completa não
// dependerem do valor do dia (docs/DECISAO-AO-VIVO.md, passo 5: virou `false` em 26/10/2026).
// Uma cópia por valor e por processo; apagadas na saída.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const raizes = new Map<boolean, string>();

export function raizComAgendaCompleta(completa: boolean): string {
  const pronta = raizes.get(completa);
  if (pronta) return pronta;
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), `specs-${completa ? 'com' : 'sem'}-completa-`));
  fs.cpSync(path.join(ROOT, 'backend', 'specs'), path.join(raiz, 'backend', 'specs'), { recursive: true });
  const projecao = path.join(raiz, 'backend', 'specs', '_catalog', 'projecao.yaml');
  const texto = fs.readFileSync(projecao, 'utf8');
  if (!/completa_no_snapshot: (true|false)/.test(texto)) throw new Error('projecao.yaml sem completa_no_snapshot');
  fs.writeFileSync(projecao, texto.replace(/completa_no_snapshot: (true|false)/, `completa_no_snapshot: ${completa}`));
  raizes.set(completa, raiz);
  return raiz;
}

process.on('exit', () => {
  for (const raiz of raizes.values()) fs.rmSync(raiz, { recursive: true, force: true });
});
