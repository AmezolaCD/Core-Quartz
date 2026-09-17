/**
 * Datos de ejemplo del PRD §7 (todos inventados). Cada función devuelve copias
 * nuevas para que ninguna prueba contamine a otra.
 */
import type { Acceso, CodigoModulo, Modulo, Usuario } from '../../src/nucleo/tipos.ts';

export const ID = {
  ana: '00000000-0000-4000-8000-00000000000a',
  beto: '00000000-0000-4000-8000-00000000000b',
  carla: '00000000-0000-4000-8000-00000000000c',
  dani: '00000000-0000-4000-8000-00000000000d',
  eva: '00000000-0000-4000-8000-00000000000e',
} as const;

export type Persona = keyof typeof ID;

const USUARIOS: Record<Persona, Usuario> = {
  ana: { id: ID.ana, correo: 'ana@quartz.example', nombre: 'Ana', es_admin: true, activo: true },
  beto: { id: ID.beto, correo: 'beto@quartz.example', nombre: 'Beto', es_admin: false, activo: true },
  carla: { id: ID.carla, correo: 'carla@quartz.example', nombre: 'Carla', es_admin: false, activo: true },
  dani: { id: ID.dani, correo: 'dani@quartz.example', nombre: 'Dani', es_admin: false, activo: false },
  eva: { id: ID.eva, correo: 'eva@quartz.example', nombre: 'Eva', es_admin: false, activo: true },
};

const ACCESOS: Acceso[] = [
  { usuario_id: ID.ana, modulo: 'crm', usuario_modulo: null, activo: true },
  { usuario_id: ID.ana, modulo: 'cdh', usuario_modulo: 'sistemas', activo: true },
  { usuario_id: ID.beto, modulo: 'crm', usuario_modulo: null, activo: true },
  { usuario_id: ID.carla, modulo: 'cdh', usuario_modulo: 'carla.ama', activo: true },
  { usuario_id: ID.dani, modulo: 'crm', usuario_modulo: null, activo: true },
  { usuario_id: ID.dani, modulo: 'cdh', usuario_modulo: 'dani.mtto', activo: true },
  { usuario_id: ID.eva, modulo: 'crm', usuario_modulo: null, activo: false },
  { usuario_id: ID.eva, modulo: 'cdh', usuario_modulo: 'eva.rec', activo: true },
];

/** `crm` va antes que `cdh` por `orden` (alfabéticamente sería al revés). */
const MODULOS: Modulo[] = [
  { codigo: 'crm', nombre: 'CRM', activo: true, orden: 1 },
  { codigo: 'cdh', nombre: 'Control de habitaciones', activo: true, orden: 2 },
];

export function usuario(p: Persona): Usuario {
  return structuredClone(USUARIOS[p]);
}

export function usuarios(): Usuario[] {
  return (Object.keys(USUARIOS) as Persona[]).map(usuario);
}

export function accesos(): Acceso[] {
  return structuredClone(ACCESOS);
}

export function modulos(): Modulo[] {
  return structuredClone(MODULOS);
}

/** Acceso de la persona al módulo, o `null` si no tiene fila. */
export function accesoDe(p: Persona, modulo: CodigoModulo): Acceso | null {
  const a = ACCESOS.find((x) => x.usuario_id === ID[p] && x.modulo === modulo);
  return a ? structuredClone(a) : null;
}

/** Módulo del catálogo por código, o `null` si no existe (p. ej. `'xyz'`). */
export function modulo(codigo: string): Modulo | null {
  const m = MODULOS.find((x) => x.codigo === codigo);
  return m ? structuredClone(m) : null;
}

/** Hora de ejemplo del PRD R4, en ms de época (fecha arbitraria). */
export function hora(hhmmss: string): number {
  return Date.parse(`2026-09-16T${hhmmss}Z`);
}
