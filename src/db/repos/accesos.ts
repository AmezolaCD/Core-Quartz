/**
 * `core.accesos` y `core.modulos` (PRD §6). R1 y R7 se deciden en `src/nucleo`:
 * aquí sólo se leen las filas, se pasa la decisión y se guarda el resultado.
 */
import { modulosVisibles } from '../../nucleo/accesos.ts';
import { validarAsignacion } from '../../nucleo/identidades.ts';
import type { Acceso, CodigoModulo, Modulo, NuevaAsignacion, Usuario } from '../../nucleo/tipos.ts';
import type { Ejecutor } from '../pool.ts';
import { enTransaccion } from '../pool.ts';
import { ACCIONES, ENTIDADES, anotar } from './bitacora.ts';
import { listarUsuarios, obtenerPorId } from './usuarios.ts';

/** R7: lo que devuelve guardar un acceso; los rechazos son los de `validarAsignacion`. */
export type ResultadoGuardarAcceso =
  | { ok: true; acceso: Acceso }
  | { ok: false; motivo: 'formato' | 'crm_con_usuario' | 'usuario_desconocido' | 'modulo_desconocido' }
  | { ok: false; motivo: 'duplicado'; dueno: string };

/** Las filas tal como llegan de `pg`. */
type FilaModulo = { codigo: CodigoModulo; nombre: string; activo: boolean; orden: number };
type FilaAcceso = { usuario_id: string; modulo: CodigoModulo; usuario_modulo: string | null; activo: boolean };

const CAMPOS_MODULO = 'codigo, nombre, activo, orden';
const CAMPOS_ACCESO = 'usuario_id, modulo, usuario_modulo, activo';

/** Cómo se nombra un acceso en la bitácora. */
const idBitacora = (usuarioId: string, modulo: string): string => `${usuarioId}:${modulo}`;

/** Catálogo de `core.modulos`, ordenado por `orden` (R1). */
export async function listarModulos(pool: Ejecutor): Promise<Modulo[]> {
  const { rows } = await pool.query<FilaModulo>(
    `SELECT ${CAMPOS_MODULO} FROM core.modulos ORDER BY orden, codigo`,
  );
  return rows;
}

/** Accesos de una persona (activos e inactivos). */
export async function listarAccesosDe(pool: Ejecutor, usuarioId: string): Promise<Acceso[]> {
  const { rows } = await pool.query<FilaAcceso>(
    `SELECT ${CAMPOS_ACCESO} FROM core.accesos WHERE usuario_id = $1::uuid ORDER BY modulo`,
    [usuarioId],
  );
  return rows;
}

/** Todos los accesos del portal: R7 necesita verlos para el uno a uno por módulo. */
async function listarTodosLosAccesos(pool: Ejecutor): Promise<Acceso[]> {
  const { rows } = await pool.query<FilaAcceso>(`SELECT ${CAMPOS_ACCESO} FROM core.accesos`);
  return rows;
}

/** Una fila del catálogo, o `null` si ese código no existe. */
async function obtenerModulo(pool: Ejecutor, codigo: string): Promise<Modulo | null> {
  const { rows } = await pool.query<FilaModulo>(
    `SELECT ${CAMPOS_MODULO} FROM core.modulos WHERE codigo = $1`,
    [codigo],
  );
  return rows[0] ?? null;
}

/**
 * R7: alta o cambio de acceso. Aplica `validarAsignacion` (`src/nucleo/identidades.ts`)
 * con los accesos existentes; si aprueba, guarda `usuario_modulo` ya normalizado.
 *
 * Si otra alta simultánea se queda con el mismo usuario del CDH, la violación
 * del índice único se resuelve como `duplicado` con el nombre del dueño, igual
 * que si hubiera llegado tarde. Sirve igual con el pool que con un cliente en
 * plena transacción: la escritura va tras un punto de guardado, así que perder
 * la carrera no le rompe a quien llama lo que ya llevaba hecho.
 */
export async function guardarAcceso(
  pool: Ejecutor,
  nueva: NuevaAsignacion,
  actor?: string | null,
): Promise<ResultadoGuardarAcceso> {
  const usuario = await obtenerPorId(pool, nueva.usuario_id);
  if (!usuario) return { ok: false, motivo: 'usuario_desconocido' };
  const modulo = await obtenerModulo(pool, nueva.modulo);
  if (!modulo) return { ok: false, motivo: 'modulo_desconocido' };

  // R7: la decisión (formato, duplicado, CRM sin usuario) es del núcleo.
  const existentes = await listarTodosLosAccesos(pool);
  const usuarios: Usuario[] = await listarUsuarios(pool);
  const veredicto = validarAsignacion(nueva, existentes, usuarios);
  if (!veredicto.ok) return veredicto;

  const antes = existentes.find((a) => a.usuario_id === nueva.usuario_id && a.modulo === nueva.modulo) ?? null;

  // La escritura va protegida (transacción propia con el pool, punto de
  // guardado si el cliente es de quien llama) y el uno a uno lo remata el
  // índice único parcial: entre la lectura de arriba y este INSERT otra alta
  // simultánea pudo quedarse con el mismo nombre (R7). Al volver del punto de
  // guardado, la búsqueda del dueño corre en ese mismo cliente, ya utilizable.
  try {
    const acceso = await enTransaccion(pool, async (cliente): Promise<Acceso> => {
      const { rows } = await cliente.query<FilaAcceso>(
        `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo)
         VALUES ($1::uuid, $2, $3, true)
         ON CONFLICT (usuario_id, modulo)
         DO UPDATE SET usuario_modulo = excluded.usuario_modulo, activo = true, actualizado = now()
         RETURNING ${CAMPOS_ACCESO}`,
        [nueva.usuario_id, nueva.modulo, veredicto.usuario_modulo],
      );
      const fila = rows[0];
      if (!fila) throw new Error('no se pudo guardar el acceso');

      await anotar(cliente, {
        quien: actor ?? null,
        accion: ACCIONES.accesoGuardado,
        entidad: ENTIDADES.acceso,
        entidad_id: idBitacora(nueva.usuario_id, nueva.modulo),
        antes,
        despues: fila,
      });
      return fila;
    });
    return { ok: true, acceso };
  } catch (error) {
    if (!esViolacionUnica(error)) throw error;
    // R7: quien perdió la carrera recibe el mismo «duplicado» que si hubiera llegado tarde.
    return { ok: false, motivo: 'duplicado', dueno: await duenoDe(pool, nueva.modulo, veredicto.usuario_modulo) };
  }
}

/** Violación de unicidad de Postgres (el índice parcial de R7, entre otros). */
function esViolacionUnica(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

/**
 * R7: nombre de quien tiene ligado ese usuario de módulo ahora mismo. Si ya no
 * lo tiene nadie (la carrera se deshizo), se devuelve el texto capturado.
 */
async function duenoDe(pool: Ejecutor, modulo: string, usuarioModulo: string | null): Promise<string> {
  if (usuarioModulo === null) return '';
  const { rows } = await pool.query<{ nombre: string }>(
    `SELECT u.nombre FROM core.accesos a JOIN core.usuarios u ON u.id = a.usuario_id
      WHERE a.modulo = $1 AND lower(a.usuario_modulo) = lower($2)`,
    [modulo, usuarioModulo],
  );
  return rows[0]?.nombre ?? usuarioModulo;
}

/** R7: apaga el acceso sin borrarlo. `null` si esa persona no tiene fila de ese módulo. */
export async function desactivarAcceso(
  pool: Ejecutor,
  usuarioId: string,
  modulo: CodigoModulo,
  actor?: string | null,
): Promise<Acceso | null> {
  const { rows } = await pool.query<FilaAcceso>(
    `UPDATE core.accesos SET activo = false, actualizado = now()
      WHERE usuario_id = $1::uuid AND modulo = $2
      RETURNING ${CAMPOS_ACCESO}`,
    [usuarioId, modulo],
  );
  const acceso = rows[0] ?? null;
  if (!acceso) return null;

  await anotar(pool, {
    quien: actor ?? null,
    accion: ACCIONES.accesoDesactivado,
    entidad: ENTIDADES.acceso,
    entidad_id: idBitacora(usuarioId, modulo),
    despues: acceso,
  });
  return acceso;
}

/** R1: módulos que la persona ve ahora mismo, con `modulosVisibles` (`src/nucleo/accesos.ts`). */
export async function modulosVisiblesDe(pool: Ejecutor, usuarioId: string): Promise<CodigoModulo[]> {
  const usuario = await obtenerPorId(pool, usuarioId);
  if (!usuario) return [];
  const [catalogo, accesos] = await Promise.all([listarModulos(pool), listarAccesosDe(pool, usuarioId)]);
  return modulosVisibles(usuario, catalogo, accesos);
}
