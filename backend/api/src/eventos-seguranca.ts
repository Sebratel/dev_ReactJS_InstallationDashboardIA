// Os eventos de segurança no banco (`DB_InstallationDashboard.security_events`, ACHADOS
// #208): o que até aqui era só a linha `[seg]` do log do container — e morria com ele —, mais
// o login certo e o errado.
//
// **Nunca atrasa uma resposta.** `registra` só empurra para um buffer em memória; quem grava é
// um temporizador, a cada 5 s, num INSERT de várias linhas. Banco fora: o lote volta para o
// buffer e tenta de novo na próxima volta. O buffer tem teto — passou dele, o MAIS ANTIGO sai
// e a perda é contada no log: um ataque de força bruta com o banco fora não pode virar
// vazamento de memória na API.
//
// **Só metadado**, a mesma regra do `[seg]`: tipo, status, e-mail (quando há sessão ou
// login), IP, método, rota e um motivo curto. Nunca corpo, token, senha ou valor de dado.

import type mysql from 'mysql2/promise';

export type TipoDeEvento =
  | 'login_ok'
  | 'login_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'csrf'
  // S2 (seguranca.yaml § sessao): o mesmo cookie de outro IP, e sessão derrubada.
  | 'sessao_ip_mudou'
  | 'sessao_derrubada';

export interface EventoDeSeguranca {
  tipo: TipoDeEvento;
  status?: number;
  email?: string | null;
  ip?: string;
  metodo?: string;
  rota?: string;
  motivo?: string;
}

export interface GravadorDeEventos {
  registra(e: EventoDeSeguranca): void;
  /** Grava o que estiver no buffer agora (desligamento e testes). */
  descarrega(): Promise<void>;
  para(): void;
}

export const SEM_GRAVACAO: GravadorDeEventos = {
  registra: () => {},
  descarrega: () => Promise.resolve(),
  para: () => {},
};

const corta = (v: string | null | undefined, max: number): string | null => (v ? v.slice(0, max) : null);

export function criaGravadorDeEventos(
  pool: Pick<mysql.Pool, 'query'>,
  opts: { cadaMs?: number; teto?: number; lote?: number; log?: (m: string) => void } = {},
): GravadorDeEventos {
  const teto = opts.teto ?? 5_000;
  const lote = opts.lote ?? 500;
  const log = opts.log ?? ((m: string) => console.warn(m));
  let buffer: (EventoDeSeguranca & { em: Date })[] = [];
  let descartados = 0;
  let gravando: Promise<void> | null = null;
  let falhando = false;

  const grava = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const agora = buffer.splice(0, lote);
    try {
      const valores = agora.map((e) => [
        e.em,
        e.tipo,
        e.status ?? null,
        corta(e.email, 254),
        corta(e.ip, 45),
        corta(e.metodo, 8),
        corta(e.rota, 255),
        corta(e.motivo, 64),
      ]);
      await pool.query(
        'INSERT INTO security_events (created_at, event_type, http_status, email, ip, method, route, reason) VALUES ?',
        [valores],
      );
      if (falhando) log(`[seg] gravação de eventos voltou (${agora.length} gravados)`);
      falhando = false;
    } catch (err) {
      // Volta para a frente da fila; o teto abaixo decide o que sobra.
      buffer = [...agora, ...buffer];
      if (!falhando) log(`[seg] FALHA ao gravar eventos de segurança: ${(err as Error).message} — guardando em memória`);
      falhando = true;
    }
    if (buffer.length > teto) {
      descartados += buffer.length - teto;
      buffer = buffer.slice(buffer.length - teto);
      log(`[seg] ${descartados} evento(s) de segurança descartado(s) desde a subida (buffer cheio, banco fora)`);
    }
  };

  const descarrega = (): Promise<void> => {
    gravando ??= grava().finally(() => {
      gravando = null;
    });
    return gravando;
  };

  const t = setInterval(() => void descarrega(), opts.cadaMs ?? 5_000);
  t.unref?.();

  return {
    registra(e) {
      buffer.push({ ...e, em: new Date() });
      if (buffer.length > teto) {
        buffer.shift();
        descartados++;
      }
    },
    descarrega,
    para: () => clearInterval(t),
  };
}
