/**
 * R4: el CDH canjea el boleto contra el shell, por la red interna y con el
 * secreto compartido. Sin el secreto no se consulta ni se quema nada.
 */
import type { Router } from 'express';
import type { Dependencias } from '../app.ts';

/** Códigos HTTP de cada motivo de R4. */
export const ESTADO_POR_MOTIVO = {
  desconocido: 410,
  usado: 410,
  vencido: 410,
  modulo: 409,
  inactivo: 403,
} as const;

export function rutasSso(_deps: Dependencias): Router {
  throw new Error('no implementado: rutasSso');
}
