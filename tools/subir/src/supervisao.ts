// **Voltou a ter chamador em 28/09/2026 (ACHADOS #161):** o `tools/subir` religa a API
// com esta regra quando ela morre por falha (`0xC0000409`, 7 vezes entre 18 e 28/09).
// Entre 19 e 28/09 ficou sem chamador — o daemon que ela ressuscitava saiu do `npm start`.
// O texto abaixo é de 16/09 e fala do daemon; a regra (espera crescente, vida mínima
// que zera a conta, desistir em voz alta) é a mesma para a API.
//
// Quando ressuscitar o daemon de refresh, e quando parar de tentar.
//
// **Por que isto existe (16/09/2026).** Até aqui, a morte do daemon de refresh rendia
// uma linha de `console.error` e mais nada. A API seguia servindo, a tela seguia
// abrindo, e o dado parava no tempo sem que nada mudasse de cor. Foi observado ao vivo:
// a stack fora do ar, último tick às 10:25, e três horas e quarenta e três minutos
// depois os três grupos apareciam vencidos sem que nada tivesse avisado ninguém.
//
// A assimetria era o defeito. API morta derruba o daemon — `tools/subir/src/index.ts`
// sempre fez isso. Daemon morto não derrubava nem avisava nada, e é o daemon que
// mantém o dado vivo.
//
// **O repositório já tinha previsto.** O docstring de `tools/refresh/src/index.ts`
// recusa o modelo de daemon 24/7 com exatamente este argumento — *"o Windows não tem
// PM2/systemd hoje; viraria um processo que ninguém reinicia sozinho se cair no meio de
// um ciclo"*. O daemon veio assim mesmo, e em 16/09 virou o padrão do `npm start`. Isto
// aqui é o "alguém que reinicia" que faltava. **Não é um supervisor de verdade**: morre
// junto com o `npm start` e não sobrevive a um reboot da máquina — para isso ainda
// falta uma entrada no Agendador de Tarefas do Windows.
//
// **Por que há um teto, e não um laço infinito.** Respawn sem limite esconde defeito
// determinístico. Se o daemon morre por `.env` quebrado ou `refresh.yaml` inválido, ele
// vai morrer igual nas próximas mil vezes, e o que era uma falha legível vira um
// terminal que rola sozinho para sempre — o operador perde justamente a mensagem que
// diria o que consertar. O teto transforma isso numa recusa alta e única.
//
// **E por que a vida mínima.** Sem ela, um daemon que trabalhou doze horas e caiu uma
// vez gastaria uma das cinco tentativas para sempre; depois de cinco quedas isoladas em
// semanas diferentes, o supervisor desistiria de um processo que nunca deu problema. A
// conta mede *falha em se sustentar*, não *falha alguma vez*.

/** Esperas entre ressurreições, em ordem. O comprimento é também o teto de tentativas. */
export const ESPERAS_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000, 300_000];

/**
 * Abaixo disto de pé, a morte conta como tentativa; acima, zera a conta. Um minuto
 * porque o daemon nasce fazendo um tick imediato: se ele não chega nem a terminar o
 * primeiro ciclo, não se sustentou.
 */
export const VIDA_MINIMA_MS = 60_000;

export interface DecisaoDeRessurreicao {
  /** `false` = teto atingido; quem chama tem de dizer isso em voz alta e parar. */
  ressuscita: boolean;
  /** Quanto esperar antes de subir de novo. Zero quando `ressuscita` é `false`. */
  esperaMs: number;
  /** O contador DEPOIS desta morte — quem chama guarda e devolve na próxima. */
  mortesSeguidas: number;
}

/**
 * Pura: recebe quanto o processo viveu e quantas mortes rápidas houve antes, devolve se
 * ressuscita e quanto esperar.
 *
 * `esperas` e `vidaMinimaMs` são parâmetros e não constantes lidas de fora para que o
 * teste não precise esperar cinco minutos de relógio real.
 */
export function decideRessurreicao(
  viveuMs: number,
  mortesSeguidasAntes: number,
  esperas: readonly number[] = ESPERAS_MS,
  vidaMinimaMs: number = VIDA_MINIMA_MS,
): DecisaoDeRessurreicao {
  const base = viveuMs >= vidaMinimaMs ? 0 : mortesSeguidasAntes;
  const mortesSeguidas = base + 1;
  if (mortesSeguidas > esperas.length) {
    return { ressuscita: false, esperaMs: 0, mortesSeguidas };
  }
  return { ressuscita: true, esperaMs: esperas[mortesSeguidas - 1]!, mortesSeguidas };
}
