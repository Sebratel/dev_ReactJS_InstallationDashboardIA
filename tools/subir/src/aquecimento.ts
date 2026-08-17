// Esperar o aquecimento que a **própria API** faz no arranque.
//
// **Por que esperar, em vez de medir logo.** Desde 17/08/2026 a API se aquece sozinha
// (`apps/api/src/aquecedor.ts`). Se `npm start` disparasse o seu aquecimento por cima,
// os dois calculariam as mesmas páginas ao mesmo tempo, num processo só, disputando
// CPU para produzir o mesmo resultado. Esperando, o `aquece()` que vem depois vira uma
// **medição do estado quente** — e a coluna "a frio" passa a mostrar o que a tela vai
// sentir, não o custo que o servidor já absorveu.
//
// **A armadilha que este arquivo existe para não repetir.** A primeira versão desta
// espera desistia assim que `/api/saude` falhasse uma vez:
//
//     const s = await saude();
//     if (s === null) return;   // ← errado
//
// Falhar é *esperado* aqui. Enquanto a API calcula uma página cara, o laço de eventos
// dela fica bloqueado por dezenas de segundos, e um socket de keep-alive reaproveitado
// pode ser derrubado nesse intervalo. Medido em 17/08/2026: `npm start` saiu da espera
// com o aquecedor na **2ª de 14** páginas e passou a medir por cima dele, exatamente o
// que a espera existia para evitar. Uma falha isolada não é "a API sumiu" — várias
// seguidas é.

export interface EstadoDeSaude {
  aquecimento?: { ativo: boolean; pronto: boolean };
}

/** O que aconteceu na espera. Sai no relatório: espera muda o número que vem depois. */
export type Veredito =
  /** A API não está se aquecendo sozinha (`--sem-aquecer`). Nada a esperar. */
  | 'ausente'
  /** O aquecimento da API terminou. */
  | 'pronto'
  /** A saúde parou de responder de vez. */
  | 'sem-resposta'
  /** Passou do limite com o aquecimento ainda em curso. */
  | 'estourou';

export interface OpcoesDeEspera {
  saude: () => Promise<EstadoDeSaude | null>;
  dorme?: (ms: number) => Promise<void>;
  agora?: () => number;
  /** Teto total. Padrão: 15 min — mais que os ~3 min medidos, com folga larga. */
  limiteMs?: number;
  /**
   * Quantas falhas **seguidas** contam como "a API sumiu".
   *
   * Não é 1 de propósito: ver o comentário do topo. Com 1 s entre tentativas, 15
   * seguidas são ~15 s sem nenhuma resposta, o que já não é evento transitório.
   */
  falhasSeguidas?: number;
  intervaloMs?: number;
  anuncia?: (linha: string) => void;
}

export async function esperaAquecimento(opts: OpcoesDeEspera): Promise<Veredito> {
  const dorme = opts.dorme ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = opts.agora ?? ((): number => Date.now());
  const limiteMs = opts.limiteMs ?? 900_000;
  const maxFalhas = opts.falhasSeguidas ?? 15;
  const intervaloMs = opts.intervaloMs ?? 1_000;
  const anuncia = opts.anuncia ?? ((l: string): void => console.log(l));

  const primeira = await opts.saude();
  // `ativo: false` volta na hora: é `--sem-aquecer`, ou uma API antiga que não tem o
  // campo. Esperar aqui seria segurar `npm start` por 15 min por nada.
  if (primeira?.aquecimento?.ativo !== true) return 'ausente';
  if (primeira.aquecimento.pronto) return 'pronto';

  anuncia('\nA API está se aquecendo sozinha. Esperando ela terminar…');

  const ate = agora() + limiteMs;
  let falhas = 0;
  while (agora() < ate) {
    await dorme(intervaloMs);
    const s = await opts.saude();
    if (s === null) {
      if (++falhas >= maxFalhas) return 'sem-resposta';
      continue;
    }
    falhas = 0;
    // Aquecedor desligado no meio do caminho não existe hoje, mas se existisse,
    // continuar esperando por um `pronto` que nunca vem seria travar por 15 min.
    if (s.aquecimento?.ativo !== true) return 'ausente';
    if (s.aquecimento.pronto) return 'pronto';
  }
  return 'estourou';
}
