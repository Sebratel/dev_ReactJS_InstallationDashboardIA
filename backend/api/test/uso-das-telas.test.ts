import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Identidade } from "../src/identidade.ts";
import type { AcessoDasTelas } from "../src/permissoes.ts";
import { Servidor } from "../src/servidor.ts";
import {
  criaUsoDasTelas,
  diaEmSaoPaulo,
  type ResumoDeUso,
  type UsoDasTelas,
} from "../src/uso-das-telas.ts";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

test("dia do agregado usa o calendário de São Paulo no limite UTC", () => {
  assert.equal(
    diaEmSaoPaulo(new Date("2026-10-15T02:30:00.000Z")),
    "2026-10-14",
  );
});

function bancoFalso() {
  const lotes: unknown[][][] = [];
  let falha = false;
  return {
    lotes,
    falha: (valor = true) => (falha = valor),
    pool: {
      query: (async (_sql: string, params: unknown[]) => {
        if (falha) throw new Error("MariaDB fora");
        lotes.push(params[0] as unknown[][]);
        return [[], []];
      }) as never,
    },
  };
}

test("deduplica por pessoa e aba por 30 minutos e grava o agregado em um lote", async () => {
  const banco = bancoFalso();
  const uso = criaUsoDasTelas(banco.pool, { cadaMs: 60_000, log: () => {} });
  try {
    const inicio = new Date("2026-10-15T12:00:00.000Z");
    assert.equal(uso.registra("ana@sebratel.com.br", "capa", inicio), true);
    assert.equal(
      uso.registra(
        "ana@sebratel.com.br",
        "capa",
        new Date(inicio.getTime() + 29 * 60_000),
      ),
      false,
    );
    assert.equal(
      uso.registra(
        "ana@sebratel.com.br",
        "capa",
        new Date(inicio.getTime() + 30 * 60_000),
      ),
      true,
    );
    assert.equal(uso.registra("ana@sebratel.com.br", "diario", inicio), true);
    await uso.descarrega();

    assert.equal(banco.lotes.length, 1);
    assert.equal(banco.lotes[0]!.length, 2);
    const capa = banco.lotes[0]!.find((linha) => linha[1] === "capa");
    assert.equal(capa?.[3], 2);
  } finally {
    uso.para();
  }
});

test("banco fora não lança, preserva o lote e expõe falha e descarte no estado", async () => {
  const banco = bancoFalso();
  const uso = criaUsoDasTelas(banco.pool, {
    cadaMs: 60_000,
    teto: 1,
    log: () => {},
  });
  try {
    banco.falha();
    assert.equal(uso.registra("ana@sebratel.com.br", "capa"), true);
    assert.equal(uso.registra("bia@sebratel.com.br", "diario"), false);
    await assert.doesNotReject(uso.descarrega());
    assert.deepEqual(uso.estado(), {
      pendentes: 1,
      descartadas: 1,
      falhando: true,
      ultimaGravacao: null,
    });
    banco.falha(false);
    await uso.descarrega();
    assert.equal(uso.estado().pendentes, 0);
    assert.equal(banco.lotes[0]?.length, 1);
  } finally {
    uso.para();
  }
});

test("leitura parte da lista conhecida e inclui abas sem abertura", async () => {
  const consultas: string[] = [];
  const pool = {
    query: (async (sql: string) => {
      consultas.push(sql);
      if (sql.includes("GROUP BY")) {
        return [
          [
            {
              screen_id: "capa",
              opens: "4",
              people: "2",
              last_opened_at: new Date("2026-10-15T12:00:00Z"),
            },
          ],
          [],
        ];
      }
      return [[{ people: "2" }], []];
    }) as never,
  };
  const uso = criaUsoDasTelas(pool, { cadaMs: 60_000 });
  try {
    const resumo = await uso.le(
      7,
      [
        { id: "capa", nome: "CAPA" },
        { id: "diario", nome: "DIÁRIO" },
      ],
      new Date("2026-10-15T15:00:00Z"),
    );
    assert.equal(resumo.pessoasAtivas, 2);
    assert.deepEqual(
      resumo.telas.map(({ id, aberturas }) => ({ id, aberturas })),
      [
        { id: "capa", aberturas: 4 },
        { id: "diario", aberturas: 0 },
      ],
    );
    await uso.le(7, [], new Date("2026-10-15T15:01:00Z"));
    assert.equal(
      consultas.length,
      2,
      "cache evita repetir GROUP BY por alguns minutos",
    );
  } finally {
    uso.para();
  }
});

const pessoa = (
  usuario: string,
  papeis: string[] = ["autenticado"],
): Identidade => ({ usuario, papeis });

async function sobe() {
  const registros: string[] = [];
  const estado = { quem: pessoa("admin@sebratel.com.br") };
  const acesso: AcessoDasTelas = {
    podeVer: (_quem, tela) => tela === "capa",
    papelDe: (quem) => (quem.usuario.startsWith("admin") ? "admin" : "viewer"),
    podeGerir: (quem) => quem.usuario.startsWith("admin"),
    matriz: () => ({ telas: [], pessoas: [], pedidos: [] }),
    muda: async () => {},
    estado: () => ({ ok: true, origem: "teste" }),
    registraPedido: () => {},
  };
  const resumo: ResumoDeUso = {
    dias: 30,
    pessoasAtivas: 1,
    telas: [],
    geradoEm: "2026-10-15T12:00:00.000Z",
  };
  const uso: UsoDasTelas = {
    registra: (_email, tela) => (registros.push(tela), true),
    descarrega: async () => {},
    le: async (dias) => ({ ...resumo, dias }),
    estado: () => ({
      pendentes: 0,
      descartadas: 3,
      falhando: false,
      ultimaGravacao: null,
    }),
    para: () => {},
  };
  const servidor = new Servidor({
    root: ROOT,
    snapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), "uso-abas-")),
    webDir: path.join(ROOT, "frontend", "dist"),
    identifica: () => estado.quem,
    acesso,
    usoDasTelas: uso,
  });
  const http = servidor.criaHttp();
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  return {
    estado,
    registros,
    base,
    busca: (rota: string, init?: RequestInit) => fetch(`${base}${rota}`, init),
    fecha: () =>
      new Promise<void>((resolve) => {
        servidor.destroi();
        http.close(() => resolve());
      }),
  };
}

test("rota conta abertura real, mas exclui prefetch e sessão interna sem afetar a resposta", async () => {
  const servidor = await sobe();
  const posta = (rota: string) =>
    servidor.busca(rota, {
      method: "POST",
      headers: { origin: servidor.base, "content-type": "application/json" },
      body: JSON.stringify({ tela: "capa" }),
    });
  try {
    assert.equal((await posta("/api/uso/abertura")).status, 204);
    assert.equal(
      (await posta("/api/uso/abertura?origem=prefetch")).status,
      204,
    );
    servidor.estado.quem = pessoa("aquecedor-interno", ["interno"]);
    assert.equal((await posta("/api/uso/abertura")).status, 204);
    assert.deepEqual(servidor.registros, ["capa"]);
    assert.equal((await servidor.busca("/api/uso/abertura")).status, 405);
  } finally {
    await servidor.fecha();
  }
});

test("viewer recebe 403 na leitura e saúde publica contagem de descartes", async () => {
  const servidor = await sobe();
  try {
    servidor.estado.quem = pessoa("viewer@sebratel.com.br");
    assert.equal((await servidor.busca("/api/admin/uso?dias=30")).status, 403);
    const saude = (await (await servidor.busca("/api/saude")).json()) as {
      usoDasTelas: { descartadas: number };
    };
    assert.equal(saude.usoDasTelas.descartadas, 3);
  } finally {
    await servidor.fecha();
  }
});
