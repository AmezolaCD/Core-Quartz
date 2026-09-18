/**
 * R2: la cookie `cq_sesion` resuelve a una fila viva de `core.sesiones`.
 *
 * De la cookie sólo viaja el token; en la base vive su SHA-256
 * (`src/db/repos/sesiones.ts`). El middleware no decide permisos: sólo dice
 * quién es quien pide.
 */
import type { CookieOptions, RequestHandler } from 'express';
import type { Usuario } from '../nucleo/tipos.ts';
import type { Ejecutor } from '../db/pool.ts';
import { resolverSesion } from '../db/repos/sesiones.ts';
import { obtenerPorId } from '../db/repos/usuarios.ts';

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
export function conSesion(opciones: OpcionesSesion): RequestHandler {
  return function resolver(peticion, _respuesta, siguiente) {
    const token = (peticion.cookies as Record<string, string> | undefined)?.[COOKIE_SESION];
    if (!token) return siguiente();

    void (async () => {
      try {
        const sesion = await resolverSesion(opciones.pool, token, opciones.ahora());
        if (sesion) {
          const usuario = await obtenerPorId(opciones.pool, sesion.usuario_id);
          // R6: una persona desactivada no tiene sesión, aunque su fila siga viva.
          if (usuario && usuario.activo) {
            peticion.cq = { usuario, sesionId: sesion.id, token };
          }
        }
        siguiente();
      } catch (error) {
        siguiente(error);
      }
    })();
  };
}

/** Corta con 401 si `conSesion` no encontró sesión viva. */
export function exigirSesion(): RequestHandler {
  return function exigir(peticion, respuesta, siguiente) {
    if (!peticion.cq) {
      respuesta.status(401).json({ error: 'Necesitas iniciar sesión.' });
      return;
    }
    siguiente();
  };
}

/** Opciones de la cookie: `HttpOnly`, `SameSite=Lax`, `Path` del shell, `Secure` tras HTTPS. */
export function opcionesCookie(basePath: string, seguro: boolean, expira?: number): CookieOptions {
  const opciones: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    path: basePath === '' ? '/' : basePath,
    secure: seguro,
  };
  if (expira !== undefined) opciones.expires = new Date(expira);
  return opciones;
}
