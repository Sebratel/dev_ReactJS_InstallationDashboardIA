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
