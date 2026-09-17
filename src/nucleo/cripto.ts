/** Único archivo del núcleo que usa `node:crypto`. */
import { createHash } from 'node:crypto';

/** SHA-256 en hexadecimal (minúsculas) del texto UTF-8. */
export function hashToken(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}
