/**
 * Migrador idempotente: aplica `src/db/migraciones/*.sql` en orden alfabético,
 * cada una dentro de una transacción, y registra su nombre en `core.migraciones`.
 * Correrlo dos veces seguidas no cambia nada.
 */
import type { Pool } from 'pg';

/** Carpeta con los archivos `.sql` de la migración. */
export const DIR_MIGRACIONES: string = new URL('./migraciones/', import.meta.url).pathname;

/** Aplica las migraciones pendientes y devuelve los nombres aplicados en esta corrida. */
export function migrar(pool: Pool): Promise<string[]> {
  void pool;
  throw new Error('no implementado');
}
