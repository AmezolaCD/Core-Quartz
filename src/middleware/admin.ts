/**
 * Puerta de administración: sólo `core.usuarios.es_admin`.
 *
 * R1 y decisión #18: ser administradora del portal **no** da acceso a módulos.
 * Esta puerta es sólo para administrar gente y leer la bitácora.
 */
import type { RequestHandler } from 'express';

/** Corta con 403 si quien pide no es administradora del portal. */
export function exigirAdmin(): RequestHandler {
  return function exigir(peticion, respuesta, siguiente) {
    if (!peticion.cq) {
      respuesta.status(401).json({ error: 'Necesitas iniciar sesión.' });
      return;
    }
    if (!peticion.cq.usuario.es_admin) {
      respuesta.status(403).json({ error: 'Esto es sólo para administradores.' });
      return;
    }
    siguiente();
  };
}
