/**
 * Conexión a Postgres (PRD §9: `pg`, sin ORM).
 *
 * En pruebas cada archivo usa su propia base desechable; en el servidor se usa
 * el pool por omisión, creado la primera vez que se pide.
 */
import pg from 'pg';
import type { Pool, PoolClient, PoolConfig } from 'pg';

/** Quien ejecuta una consulta: el pool, o un cliente tomado para una transacción. */
export type Ejecutor = Pool | PoolClient;

let pordefecto: Pool | null = null;

/** Crea un pool nuevo. Sin `url` toma `DATABASE_URL` del entorno. */
export function crearPool(url?: string): Pool {
  const cadena = url ?? process.env.DATABASE_URL;
  if (!cadena) throw new Error('Falta DATABASE_URL: no hay a qué Postgres conectarse.');
  const config: PoolConfig = {
    connectionString: cadena,
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'core-quartz',
  };
  return new pg.Pool(config);
}

/** Pool por omisión del proceso, creado perezosamente en la primera llamada. */
export function poolPorOmision(): Pool {
  pordefecto ??= crearPool();
  return pordefecto;
}

/** Cierra el pool por omisión si ya existía (no falla si nunca se creó). */
export async function cerrarPool(): Promise<void> {
  const abierto = pordefecto;
  pordefecto = null;
  if (abierto) await abierto.end();
}

/** `true` si el ejecutor es un cliente tomado del pool (y no el pool mismo). */
export function esCliente(ejecutor: Ejecutor): ejecutor is PoolClient {
  return typeof (ejecutor as PoolClient).release === 'function';
}

/** Nombre fijo del punto de guardado (nunca sale de aquí: jamás es texto ajeno). */
const PUNTO = 'cq_punto';

/** Abre un punto de guardado; `false` si el cliente no venía en transacción. */
async function abrirPunto(cliente: PoolClient): Promise<boolean> {
  try {
    await cliente.query(`SAVEPOINT ${PUNTO}`);
    return true;
  } catch (error) {
    // 25P01: no hay transacción abierta, así que no hay nada que proteger.
    if ((error as { code?: string } | null)?.code === '25P01') return false;
    throw error;
  }
}

/**
 * Corre `trabajo` dentro de una transacción: si algo falla, no queda nada (R6).
 *
 * Con el pool se abre una transacción propia. Con un cliente ajeno se respeta
 * la transacción de quien llama y se usa un **punto de guardado**: si el
 * trabajo falla, se vuelve a ese punto y el error sigue subiendo, de modo que
 * la transacción de quien llama queda utilizable en lugar de abortada (25P02).
 */
export async function enTransaccion<T>(ejecutor: Ejecutor, trabajo: (cliente: Ejecutor) => Promise<T>): Promise<T> {
  if (esCliente(ejecutor)) {
    const punto = await abrirPunto(ejecutor);
    try {
      const resultado = await trabajo(ejecutor);
      if (punto) await ejecutor.query(`RELEASE SAVEPOINT ${PUNTO}`);
      return resultado;
    } catch (error) {
      if (punto) {
        await ejecutor.query(`ROLLBACK TO SAVEPOINT ${PUNTO}`).catch(() => undefined);
        await ejecutor.query(`RELEASE SAVEPOINT ${PUNTO}`).catch(() => undefined);
      }
      throw error;
    }
  }
  const cliente = await ejecutor.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
  }
}
