// Lê `backend/specs/_catalog/seguranca.yaml` — o contrato de segurança (docs/PLANO-SEGURANCA.md).
//
// Falha ALTO: arquivo ausente ou seção malformada derruba a subida em vez de cair num
// padrão. Um padrão silencioso aqui seria a trava degradando sem ninguém ver — o mesmo
// defeito que `portao-login.ts` existe para impedir.

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export interface SpecDeSeguranca {
  rotas_de_maquina: {
    porta_publica_bloqueia: string[];
    cabecalhos_apagados_no_proxy: string[];
    bundle_so_em_dev: { ambiente: string; na_tela: string }[];
  };
}

export function caminhoDaSpecDeSeguranca(root: string): string {
  return path.join(root, 'backend', 'specs', '_catalog', 'seguranca.yaml');
}

function listaDeTexto(v: unknown, onde: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x !== '')) {
    throw new Error(`seguranca.yaml: '${onde}' tem de ser uma lista de textos não vazios.`);
  }
  return v as string[];
}

export function leSpecDeSeguranca(root: string): SpecDeSeguranca {
  const bruto = parse(fs.readFileSync(caminhoDaSpecDeSeguranca(root), 'utf8')) as Record<string, unknown> | null;
  const rotas = (bruto?.rotas_de_maquina ?? null) as Record<string, unknown> | null;
  if (!rotas) throw new Error("seguranca.yaml: falta a seção 'rotas_de_maquina'.");
  return {
    rotas_de_maquina: {
      porta_publica_bloqueia: listaDeTexto(rotas.porta_publica_bloqueia, 'rotas_de_maquina.porta_publica_bloqueia'),
      cabecalhos_apagados_no_proxy: listaDeTexto(
        rotas.cabecalhos_apagados_no_proxy,
        'rotas_de_maquina.cabecalhos_apagados_no_proxy',
      ),
      bundle_so_em_dev: paresDeBundle(rotas.bundle_so_em_dev),
    },
  };
}

function paresDeBundle(v: unknown): { ambiente: string; na_tela: string }[] {
  const ok =
    Array.isArray(v) &&
    v.every(
      (x) =>
        x !== null &&
        typeof x === 'object' &&
        typeof (x as Record<string, unknown>).ambiente === 'string' &&
        typeof (x as Record<string, unknown>).na_tela === 'string',
    );
  if (!ok) throw new Error("seguranca.yaml: 'rotas_de_maquina.bundle_so_em_dev' tem de ser lista de { ambiente, na_tela }.");
  return v as { ambiente: string; na_tela: string }[];
}
