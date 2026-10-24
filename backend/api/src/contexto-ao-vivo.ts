// O contexto da fonte ao vivo (docs/DECISAO-AO-VIVO.md): specs, catálogo de costuras e
// pools PRÓPRIOS no SRD e no MariaDB — montado uma vez por `index.ts` e dividido entre
// a página servida ao vivo (`periodos-ao-vivo.ts`) e o modo sombra (`sombra-ao-vivo.ts`).
//
// Pools próprios, e não os do poller: a busca de um período segura conexão por até
// ~25 s, e o poller não pode esperar atrás dela. Aparecem no `pg_stat_activity` do SRD
// como `analytics-ao-vivo`, para o custo no banco ter dono. Só leitura, como todo pool
// desta base (`default_transaction_read_only=on`).

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { leAgregadasAoVivo, leCatalogoAoVivo, type AgregadaAoVivo } from '../../packages/ao-vivo/src/catalogo.ts';
import type { ContextoAoVivo } from '../../packages/ao-vivo/src/executor.ts';
import { loadConfig, missingFor } from '../../packages/query-engine/src/config.ts';
import {
  createMariaConnector,
  createMariaPool,
  createVoalleConnector,
  createVoallePool,
} from '../../packages/query-engine/src/connectors-sql.ts';
import { QueryRegistry } from '../../packages/query-engine/src/registry.ts';
import type { Connector } from '../../packages/query-engine/src/types.ts';
import { leJuncoes, reconciliadorDe } from '../../packages/semantic-model/src/juncoes.ts';
import { SemanticModel } from '../../packages/semantic-model/src/model.ts';

export interface ContextoMontado {
  readonly ctx: ContextoAoVivo;
  readonly model: SemanticModel;
  readonly relatosDoDia: AgregadaAoVivo;
  readonly fecha: () => Promise<void>;
}

/**
 * O contexto, ou o motivo de não haver um — `index.ts` registra a frase nos dois casos.
 * O ao vivo é opcional: credencial faltando ou `ao-vivo.yaml` que não lê desliga ele, não
 * a API.
 */
export async function montaContextoAoVivo(root: string): Promise<ContextoMontado | { porque: string }> {
  const falta = [...missingFor('voalle'), ...missingFor('maria')];
  if (falta.length) return { porque: `falta no ambiente: ${falta.join(', ')}` };
  try {
    return await monta(root);
  } catch (err) {
    return { porque: `não montou (${err instanceof Error ? err.message.split('\n')[0] : String(err)})` };
  }
}

async function monta(root: string): Promise<ContextoMontado> {
  const specs = path.join(root, 'backend', 'specs');
  // As specs antes dos pools: o que não lê recusa sem deixar pool aberto para trás.
  const model = SemanticModel.fromSpecsDir(specs);
  const registry = QueryRegistry.fromSpecsDir(specs);
  const catalogo = leCatalogoAoVivo(specs);
  const reconcilia = reconciliadorDe(leJuncoes(specs));
  const culture =
    (parseYaml(fs.readFileSync(path.join(specs, '_catalog', 'model.yaml'), 'utf8')) as { culture?: string | null }).culture ?? null;
  const relatosDoDia = leAgregadasAoVivo(specs).get('relatos-do-dia');
  if (!relatosDoDia) throw new Error('ao-vivo.yaml sem a agregada relatos-do-dia');

  const cfg = loadConfig();
  // O teto do pedido de tela (30 s no .env) não cabe nem o mês da agenda. Quem espera a
  // busca é o cache do período, não uma pessoa (a tela cai para o snapshot em 45 s), então
  // o teto é o da consulta mais pesada com o SRD ocupado: a produtividade do ano leva
  // 43–54 s sozinha, 110 s disputando o banco, e passou de 2 min no teste de ponta a ponta
  // de 24/10/2026 — que é o teto que estava aqui.
  const statementTimeoutMs = 300_000;
  // 4 conexões: duas buscas de período ao mesmo tempo (`maxBuscasJuntas`), e cada uma
  // roda a agenda e as contagens de relato em paralelo.
  const voalle = await createVoallePool({ ...cfg.voalle, poolMax: 4, statementTimeoutMs, applicationName: 'analytics-ao-vivo' });
  const maria = await createMariaPool({ ...cfg.maria, poolMax: 2, statementTimeoutMs });
  return {
    ctx: {
      registry,
      model,
      catalogo,
      connectors: new Map<string, Connector>([
        ['dbVoalle', createVoalleConnector(voalle)],
        ['dbMaria', createMariaConnector(maria)],
      ]),
      culture,
      reconcilia,
    },
    model,
    relatosDoDia,
    fecha: async () => {
      await Promise.allSettled([voalle.end(), maria.end()]);
    },
  };
}
