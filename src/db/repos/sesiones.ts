/**
 * `core.sesiones` (PRD §6 y R2). Del token sólo se guarda su SHA-256
 * (`hashToken` de `src/nucleo/cripto.ts`); el valor en claro nunca toca la base.
 */
import type { Instante } from '../../nucleo/tipos.ts';
import type { Ejecutor } from '../pool.ts';

/** R2: 12 horas. */
export const HORAS_SESION = 12;

/** Datos de la sesión nueva; `ahora` lo pone quien llama (el núcleo nunca lee el reloj). */
export interface DatosSesion {
  ip?: string | null;
  agente?: string | null;
  ahora: Instante;
  /** Vigencia en horas; por omisión `HORAS_SESION`. */
  horas?: number;
}

/** Fila de `core.sesiones` con las horas en milisegundos de época. */
export interface Sesion {
  id: string;
  usuario_id: string;
  ip: string | null;
  agente: string | null;
  creada: Instante;
  expira: Instante;
  revocada: Instante | null;
}

/** Crea la sesión y devuelve el token en claro **una sola vez** (sólo se guarda su hash). */
export function crearSesion(
  pool: Ejecutor,
  usuarioId: string,
  datos: DatosSesion,
): Promise<{ token: string; expira: Instante }> {
  void pool;
  void usuarioId;
  void datos;
  throw new Error('no implementado');
}

/** Sesión viva del token (no revocada y `ahora <= expira`), o `null`. */
export function resolverSesion(pool: Ejecutor, token: string, ahora: Instante): Promise<Sesion | null> {
  void pool;
  void token;
  void ahora;
  throw new Error('no implementado');
}

/** Revoca la sesión de ese token; `false` si no existía o ya estaba revocada. */
export function revocarSesion(pool: Ejecutor, token: string, ahora: Instante): Promise<boolean> {
  void pool;
  void token;
  void ahora;
  throw new Error('no implementado');
}

/** R6: revoca todas las sesiones vivas de una persona y devuelve cuántas. */
export function revocarSesionesDe(
  pool: Ejecutor,
  usuarioId: string,
  ahora: Instante,
  cliente?: Ejecutor,
): Promise<number> {
  void pool;
  void usuarioId;
  void ahora;
  void cliente;
  throw new Error('no implementado');
}

/** Borra las sesiones ya vencidas (mantenimiento) y devuelve cuántas. */
export function purgarSesionesVencidas(pool: Ejecutor, ahora: Instante): Promise<number> {
  void pool;
  void ahora;
  throw new Error('no implementado');
}
