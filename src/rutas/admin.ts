/** R6 y R7: alta, edición, baja, accesos y bitácora. Todo queda anotado. */
import type { Router } from 'express';
import type { Dependencias } from '../app.ts';

/** Textos exactos de R6 y R7. */
export const MENSAJES = {
  ultimoAdmin: 'Debe quedar al menos un administrador activo.',
  formatoUsuarioCdh: 'Sólo minúsculas, números, punto, guion y guion bajo.',
  noExisteEnCdh: 'No existe en el CDH o está inactivo.',
  faltaEnCrm: 'Primero dalo de alta en CRM → Ajustes → Usuarios y permisos',
  desconocido: 'No encontramos a esa persona.',
  moduloDesconocido: 'Módulo desconocido.',
} as const;

/** R7: el duplicado nombra a quien ya tiene ligado ese usuario del CDH. */
export function mensajeDuplicado(dueno: string): string {
  return `Ese usuario del CDH ya está ligado a ${dueno}.`;
}

/** Cómo se nombra en `core.bitacora` una revocación del CDH que quedó pendiente (R6). */
export const ACCION_REVOCACION_PENDIENTE = 'revocacion_pendiente';

export function rutasAdmin(_deps: Dependencias): Router {
  throw new Error('no implementado: rutasAdmin');
}
