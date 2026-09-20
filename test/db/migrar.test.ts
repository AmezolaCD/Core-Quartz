/** Fase 02: migrador idempotente y forma del esquema `core` (PRD §6). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrar } from '../../src/db/migrar.ts';
import { baseDePrueba, crearBaseDesechable } from '../apoyo/pg.ts';

const DIR = join(import.meta.dirname, '../../src/db/migraciones');
const ARCHIVOS = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const TABLAS = ['migraciones', 'usuarios', 'modulos', 'accesos', 'sesiones', 'boletos', 'bitacora'];

const base = baseDePrueba();

describe('migrador', () => {
  it('existe al menos 001_core.sql en src/db/migraciones', () => {
    assert.ok(ARCHIVOS.includes('001_core.sql'), `archivos: ${ARCHIVOS.join(', ')}`);
  });

  it('la primera corrida aplica todos los archivos, en orden', () => {
    assert.deepEqual(base.aplicadas(), ARCHIVOS);
  });

  it('core.migraciones registra cada archivo una sola vez', async () => {
    const { rows } = await base.pool().query<{ nombre: string; n: string }>(
      `SELECT nombre, count(*) AS n FROM core.migraciones GROUP BY nombre ORDER BY nombre`,
    );
    assert.deepEqual(
      rows.map((r) => r.nombre),
      ARCHIVOS,
    );
    for (const r of rows) assert.equal(Number(r.n), 1, `${r.nombre} está repetida`);
  });

  it('migrar dos veces seguidas: la segunda no aplica nada', async () => {
    const antes = await base.pool().query(`SELECT * FROM core.migraciones ORDER BY nombre`);
    const segunda = await migrar(base.pool());
    assert.deepEqual(segunda, []);
    const despues = await base.pool().query(`SELECT * FROM core.migraciones ORDER BY nombre`);
    assert.deepEqual(despues.rows, antes.rows);
  });

  it('crea las tablas del PRD §6 en el esquema core', async () => {
    const { rows } = await base.pool().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'core' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const nombres = rows.map((r) => r.table_name);
    for (const t of TABLAS) assert.ok(nombres.includes(t), `falta core.${t} (hay: ${nombres.join(', ')})`);
  });

  it('siembra core.modulos con crm y cdh, en orden y con su forma de entrada', async () => {
    const { rows } = await base.pool().query<{
      codigo: string;
      entrada: string;
      activo: boolean;
      orden: number;
      url_base: string | null;
      nombre: string;
    }>(`SELECT codigo, entrada, activo, orden, url_base, nombre FROM core.modulos ORDER BY orden`);
    assert.deepEqual(
      rows.map((r) => r.codigo),
      ['crm', 'cdh'],
      'el orden de core.modulos es por `orden`, no alfabético (R1)',
    );
    const [crm, cdh] = rows;
    assert.equal(crm?.entrada, 'enlace_supabase');
    assert.equal(cdh?.entrada, 'boleto');
    for (const r of rows) {
      assert.equal(r.activo, true, `${r.codigo} debería quedar activo`);
      assert.ok((r.nombre ?? '').length > 0, `${r.codigo} sin nombre`);
    }
  });

  it('no crea ningún objeto fuera del esquema core', async () => {
    const pool = base.pool();
    const ajenos = async (etiqueta: string, sql: string) => {
      const { rows } = await pool.query<{ esquema: string; objeto: string }>(sql);
      const fuera = rows.filter((r) => r.esquema !== 'core');
      assert.deepEqual(fuera, [], `${etiqueta} fuera de core: ${JSON.stringify(fuera)}`);
    };

    await ajenos(
      'tablas, vistas, índices y secuencias',
      `SELECT n.nspname AS esquema, c.relname AS objeto
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','v','m','i','S','p')
          AND n.nspname NOT IN ('pg_catalog','information_schema')
          AND n.nspname NOT LIKE 'pg_%'`,
    );
    await ajenos(
      'funciones',
      `SELECT n.nspname AS esquema, p.proname AS objeto
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'`,
    );
    await ajenos(
      'disparadores',
      `SELECT n.nspname AS esquema, t.tgname AS objeto
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema')`,
    );
    await ajenos(
      'tipos propios',
      `SELECT n.nspname AS esquema, t.typname AS objeto
         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype IN ('e','d') AND n.nspname NOT IN ('pg_catalog','information_schema')`,
    );
  });

  it('no toca el esquema public ni crea uno llamado auth', async () => {
    const { rows: enPublic } = await base
      .pool()
      .query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    assert.deepEqual(enPublic, []);
    const { rows: esquemas } = await base.pool().query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','public')
        ORDER BY nspname`,
    );
    assert.deepEqual(
      esquemas.map((e) => e.nspname),
      ['core'],
    );
  });
});

/**
 * Fase 08: las migraciones corren **al arrancar el servidor**, así que dos
 * contenedores que arranquen a la vez las ejecutan a la vez. El migrador toma
 * un `pg_advisory_lock` para que no se pisen.
 */
describe('fase 08 · dos migradores a la vez', () => {
  it('sobre una base vacía, sólo uno aplica cada migración', async () => {
    const otra = await crearBaseDesechable();
    // `crearBaseDesechable` ya migró; se borra el registro y el esquema para
    // partir de cero sin inventar otra base.
    await otra.pool.query('DROP SCHEMA core CASCADE');
    try {
      const [uno, dos] = await Promise.all([migrar(otra.pool), migrar(otra.pool)]);
      // Cada archivo lo aplica exactamente uno de los dos, nunca los dos.
      assert.deepEqual([...uno, ...dos].sort(), ARCHIVOS);
      assert.equal(uno.length + dos.length, ARCHIVOS.length);

      const { rows } = await otra.pool.query<{ n: string }>('SELECT count(*) AS n FROM core.migraciones');
      assert.equal(Number(rows[0]?.n), ARCHIVOS.length);
    } finally {
      await otra.destruir();
    }
  });

  it('el lock se suelta: una tercera corrida no se queda esperando', async () => {
    // Si `pg_advisory_unlock` no corriera, esto colgaría hasta el tope de la prueba.
    const otra = await crearBaseDesechable();
    try {
      assert.deepEqual(await migrar(otra.pool), []);
      assert.deepEqual(await migrar(otra.pool), []);
    } finally {
      await otra.destruir();
    }
  });
});
