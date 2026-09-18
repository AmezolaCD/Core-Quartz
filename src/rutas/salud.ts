/** `GET /api/salud`: lo único que responde sin sesión ni secreto. */
import { Router } from 'express';
import type { Dependencias } from '../app.ts';

export function rutasSalud(_deps: Dependencias): Router {
  const rutas = Router();
  rutas.get('/salud', (_peticion, respuesta) => {
    respuesta.json({ ok: true, app: 'Core Quartz' });
  });
  return rutas;
}
