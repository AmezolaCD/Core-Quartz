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

/**
 * Cuánto se espera un bloqueo antes de rendirse.
 *
 * El canje de un boleto y la baja de esa misma persona se pelean la misma
 * fila: el canje pide la llave ajena de `core.usuarios` mientras la baja la
 * tiene tomada con `FOR UPDATE`. Sin límite, esa espera se queda colgada
 * detrás de una petición HTTP y el navegador se queda mirando. Con límite,
 * Postgres devuelve `55P03` y la petición falla rápido, que es mejor.
 */
export const LOCK_TIMEOUT_MS = 5_000;

/** Techo de cualquier consulta: nada del portal debería tardar tanto. */
export const STATEMENT_TIMEOUT_MS = 15_000;

export interface OpcionesPool {
  /** Espera máxima por un bloqueo (`0` lo desactiva). */
  lockTimeoutMs?: number;
  /** Duración máxima de una consulta (`0` lo desactiva). */
  statementTimeoutMs?: number;
  max?: number;
}

/**
 * Los tiempos límite van como parámetros de arranque de la conexión y no con
 * un `SET` después de conectarse: así valen desde la primera consulta de cada
 * conexión nueva del pool, sin carrera posible.
 */
function opcionesDeArranque(opciones: OpcionesPool): string {
  const lock = opciones.lockTimeoutMs ?? LOCK_TIMEOUT_MS;
  const statement = opciones.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS;
  return `-c lock_timeout=${Math.trunc(lock)} -c statement_timeout=${Math.trunc(statement)}`;
}

/** Crea un pool nuevo. Sin `url` toma `DATABASE_URL` del entorno. */
export function crearPool(url?: string, opciones: OpcionesPool = {}): Pool {
  const cadena = url ?? process.env.DATABASE_URL;
  if (!cadena) throw new Error('Falta DATABASE_URL: no hay a qué Postgres conectarse.');
  const config: PoolConfig = {
    connectionString: cadena,
    max: opciones.max ?? 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'core-quartz',
    options: opcionesDeArranque(opciones),
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

/**
 * Abre un punto de guardado; `false` si el cliente no venía en transacción.
 *
 * Sólo se traga `25P01` («no hay transacción abierta»), que es la respuesta
 * que estamos sondeando. Cualquier otro error —la conexión se cayó, por
 * ejemplo— sigue subiendo: tragárselo convertiría una falla real en una
 * ejecución sin protección.
 */
async function abrirPunto(cliente: PoolClient): Promise<boolean> {
  try {
    await cliente.query(`SAVEPOINT ${PUNTO}`);
    return true;
  } catch (error) {
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

    if (punto) {
      // Venía en transacción ajena: se respeta y se protege con el punto de
      // guardado, para que un fallo aquí no aborte lo que llevaba quien llama.
      try {
        const resultado = await trabajo(ejecutor);
        await ejecutor.query(`RELEASE SAVEPOINT ${PUNTO}`);
        return resultado;
      } catch (error) {
        await ejecutor.query(`ROLLBACK TO SAVEPOINT ${PUNTO}`).catch(() => undefined);
        await ejecutor.query(`RELEASE SAVEPOINT ${PUNTO}`).catch(() => undefined);
        throw error;
      }
    }

    // El cliente no traía transacción: se abre una propia sobre él. Antes esta
    // rama corría suelta, así que un `desactivarUsuario` a medias dejaba media
    // R6 aplicada —la persona inactiva pero sus sesiones vivas—, que es justo
    // lo que la transacción existe para impedir. El cliente no se suelta: es
    // de quien llama.
    await ejecutor.query('BEGIN');
    try {
      const resultado = await trabajo(ejecutor);
      await ejecutor.query('COMMIT');
      return resultado;
    } catch (error) {
      await ejecutor.query('ROLLBACK').catch(() => undefined);
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
