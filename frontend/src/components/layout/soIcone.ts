/**
 * Abaixo de 640px o topo fica só em ícone, como as abas: a marca vira o círculo, o selo
 * "ao vivo" vira o ponto e o "Atualizar" (`BotaoAtualizar`) o ícone. O texto continua
 * para o leitor de tela. Com texto, o topo não cabia: a página rolava 34px na horizontal
 * a 390px e 64px a 360px, e o texto do selo, que não quebra, passava por cima dos botões
 * até ~520px (medido em 07/10/2026, ACHADOS #187).
 */
export const SO_ICONE = '[@media(max-width:640px)]:sr-only';
