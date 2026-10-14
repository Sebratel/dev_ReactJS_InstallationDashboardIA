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
  sessao: {
    ttl_horas: number;
    ociosidade_minutos: number;
    ao_remover_pessoa: 'derruba_sessoes';
    troca_de_ip: 'registra';
    admin_ve_e_derruba: true;
  };
  filtros: {
    permitidos: 'derivados_da_pagina';
    modo: 'observar' | 'bloquear';
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
    sessao: secaoDeSessao(bruto?.sessao),
    filtros: secaoDeFiltros(bruto?.filtros),
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

/** Só aceita o que a api implementa: um valor novo na spec (ex.: `troca_de_ip: derruba`)
 *  sem o código correspondente tem de derrubar a subida, não ser ignorado. */
function secaoDeSessao(v: unknown): SpecDeSeguranca['sessao'] {
  const s = (v ?? null) as Record<string, unknown> | null;
  if (!s) throw new Error("seguranca.yaml: falta a seção 'sessao'.");
  const positivo = (x: unknown, onde: string): number => {
    if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) {
      throw new Error(`seguranca.yaml: 'sessao.${onde}' tem de ser um número positivo.`);
    }
    return x;
  };
  const exato = <T extends string | boolean>(x: unknown, valor: T, onde: string): T => {
    if (x !== valor) throw new Error(`seguranca.yaml: 'sessao.${onde}' só aceita ${String(valor)} (o que a api implementa).`);
    return valor;
  };
  return {
    ttl_horas: positivo(s.ttl_horas, 'ttl_horas'),
    ociosidade_minutos: positivo(s.ociosidade_minutos, 'ociosidade_minutos'),
    ao_remover_pessoa: exato(s.ao_remover_pessoa, 'derruba_sessoes', 'ao_remover_pessoa'),
    troca_de_ip: exato(s.troca_de_ip, 'registra', 'troca_de_ip'),
    admin_ve_e_derruba: exato(s.admin_ve_e_derruba, true, 'admin_ve_e_derruba'),
  };
}

function secaoDeFiltros(v: unknown): SpecDeSeguranca['filtros'] {
  const f = (v ?? null) as Record<string, unknown> | null;
  if (!f) throw new Error("seguranca.yaml: falta a seção 'filtros'.");
  if (f.permitidos !== 'derivados_da_pagina') {
    throw new Error("seguranca.yaml: 'filtros.permitidos' só aceita derivados_da_pagina (o que a api implementa).");
  }
  if (f.modo !== 'observar' && f.modo !== 'bloquear') {
    throw new Error("seguranca.yaml: 'filtros.modo' é observar ou bloquear.");
  }
  return { permitidos: 'derivados_da_pagina', modo: f.modo };
}
