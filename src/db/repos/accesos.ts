/**
 * `core.accesos` y `core.modulos` (PRD §6). R1 y R7 se deciden en `src/nucleo`:
 * aquí sólo se leen las filas, se pasa la decisión y se guarda el resultado.
 */
import type { Acceso, CodigoModulo, Modulo, NuevaAsignacion } from '../../nucleo/tipos.ts';
import type { Ejecutor } from '../pool.ts';

/** R7: lo que devuelve guardar un acceso; los rechazos son los de `validarAsignacion`. */
export type ResultadoGuardarAcceso =
  | { ok: true; acceso: Acceso }
  | { ok: false; motivo: 'formato' | 'crm_con_usuario' | 'usuario_desconocido' | 'modulo_desconocido' }
  | { ok: false; motivo: 'duplicado'; dueno: string };

/** Catálogo de `core.modulos`, ordenado por `orden` (R1). */
export function listarModulos(pool: Ejecutor): Promise<Modulo[]> {
  void pool;
  throw new Error('no implementado');
}

/** Accesos de una persona (activos e inactivos). */
export function listarAccesosDe(pool: Ejecutor, usuarioId: string): Promise<Acceso[]> {
  void pool;
  void usuarioId;
  throw new Error('no implementado');
}

/**
 * R7: alta o cambio de acceso. Aplica `validarAsignacion` (`src/nucleo/identidades.ts`)
 * con los accesos existentes; si aprueba, guarda `usuario_modulo` ya normalizado.
 */
export function guardarAcceso(
  pool: Ejecutor,
  nueva: NuevaAsignacion,
  actor?: string | null,
): Promise<ResultadoGuardarAcceso> {
  void pool;
  void nueva;
  void actor;
  throw new Error('no implementado');
}

/** R7: apaga el acceso sin borrarlo. `null` si esa persona no tiene fila de ese módulo. */
export function desactivarAcceso(
  pool: Ejecutor,
  usuarioId: string,
  modulo: CodigoModulo,
  actor?: string | null,
): Promise<Acceso | null> {
  void pool;
  void usuarioId;
  void modulo;
  void actor;
  throw new Error('no implementado');
}

/** R1: módulos que la persona ve ahora mismo, con `modulosVisibles` (`src/nucleo/accesos.ts`). */
export function modulosVisiblesDe(pool: Ejecutor, usuarioId: string): Promise<CodigoModulo[]> {
  void pool;
  void usuarioId;
  throw new Error('no implementado');
}
