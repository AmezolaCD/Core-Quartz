/**
 * `core.bitacora` (PRD §6 e invariante 8): sólo inserción, reforzada por disparador.
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

/** Cuántas filas devuelve `listarBitacora` cuando no se pide un límite. */
const LIMITE_POR_OMISION = 200;

type FilaBitacora = {
  n: string;
  cuando: Date;
  quien: string | null;
  accion: string;
  entidad: string;
  entidad_id: string;
  antes: unknown;
  despues: unknown;
};

/** `jsonb` en texto (o `null`): lo que no se pasó no se guarda. */
function comoJson(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  return JSON.stringify(valor) ?? null;
}

/**
 * Inserta una anotación. `cliente` permite escribirla dentro de una transacción
 * en curso (R6: la desactivación y su bitácora van juntas o no van).
 */
export async function anotar(pool: Ejecutor, entrada: NuevaAnotacion, cliente?: Ejecutor): Promise<Anotacion> {
  const quien = cliente ?? pool;
  const { rows } = await quien.query<FilaBitacora>(
    `INSERT INTO core.bitacora (quien, accion, entidad, entidad_id, antes, despues)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING n::text AS n, cuando, quien, accion, entidad, entidad_id, antes, despues`,
    [
      entrada.quien,
      entrada.accion,
      entrada.entidad,
      entrada.entidad_id,
      comoJson(entrada.antes),
      comoJson(entrada.despues),
    ],
  );
  const fila = rows[0];
  if (!fila) throw new Error('no se pudo anotar en la bitácora');
  return fila;
}

/** Lee la bitácora, de lo más nuevo a lo más viejo. */
export async function listarBitacora(pool: Ejecutor, filtro: FiltroBitacora = {}): Promise<Anotacion[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  const agregar = (columna: 'quien' | 'entidad' | 'entidad_id' | 'accion', valor: string | undefined): void => {
    if (valor === undefined) return;
    valores.push(valor);
    // El nombre de la columna sale de esta lista cerrada; el valor siempre va parametrizado.
    condiciones.push(`${columna} = $${valores.length}${columna === 'quien' ? '::uuid' : ''}`);
  };
  agregar('quien', filtro.quien);
  agregar('entidad', filtro.entidad);
  agregar('entidad_id', filtro.entidad_id);
  agregar('accion', filtro.accion);

  const limite = Math.max(1, Math.trunc(filtro.limite ?? LIMITE_POR_OMISION));
  valores.push(limite);

  const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await pool.query<FilaBitacora>(
    `SELECT n::text AS n, cuando, quien, accion, entidad, entidad_id, antes, despues
       FROM core.bitacora ${donde}
      ORDER BY n DESC
      LIMIT $${valores.length}`,
    valores,
  );
  return rows;
}
