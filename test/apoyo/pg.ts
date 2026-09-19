/**
 * Apoyo de las pruebas de base de datos: una base **desechable por archivo**.
 *
 * Nunca toca otra base: crea `cq_test_<azar>`, le corre las migraciones y la
 * borra al terminar. La dirección sale de `DATABASE_URL_TEST` (por omisión el
 * Postgres 16 de `docker-compose.test.yml`), así que las mismas pruebas sirven
 * contra el contenedor o contra un Postgres local.
 */
import { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Pool } from 'pg';
import { crearPool } from '../../src/db/pool.ts';
import { migrar } from '../../src/db/migrar.ts';
import { ID, accesos, modulos, usuarios } from '../nucleo/datos.ts';

/** Postgres de pruebas (nunca Supabase, PRD §9). */
export const URL_PRUEBAS: string = process.env.DATABASE_URL_TEST ?? 'postgres://postgres@127.0.0.1:54329/postgres';

/** Sólo se crean y se borran bases con esta forma. */
const NOMBRE_VALIDO = /^cq_test_[0-9a-f]{12}$/;

export interface BaseDesechable {
  nombre: string;
  url: string;
  pool: Pool;
  /** Nombres de migración aplicados al crearla. */
  aplicadas: string[];
  destruir: () => Promise<void>;
}

/** Conexión de administración a la base de arranque (sólo para CREATE/DROP DATABASE). */
async function conAdmin<T>(fn: (cliente: pg.Client) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: URL_PRUEBAS });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

/** Dirección de `URL_PRUEBAS` apuntando a otra base. */
export function urlDeBase(nombre: string): string {
  const u = new URL(URL_PRUEBAS);
  u.pathname = `/${nombre}`;
  return u.toString();
}

/** Crea la base, le corre las migraciones y devuelve su pool. */
export async function crearBaseDesechable(): Promise<BaseDesechable> {
  const nombre = `cq_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  if (!NOMBRE_VALIDO.test(nombre)) throw new Error(`nombre de base inesperado: ${nombre}`);
  await conAdmin((c) => c.query(`CREATE DATABASE "${nombre}"`));

  const url = urlDeBase(nombre);
  let pool: Pool | null = null;
  try {
    pool = crearPool(url);
    const aplicadas = await migrar(pool);
    const suyo = pool;
    return {
      nombre,
      url,
      pool: suyo,
      aplicadas,
      destruir: () => destruir(nombre, suyo),
    };
  } catch (error) {
    await destruir(nombre, pool);
    throw error;
  }
}

/**
 * Espera a que los backends de `nombre` desaparezcan de verdad del servidor.
 *
 * `pool.end()` resuelve cuando el cliente ha mandado su `Terminate` y cerrado
 * el socket, **no** cuando Postgres ya enterró el proceso del otro lado. En esa
 * rendija de milisegundos el backend sigue listado en `pg_stat_activity`, y el
 * `DROP DATABASE … WITH (FORCE)` de abajo le manda `SIGTERM`: el backend
 * alcanza a escribir un «terminating connection due to administrator command»
 * en un socket que el cliente todavía está leyendo, `pg` lo emite como `error`
 * sobre un cliente que ya nadie escucha, y `node --test` lo cobra como
 * «asynchronous activity after the test ended» en el `before` que abrió la
 * conexión. Fallaba una de cada diez corridas de `test:api`, siempre con todas
 * las pruebas en verde y el archivo en rojo.
 *
 * Así que primero se espera, y sólo se fuerza si alguien no se va.
 */
async function esperarSinConexiones(cliente: pg.Client, nombre: string, msTope = 5_000): Promise<number> {
  const limite = Date.now() + msTope;
  for (;;) {
    const { rows } = await cliente.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [nombre],
    );
    const quedan = Number(rows[0]?.n ?? 0);
    if (quedan === 0 || Date.now() >= limite) return quedan;
    await new Promise((sigue) => setTimeout(sigue, 10));
  }
}

async function destruir(nombre: string, pool: Pool | null): Promise<void> {
  if (!NOMBRE_VALIDO.test(nombre)) throw new Error(`no se borra una base ajena: ${nombre}`);
  if (pool) await pool.end().catch(() => undefined);
  await conAdmin(async (c) => {
    await esperarSinConexiones(c, nombre);
    // `FORCE` se queda como red: si algo no se fue en cinco segundos, la base
    // desechable se borra igual. Lo que ya no pasa es forzar por costumbre.
    await c.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
  });
}

/**
 * Base desechable de este archivo de prueba, lista antes de que corra nada.
 *
 * La base se crea aquí mismo, con `await` de módulo, y NO en un gancho
 * `before`: bajo `node --test` la prueba raíz ya empezó cuando se evalúa el
 * archivo, así que todos los `before` de nivel raíz arrancan a la vez y sin
 * esperarse entre sí. Con un gancho, la semilla del archivo corría mientras
 * la base aún no existía. Cada archivo de prueba es su propio proceso, de
 * modo que sigue siendo una base desechable por archivo.
 */
const baseDelArchivo: BaseDesechable = await crearBaseDesechable();

let base: BaseDesechable | null = baseDelArchivo;

/**
 * Cosas que deben cerrarse **antes** de destruir la base: servidores HTTP que
 * la estén usando, pools propios, lo que sea.
 *
 * Hace falta porque `destruir` hace `DROP DATABASE … WITH (FORCE)`, que mata
 * las conexiones vivas: quien siguiera consultando recibiría «terminating
 * connection due to administrator command». Y no basta con que cada archivo
 * registre su propio `after`, porque los ganchos corren en orden de registro y
 * éste, al importarse primero, siempre iría antes.
 */
const cierresPrevios: Array<() => Promise<void>> = [];

/** Registra un cierre que corre antes de destruir la base del archivo. */
export function alCerrar(cierre: () => Promise<void>): void {
  cierresPrevios.push(cierre);
}

// El borrado se registra junto a la creación, no dentro de `baseDePrueba()`:
// un archivo que sólo importe `hora`, `ID` o `modulos` también crea su base al
// importar este módulo, y sin este gancho la dejaría colgada en el servidor.
after(async () => {
  for (const cierre of cierresPrevios.splice(0)) await cierre().catch(() => undefined);
  if (base) await base.destruir();
  base = null;
});

const lista = (): BaseDesechable => {
  if (!base) throw new Error('la base desechable no está lista');
  return base;
};

/**
 * Accesos perezosos a la base desechable del archivo de prueba (ya creada, y
 * con su borrado registrado al importar este módulo).
 */
export function baseDePrueba(): { pool: () => Pool; url: () => string; nombre: () => string; aplicadas: () => string[] } {
  return {
    pool: () => lista().pool,
    url: () => lista().url,
    nombre: () => lista().nombre,
    aplicadas: () => lista().aplicadas,
  };
}

// ---- Semilla de ejemplo (PRD §7) ----

export { ID };

/**
 * Siembra las cinco personas del PRD §7 y sus accesos con SQL directo, para que
 * las pruebas de lectura no dependan de los repositorios de escritura.
 */
export async function sembrarEjemplo(pool: Pool): Promise<void> {
  for (const u of usuarios()) {
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo) VALUES ($1, $2, $3, $4, $5)`,
      [u.id, u.correo, u.nombre, u.es_admin, u.activo],
    );
  }
  for (const a of accesos()) {
    await pool.query(
      `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, $2, $3, $4)`,
      [a.usuario_id, a.modulo, a.usuario_modulo, a.activo],
    );
  }
}

/** Los módulos de ejemplo del núcleo, para comparar contra la semilla de `core.modulos`. */
export { modulos };

// ---- Utilidades de inspección ----

/** Nombres de las columnas de una tabla del esquema `core`, en orden. */
export async function columnasDe(pool: Pool, tabla: string): Promise<string[]> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'core' AND table_name = $1
      ORDER BY ordinal_position`,
    [tabla],
  );
  return rows.map((r) => r.column_name);
}

/**
 * Columnas de `core.<tabla>` donde aparece `valor` (comparando el texto de cada
 * columna). Sirve para probar que un token en claro nunca se guardó.
 */
export async function columnasQueContienen(pool: Pool, tabla: string, valor: string): Promise<string[]> {
  const columnas = await columnasDe(pool, tabla);
  const encontradas: string[] = [];
  for (const columna of columnas) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM core."${tabla}" WHERE strpos(coalesce("${columna}"::text, ''), $1) > 0`,
      [valor],
    );
    if (Number(rows[0]?.n ?? 0) > 0) encontradas.push(columna);
  }
  return encontradas;
}

/** Una sola fila (o `null`) de una consulta. */
export async function unaFila<T extends pg.QueryResultRow>(
  pool: Pool,
  sql: string,
  valores: unknown[] = [],
): Promise<T | null> {
  const { rows } = await pool.query<T>(sql, valores);
  return rows[0] ?? null;
}

/** Hora de ejemplo del PRD R4, reutilizada de las pruebas del núcleo. */
export { hora } from '../nucleo/datos.ts';
