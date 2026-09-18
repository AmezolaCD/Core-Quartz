/** R2: entrar, salir y saber quién soy. */
import type { Router } from 'express';
import type { Dependencias } from '../app.ts';

/** Textos exactos de R2 (el PRD los fija; las pruebas los comparan). */
export const MENSAJES = {
  credenciales: 'Correo o contraseña incorrectos',
  sinAcceso: 'Tu cuenta aún no tiene acceso a Core Quartz. Pídeselo a Sistemas.',
  desactivada: 'Tu cuenta está desactivada.',
  demasiados: 'Demasiados intentos. Espera unos minutos.',
} as const;

export function rutasAuth(_deps: Dependencias): Router {
  throw new Error('no implementado: rutasAuth');
}
