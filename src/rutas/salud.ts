/** `GET /api/salud`: lo único que responde sin sesión ni secreto. */
import type { Router } from 'express';
import type { Dependencias } from '../app.ts';

export function rutasSalud(_deps: Dependencias): Router {
  throw new Error('no implementado: rutasSalud');
}
