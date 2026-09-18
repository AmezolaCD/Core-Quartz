/**
 * Conexión a Postgres (PRD §9: `pg`, sin ORM).
 *
 * En pruebas cada archivo usa su propia base desechable; en el servidor se usa
 * el pool por omisión, creado la primera vez que se pide.
 */
import type { Pool, PoolClient } from 'pg';

/** Quien ejecuta una consulta: el pool, o un cliente tomado para una transacción. */
export type Ejecutor = Pool | PoolClient;

/** Crea un pool nuevo. Sin `url` toma `DATABASE_URL` del entorno. */
export function crearPool(url?: string): Pool {
  void url;
  throw new Error('no implementado');
}

/** Pool por omisión del proceso, creado perezosamente en la primera llamada. */
export function poolPorOmision(): Pool {
  throw new Error('no implementado');
}

/** Cierra el pool por omisión si ya existía (no falla si nunca se creó). */
export function cerrarPool(): Promise<void> {
  throw new Error('no implementado');
}
