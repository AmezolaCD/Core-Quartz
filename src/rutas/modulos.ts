/** R3 y R5: abrir un módulo (boleto para el CDH, enlace mágico para el CRM). */
import type { Router } from 'express';
import type { Dependencias } from '../app.ts';

/** Textos exactos de R3 y R5. */
export const MENSAJES = {
  sinAcceso: 'No tienes acceso a este módulo.',
  desconocido: 'Módulo desconocido.',
  faltaEnCrm: 'Primero dalo de alta en CRM → Ajustes → Usuarios y permisos',
} as const;

export function rutasModulos(_deps: Dependencias): Router {
  throw new Error('no implementado: rutasModulos');
}
