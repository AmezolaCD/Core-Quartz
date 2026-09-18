/**
 * `core.bitacora` (PRD §6 y invariante 8): sólo inserción, reforzada por disparador.
 * Ningún repositorio actualiza ni borra filas de la bitácora.
 */
import type { Ejecutor } from '../pool.ts';

/** Acciones que escriben los repositorios (texto exacto de `bitacora.accion`). */
export const ACCIONES = {
  usuarioCreado: 'usuario.creado',
  usuarioActualizado: 'usuario.actualizado',
  usuarioDesactivado: 'usuario.desactivado',
  accesoGuardado: 'acceso.guardado',
  accesoDesactivado: 'acceso.desactivado',
  sesionCreada: 'sesion.creada',
  sesionRevocada: 'sesion.revocada',
  boletoEmitido: 'boleto.emitido',
  boletoCanjeado: 'boleto.canjeado',
} as const;

/** Entidades que nombra `bitacora.entidad`. */
export const ENTIDADES = {
  usuario: 'usuario',
  acceso: 'acceso',
  sesion: 'sesion',
  boleto: 'boleto',
} as const;

/** Lo que se guarda en una anotación (todo lo que el PRD §6 pide). */
export interface NuevaAnotacion {
  /** Quién lo hizo; `null` cuando lo hace el sistema. */
  quien: string | null;
  accion: string;
  entidad: string;
  entidad_id: string;
  antes?: unknown;
  despues?: unknown;
}

/** Una fila de `core.bitacora` tal como se lee. */
export interface Anotacion {
  n: string;
  cuando: Date;
  quien: string | null;
  accion: string;
  entidad: string;
  entidad_id: string;
  antes: unknown;
  despues: unknown;
}

/** Filtros de lectura; sin filtros devuelve todo, de lo más nuevo a lo más viejo. */
export interface FiltroBitacora {
  quien?: string;
  entidad?: string;
  entidad_id?: string;
  accion?: string;
  limite?: number;
}

/**
 * Inserta una anotación. `cliente` permite escribirla dentro de una transacción
 * en curso (R6: la desactivación y su bitácora van juntas o no van).
 */
export function anotar(pool: Ejecutor, entrada: NuevaAnotacion, cliente?: Ejecutor): Promise<Anotacion> {
  void pool;
  void entrada;
  void cliente;
  throw new Error('no implementado');
}

/** Lee la bitácora, de lo más nuevo a lo más viejo. */
export function listarBitacora(pool: Ejecutor, filtro?: FiltroBitacora): Promise<Anotacion[]> {
  void pool;
  void filtro;
  throw new Error('no implementado');
}
