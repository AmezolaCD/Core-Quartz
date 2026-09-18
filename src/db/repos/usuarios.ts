/**
 * `core.usuarios` (PRD §6). Las reglas viven en `src/nucleo`; aquí sólo se leen
 * y escriben filas y se aplican esas decisiones.
 */
import type { Usuario } from '../../nucleo/tipos.ts';
import type { Ejecutor } from '../pool.ts';

/** Alta: `id` es el de `auth.users`; el correo se guarda en minúsculas. */
export interface NuevoUsuario {
  id: string;
  correo: string;
  nombre: string;
  es_admin?: boolean;
  activo?: boolean;
}

/** Campos editables de una persona (R6: `activo` también se toca con `desactivarUsuario`). */
export interface CambiosUsuario {
  nombre?: string;
  correo?: string;
  es_admin?: boolean;
  activo?: boolean;
}

/**
 * R6: lo que deja la desactivación. `ultimo_admin` viene de `puedeQuitarAdmin`
 * (`src/nucleo/accesos.ts`) y no cambia nada.
 */
export type ResultadoDesactivacion =
  | { ok: true; usuario: Usuario; sesiones_revocadas: number; boletos_quemados: number }
  | { ok: false; motivo: 'desconocido' | 'ultimo_admin' };

/** Alta de una persona (y su anotación en la bitácora). */
export function crearUsuario(pool: Ejecutor, datos: NuevoUsuario, actor?: string | null): Promise<Usuario> {
  void pool;
  void datos;
  void actor;
  throw new Error('no implementado');
}

/** Busca por correo sin distinguir mayúsculas (R2). */
export function obtenerPorCorreo(pool: Ejecutor, correo: string): Promise<Usuario | null> {
  void pool;
  void correo;
  throw new Error('no implementado');
}

export function obtenerPorId(pool: Ejecutor, id: string): Promise<Usuario | null> {
  void pool;
  void id;
  throw new Error('no implementado');
}

/** Todas las personas, ordenadas por nombre. */
export function listarUsuarios(pool: Ejecutor): Promise<Usuario[]> {
  void pool;
  throw new Error('no implementado');
}

/** Cambia los campos indicados (y anota el antes/después). `null` si no existe. */
export function actualizarUsuario(
  pool: Ejecutor,
  id: string,
  cambios: CambiosUsuario,
  actor?: string | null,
): Promise<Usuario | null> {
  void pool;
  void id;
  void cambios;
  void actor;
  throw new Error('no implementado');
}

/**
 * R6, todo en **una sola transacción**: `activo = false`, revoca sus sesiones,
 * quema sus boletos sin canjear y escribe la bitácora. Si algo falla, nada queda.
 */
export function desactivarUsuario(pool: Ejecutor, id: string, actor?: string | null): Promise<ResultadoDesactivacion> {
  void pool;
  void id;
  void actor;
  throw new Error('no implementado');
}
