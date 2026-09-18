/**
 * Límite de intentos de entrada (fase 04): 10 por ventana de 15 minutos, por
 * IP **y** por correo. El 11.º responde 429.
 *
 * Vive en memoria del proceso a propósito: es una defensa contra fuerza bruta
 * ocasional, no un contador exacto entre instancias. La hora entra como
 * parámetro, igual que en el núcleo: nada aquí lee el reloj.
 */

/** Intentos permitidos por ventana (PRD §4 de la fase). */
export const MAXIMO_INTENTOS = 10;

/** Ventana del límite: 15 minutos. */
export const VENTANA_MS = 900_000;

export interface Limite {
  /** Cuenta un intento con esa llave; `false` cuando ya pasó del máximo. */
  admite(clave: string, ahora: number): boolean;
  /** Olvida la llave (una entrada correcta no debe gastar el cupo del siguiente). */
  olvidar(clave: string): void;
}

export interface OpcionesLimite {
  maximo?: number;
  ventanaMs?: number;
}

export function crearLimite(_opciones: OpcionesLimite = {}): Limite {
  throw new Error('no implementado: crearLimite');
}
