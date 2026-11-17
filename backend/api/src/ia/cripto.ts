// Criptografia dos segredos em repouso (a chave do provedor de IA).
// AES-256-GCM autenticado — adulteração é detectada na leitura.
// Formato do blob: iv:tag:texto, tudo em base64 (mesmo padrão do Dashboard Comercial).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const cachePorDiretorio = new Map<string, string>();

/**
 * Obtém o segredo de cifra: prioriza `segredoExplicito` ou `SECRET_KEY` do ambiente;
 * na falta deles, lê ou gera `.secret` dentro de `dirRuntime` (volume persistente da API).
 */
export function segredoDeCifra(dirRuntime?: string, segredoExplicito?: string): string {
  if (segredoExplicito && segredoExplicito.trim() !== '') return segredoExplicito.trim();
  if (process.env.SECRET_KEY && process.env.SECRET_KEY.trim() !== '') {
    return process.env.SECRET_KEY.trim();
  }
  const dir = dirRuntime || process.cwd();
  const emCache = cachePorDiretorio.get(dir);
  if (emCache) return emCache;

  const arquivo = path.join(dir, '.secret');
  try {
    if (fs.existsSync(arquivo)) {
      const lido = fs.readFileSync(arquivo, 'utf8').trim();
      if (lido) {
        cachePorDiretorio.set(dir, lido);
        return lido;
      }
    }
    const gerado = randomBytes(48).toString('base64');
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, `${gerado}\n`, { encoding: 'utf8', mode: 0o600 });
    cachePorDiretorio.set(dir, gerado);
    return gerado;
  } catch (err) {
    throw new Error(
      'Não foi possível preparar a chave de cifra dos segredos. ' +
        `Defina SECRET_KEY no ambiente. Detalhe: ${(err as Error).message}`,
    );
  }
}

function derivaChave(segredo: string): Buffer {
  return createHash('sha256').update(segredo).digest();
}

export function cifrar(texto: string, segredo?: string, dirRuntime?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivaChave(segredoDeCifra(dirRuntime, segredo)), iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decifrar(blob: string, segredo?: string, dirRuntime?: string): string {
  const partes = String(blob || '').split(':');
  if (partes.length !== 3 || !partes[0] || !partes[1] || !partes[2]) {
    throw new Error('Segredo gravado em formato inválido.');
  }
  const [ivB, tagB, encB] = partes;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derivaChave(segredoDeCifra(dirRuntime, segredo)),
    Buffer.from(ivB, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}
