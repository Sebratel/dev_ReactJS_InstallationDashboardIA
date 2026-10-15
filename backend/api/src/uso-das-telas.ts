import type mysql from "mysql2/promise";

const JANELA_DEDUPE_MS = 30 * 60_000;
const TETO_DEDUPE = 10_000;
const INTERVALO_GRAVACAO_MS = 3 * 60_000;
const CACHE_LEITURA_MS = 5 * 60_000;

interface Pendente {
  dia: string;
  tela: string;
  email: string;
  aberturas: number;
  ultimaAbertura: Date;
}

export interface TelaConhecida {
  id: string;
  nome: string;
}

export interface UsoDeTela {
  id: string;
  nome: string;
  aberturas: number;
  pessoas: number;
  ultimaAbertura: string | null;
}

export interface ResumoDeUso {
  dias: 7 | 30 | 90;
  pessoasAtivas: number;
  telas: UsoDeTela[];
  geradoEm: string;
}

export interface EstadoDoUso {
  pendentes: number;
  descartadas: number;
  falhando: boolean;
  ultimaGravacao: string | null;
}

export interface UsoDasTelas {
  registra(email: string, tela: string, agora?: Date): boolean;
  descarrega(): Promise<void>;
  le(
    dias: 7 | 30 | 90,
    telas: readonly TelaConhecida[],
    agora?: Date,
  ): Promise<ResumoDeUso>;
  estado(): EstadoDoUso;
  para(): void;
}

type BancoDeUso = Pick<mysql.Pool, "query">;

function chave(...partes: string[]): string {
  return JSON.stringify(partes);
}

export function diaEmSaoPaulo(data: Date): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(data);
  const pega = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value;
  return `${pega("year")}-${pega("month")}-${pega("day")}`;
}

export function criaUsoDasTelas(
  banco: BancoDeUso,
  opts: {
    cadaMs?: number;
    teto?: number;
    lote?: number;
    cacheMs?: number;
    agora?: () => Date;
    log?: (mensagem: string) => void;
  } = {},
): UsoDasTelas {
  const teto = opts.teto ?? 5_000;
  const lote = opts.lote ?? 500;
  const cacheMs = opts.cacheMs ?? CACHE_LEITURA_MS;
  const relogio = opts.agora ?? (() => new Date());
  const log = opts.log ?? ((mensagem: string) => console.warn(mensagem));
  const pendentes = new Map<string, Pendente>();
  const vistos = new Map<string, number>();
  const cache = new Map<number, { venceEm: number; valor: ResumoDeUso }>();
  let descartadas = 0;
  let falhando = false;
  let ultimaGravacao: Date | null = null;
  let gravando: Promise<void> | null = null;

  const devolveAoBuffer = (itens: readonly [string, Pendente][]): void => {
    for (const [id, item] of itens) {
      const atual = pendentes.get(id);
      if (atual) {
        atual.aberturas += item.aberturas;
        if (item.ultimaAbertura > atual.ultimaAbertura)
          atual.ultimaAbertura = item.ultimaAbertura;
      } else if (pendentes.size < teto) {
        pendentes.set(id, item);
      } else {
        descartadas += item.aberturas;
      }
    }
  };

  const grava = async (): Promise<void> => {
    const itens = [...pendentes.entries()].slice(0, lote);
    if (itens.length === 0) return;
    for (const [id] of itens) pendentes.delete(id);
    const valores = itens.map(([, item]) => [
      item.dia,
      item.tela,
      item.email,
      item.aberturas,
      item.ultimaAbertura,
    ]);
    try {
      await banco.query(
        "INSERT INTO screen_usage_daily (day, screen_id, email, opens, last_opened_at) VALUES ? " +
          "ON DUPLICATE KEY UPDATE opens = opens + VALUES(opens), " +
          "last_opened_at = GREATEST(last_opened_at, VALUES(last_opened_at))",
        [valores],
      );
      cache.clear();
      ultimaGravacao = relogio();
      if (falhando)
        log(`[uso-abas] gravação voltou (${itens.length} agregado(s))`);
      falhando = false;
    } catch (erro) {
      devolveAoBuffer(itens);
      if (!falhando) {
        log(
          `[uso-abas] FALHA ao gravar: ${erro instanceof Error ? erro.message : String(erro)} — ` +
            "a página continua normal; mantendo o agregado em memória",
        );
      }
      falhando = true;
    }
  };

  const descarrega = (): Promise<void> => {
    gravando ??= grava().finally(() => {
      gravando = null;
    });
    return gravando;
  };

  const timer = setInterval(
    () => void descarrega(),
    opts.cadaMs ?? INTERVALO_GRAVACAO_MS,
  );
  timer.unref?.();

  return {
    registra(email, tela, agora = relogio()) {
      const idDedupe = chave(email, tela);
      const instante = agora.getTime();
      const vistoEm = vistos.get(idDedupe);
      if (vistoEm !== undefined && instante - vistoEm < JANELA_DEDUPE_MS)
        return false;

      if (vistos.size >= TETO_DEDUPE && !vistos.has(idDedupe)) {
        const maisAntigo = vistos.keys().next().value as string | undefined;
        if (maisAntigo) vistos.delete(maisAntigo);
      }
      vistos.delete(idDedupe);
      vistos.set(idDedupe, instante);

      const dia = diaEmSaoPaulo(agora);
      const idPendente = chave(dia, tela, email);
      const atual = pendentes.get(idPendente);
      if (!atual && pendentes.size >= teto) {
        descartadas++;
        return false;
      }

      if (atual) {
        atual.aberturas++;
        atual.ultimaAbertura = agora;
      } else {
        pendentes.set(idPendente, {
          dia,
          tela,
          email,
          aberturas: 1,
          ultimaAbertura: agora,
        });
      }
      return true;
    },
    descarrega,
    async le(dias, telas, agora = relogio()) {
      const emCache = cache.get(dias);
      if (emCache && emCache.venceEm > agora.getTime()) return emCache.valor;

      const inicio = diaEmSaoPaulo(
        new Date(agora.getTime() - (dias - 1) * 86_400_000),
      );
      const [porTela] = await banco.query(
        "SELECT screen_id, SUM(opens) AS opens, COUNT(DISTINCT email) AS people, " +
          "MAX(last_opened_at) AS last_opened_at FROM screen_usage_daily " +
          "WHERE day >= ? GROUP BY screen_id",
        [inicio],
      );
      const [ativas] = await banco.query(
        "SELECT COUNT(DISTINCT email) AS people FROM screen_usage_daily WHERE day >= ?",
        [inicio],
      );
      const linhas = porTela as {
        screen_id: string;
        opens: string | number;
        people: string | number;
        last_opened_at: Date | null;
      }[];
      const porId = new Map(linhas.map((linha) => [linha.screen_id, linha]));
      const resumo: ResumoDeUso = {
        dias,
        pessoasAtivas: Number(
          (ativas as { people: string | number }[])[0]?.people ?? 0,
        ),
        telas: telas.map((tela) => {
          const linha = porId.get(tela.id);
          return {
            id: tela.id,
            nome: tela.nome,
            aberturas: Number(linha?.opens ?? 0),
            pessoas: Number(linha?.people ?? 0),
            ultimaAbertura: linha?.last_opened_at
              ? new Date(linha.last_opened_at).toISOString()
              : null,
          };
        }),
        geradoEm: agora.toISOString(),
      };
      cache.set(dias, { venceEm: agora.getTime() + cacheMs, valor: resumo });
      return resumo;
    },
    estado: () => ({
      pendentes: pendentes.size,
      descartadas,
      falhando,
      ultimaGravacao: ultimaGravacao?.toISOString() ?? null,
    }),
    para: () => clearInterval(timer),
  };
}
