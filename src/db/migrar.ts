/**
 * Migrador idempotente: aplica `src/db/migraciones/*.sql` en orden alfabético,
 * cada una dentro de una transacción, y registra su nombre en `core.migraciones`.
 * Correrlo dos veces seguidas no cambia nada.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Carpeta con los archivos `.sql` de la migración. */
export const DIR_MIGRACIONES: string = new URL('./migraciones/', import.meta.url).pathname;

/** Ajustes que la migración lee con `current_setting` (PRD §6: `url_base` del catálogo). */
function ajustesDeEntorno(): Array<[string, string]> {
  return [
    ['cq.url_crm', process.env.CQ_URL_CRM ?? '/'],
    ['cq.url_cdh', process.env.CQ_URL_CDH ?? '/cdh'],
  ];
}

/** Crea lo mínimo para poder saber qué migraciones ya se aplicaron. */
async function prepararRegistro(pool: Pool): Promise<void> {
  await pool.query('CREATE SCHEMA IF NOT EXISTS core');
  await pool.query(
    `CREATE TABLE IF NOT EXISTS core.migraciones (
       nombre   text primary key,
       aplicada timestamptz not null default now()
     )`,
  );
}

/** Nombres de los archivos `.sql`, en orden alfabético. */
async function archivos(): Promise<string[]> {
  const nombres = await readdir(DIR_MIGRACIONES);
  return nombres.filter((n) => n.endsWith('.sql')).sort();
}

/** Aplica las migraciones pendientes y devuelve los nombres aplicados en esta corrida. */
export async function migrar(pool: Pool): Promise<string[]> {
  await prepararRegistro(pool);

  const { rows } = await pool.query<{ nombre: string }>('SELECT nombre FROM core.migraciones');
  const yaAplicadas = new Set(rows.map((r) => r.nombre));
  const pendientes = (await archivos()).filter((n) => !yaAplicadas.has(n));

  const aplicadas: string[] = [];
  for (const nombre of pendientes) {
    const sql = await readFile(join(DIR_MIGRACIONES, nombre), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      for (const [ajuste, valor] of ajustesDeEntorno()) {
        await cliente.query('SELECT set_config($1, $2, true)', [ajuste, valor]);
      }
      await cliente.query(sql);
      await cliente.query('INSERT INTO core.migraciones (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [nombre]);
      await cliente.query('COMMIT');
      aplicadas.push(nombre);
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw new Error(`falló la migración ${nombre}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    } finally {
      cliente.release();
    }
  }
  return aplicadas;
}
