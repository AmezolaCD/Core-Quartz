/**
 * Puerta de administración: sólo `core.usuarios.es_admin`.
 *
 * R1 y decisión #18: ser administradora del portal **no** da acceso a módulos.
 * Esta puerta es sólo para administrar gente y leer la bitácora.
 */
import type { RequestHandler } from 'express';

/** Corta con 403 si quien pide no es administradora del portal. */
export function exigirAdmin(): RequestHandler {
  throw new Error('no implementado: exigirAdmin');
}
