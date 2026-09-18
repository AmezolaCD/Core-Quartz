/**
 * R2: la cookie `cq_sesion` resuelve a una fila viva de `core.sesiones`.
 *
 * De la cookie sólo viaja el token; en la base vive su SHA-256
 * (`src/db/repos/sesiones.ts`). El middleware no decide permisos: sólo dice
 * quién es quien pide.
 */
import type { RequestHandler } from 'express';
import type { Usuario } from '../nucleo/tipos.ts';
import type { Ejecutor } from '../db/pool.ts';

/** Nombre de la cookie de sesión del portal (decisión #34: separada por `Path`). */
export const COOKIE_SESION = 'cq_sesion';

/** Lo que el middleware cuelga de la petición. */
export interface SesionDePeticion {
  usuario: Usuario;
  sesionId: string;
  token: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Sesión viva, si la cookie resolvió a una. */
    cq?: SesionDePeticion;
  }
}

export interface OpcionesSesion {
  pool: Ejecutor;
  ahora: () => number;
}

/** Resuelve la cookie y cuelga `req.cq` si la sesión está viva. Nunca corta. */
export function conSesion(_opciones: OpcionesSesion): RequestHandler {
  throw new Error('no implementado: conSesion');
}

/** Corta con 401 si `conSesion` no encontró sesión viva. */
export function exigirSesion(): RequestHandler {
  throw new Error('no implementado: exigirSesion');
}

/** Opciones de la cookie: `HttpOnly`, `SameSite=Lax`, `Path` del shell, `Secure` tras HTTPS. */
export function opcionesCookie(_basePath: string, _seguro: boolean, _expira?: number): Record<string, unknown> {
  throw new Error('no implementado: opcionesCookie');
}
