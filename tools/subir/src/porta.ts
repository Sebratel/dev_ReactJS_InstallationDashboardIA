// A porta já está ocupada?
//
// **Por que isto existe, e é uma armadilha que custou duas vezes.** O `npm start` subia
// a API como processo filho e depois esperava `/api/saude` responder. Quando a porta já
// estava tomada — por uma API de outra sessão, ou por uma que eu mesmo tinha deixado no
// ar —, a sequência era esta:
//
//   1. o filho morre na hora, com `EADDRINUSE`;
//   2. `esperaSaude` pergunta `/api/saude` e recebe **200 do outro processo**;
//   3. o `npm start` conclui "subiu", e **aquece o servidor alheio**;
//   4. o relatório sai bonito, sobre um servidor que pode estar rodando código velho.
//
// É o passo 4 que é caro: a `CONTINUACAO` §7 já registrava "um servidor com código velho
// respondendo como se fosse o novo", e a saúde respondendo não distingue os dois. A única
// pergunta que distingue é feita **antes** de subir: esta porta está livre para mim?
//
// Perguntar tentando ligar, e não olhando lista de processo: é a mesma pergunta que o
// sistema operacional vai responder ao filho, feita com a mesma resposta.

import net from 'node:net';

/**
 * `true` se ligar nesta porta daria `EADDRINUSE`.
 *
 * Liga e desliga um servidor descartável. Erro que **não** seja `EADDRINUSE` (permissão,
 * porta fora de faixa) é devolvido a quem chamou: engolir tudo como "livre" mandaria o
 * filho tropeçar no mesmo problema, com uma mensagem pior.
 */
/**
 * Derrubar quem está na porta, ou parar e explicar?
 *
 * **A porta ocupada por uma API nossa é o caso comum, e é ruído.** É um `npm start` da
 * sessão anterior, um `npm run api` esquecido numa aba, uma janela que fechou sem matar
 * o filho. Pedir uma flag para isso é cobrar da pessoa um passo que a máquina sabe dar:
 * ela quer subir a tela, e o que está no caminho é uma cópia velha dela mesma.
 *
 * **Mas derrubar QUALQUER coisa não.** Na 3000 e na 3100 pode estar outro serviço —
 * um túnel, um container, um `serve` de outro projeto. Matar em silêncio o processo de
 * outra pessoa (ou o seu, de outro trabalho) é uma perda que o `npm start` não tem
 * direito de causar, e que ninguém liga à causa depois.
 *
 * A linha entre os dois já era calculada aqui e só servia para escolher o texto do
 * aviso: **quem responde `/api/saude` é uma API desta plataforma.** É evidência, não
 * palpite — um Postgres, um túnel ou um Vite não respondem aquela rota.
 *
 * Por isso o padrão é: **nossa, derruba; estranha, para e explica.** `--mata` força o
 * segundo caso, e `--sem-mata` desliga o primeiro (útil quando a API no ar é
 * justamente a que você quer manter).
 */
export interface Decisao {
  derruba: boolean;
  motivo: string;
}

export function decideDerrubada(o: {
  mata: boolean;
  semMata: boolean;
  nossa: boolean;
  achouPid: boolean;
}): Decisao {
  // `--sem-mata` vence tudo: é a pessoa dizendo "eu sei o que está ali". Uma flag de
  // recusa que uma flag de força consegue anular não protege ninguém.
  if (o.semMata) return { derruba: false, motivo: 'você pediu para não derrubar (--sem-mata)' };
  // Sem PID não há o que matar, e seguir em frente seria subir para morrer no listen.
  if (!o.achouPid) return { derruba: false, motivo: 'não descobri qual processo está na porta' };
  if (o.mata) return { derruba: true, motivo: 'você pediu (--mata)' };
  if (o.nossa) return { derruba: true, motivo: 'é uma API desta plataforma (responde /api/saude)' };
  return {
    derruba: false,
    motivo: 'quem está na porta não responde /api/saude, então pode não ser nosso',
  };
}

export function portaOcupada(porta: number, host?: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(true);
      else reject(err);
    });
    s.once('listening', () => s.close(() => resolve(false)));
    // Sem host = todas as interfaces, que é onde a API liga. Escutar só em `127.0.0.1`
    // acharia livre uma porta que `::` já tomou.
    if (host === undefined) s.listen(porta);
    else s.listen(porta, host);
  });
}
