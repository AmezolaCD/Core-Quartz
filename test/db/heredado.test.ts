/**
 * Los seis puntos que la revisión de la fase 02 dejó anotados en
 * `docs/phases/phase-04-api-shell.md` («Heredado de la fase 02»).
 *
 * Cada uno con su prueba: son correcciones de comportamiento, no de estilo.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, PoolClient } from 'pg';
import { LOCK_TIMEOUT_MS, STATEMENT_TIMEOUT_MS, crearPool, enTransaccion, type Ejecutor } from '../../src/db/pool.ts';
import { RESULTADO_USUARIO_DESACTIVADO, canjearBoleto, emitirBoleto, quemarPendientesDe } from '../../src/db/repos/boletos.ts';
import { crearSesion, revocarSesionesDe } from '../../src/db/repos/sesiones.ts';
import { ID, baseDePrueba, hora, sembrarEjemplo, unaFila } from '../apoyo/pg.ts';

let pool: Pool;

before(async () => {
  pool = baseDePrueba().pool();
  await sembrarEjemplo(pool);
});

/** Un uuid con la forma correcta que no le pertenece a nadie. */
const NADIE = '00000000-0000-4000-8000-0000000000ff';

describe('1 · enTransaccion con un cliente sin transacción abierta', () => {
  it('es atómico: si el trabajo falla, no queda nada escrito', async () => {
    const cliente: PoolClient = await pool.connect();
    try {
      await assert.rejects(
        enTransaccion(cliente, async (c) => {
          await c.query(`UPDATE core.usuarios SET nombre = 'a medias' WHERE id = $1::uuid`, [ID.beto]);
          throw new Error('algo falló a la mitad');
        }),
        /algo falló a la mitad/,
      );
    } finally {
      cliente.release();
    }

    const fila = await unaFila<{ nombre: string }>(pool, `SELECT nombre FROM core.usuarios WHERE id = $1::uuid`, [
      ID.beto,
    ]);
    assert.equal(fila?.nombre, 'Beto', 'el cambio debió deshacerse por completo');
  });

  it('confirma cuando el trabajo termina bien', async () => {
    const cliente: PoolClient = await pool.connect();
    try {
      await enTransaccion(cliente, async (c) => {
        await c.query(`UPDATE core.usuarios SET nombre = 'Beto Ventas' WHERE id = $1::uuid`, [ID.beto]);
      });
    } finally {
      cliente.release();
    }
    const fila = await unaFila<{ nombre: string }>(pool, `SELECT nombre FROM core.usuarios WHERE id = $1::uuid`, [
      ID.beto,
    ]);
    assert.equal(fila?.nombre, 'Beto Ventas');
    await pool.query(`UPDATE core.usuarios SET nombre = 'Beto' WHERE id = $1::uuid`, [ID.beto]);
  });

  it('deja el cliente utilizable después de un fallo', async () => {
    const cliente: PoolClient = await pool.connect();
    try {
      await assert.rejects(
        enTransaccion(cliente, async () => {
          throw new Error('falla');
        }),
      );
      // Si la transacción hubiera quedado abierta y abortada, esto daría 25P02.
      const { rows } = await cliente.query<{ uno: number }>('SELECT 1 AS uno');
      assert.equal(rows[0]?.uno, 1);
    } finally {
      cliente.release();
    }
  });
});

describe('2 · tiempos límite del pool', () => {
  it('lock_timeout corta la espera por un bloqueo en vez de colgarse', async () => {
    const conLimite = crearPool(baseDePrueba().url(), { lockTimeoutMs: 300, max: 2 });
    const bloqueador: PoolClient = await pool.connect();
    try {
      await bloqueador.query('BEGIN');
      await bloqueador.query(`SELECT id FROM core.usuarios WHERE id = $1::uuid FOR UPDATE`, [ID.carla]);

      const inicio = Date.now();
      await assert.rejects(
        conLimite.query(`UPDATE core.usuarios SET nombre = 'otra' WHERE id = $1::uuid`, [ID.carla]),
        (error: unknown) => (error as { code?: string }).code === '55P03',
        'debió rendirse con lock_not_available',
      );
      // Se rindió pronto, no se quedó esperando.
      assert.ok(Date.now() - inicio < 5_000, 'tardó demasiado en rendirse');
    } finally {
      await bloqueador.query('ROLLBACK').catch(() => undefined);
      bloqueador.release();
      await conLimite.end();
    }
  });

  it('statement_timeout corta una consulta eterna', async () => {
    const conLimite = crearPool(baseDePrueba().url(), { statementTimeoutMs: 300, max: 2 });
    try {
      await assert.rejects(
        conLimite.query('SELECT pg_sleep(5)'),
        (error: unknown) => (error as { code?: string }).code === '57014',
        'debió cortarse con query_canceled',
      );
    } finally {
      await conLimite.end();
    }
  });

  it('el pool por omisión trae los dos límites puestos', async () => {
    const porOmision = crearPool(baseDePrueba().url(), { max: 2 });
    try {
      // Se lee de `pg_settings`, no de `current_setting`: éste devuelve el
      // valor ya normalizado a la unidad más grande («5s» en vez de «5000ms»),
      // mientras que `setting` viene crudo en milisegundos.
      const { rows } = await porOmision.query<{ name: string; setting: string }>(
        `SELECT name, setting FROM pg_settings WHERE name IN ('lock_timeout', 'statement_timeout')`,
      );
      const puestos = new Map(rows.map((r) => [r.name, Number(r.setting)]));
      assert.equal(puestos.get('lock_timeout'), LOCK_TIMEOUT_MS);
      assert.equal(puestos.get('statement_timeout'), STATEMENT_TIMEOUT_MS);
    } finally {
      await porOmision.end();
    }
  });
});

describe('3 · el perdedor de la carrera entre R6 y un canje', () => {
  it('recibe «inactivo», no «usado», cuando lo quemó la baja de la persona', async () => {
    const emision = await emitirBoleto(pool, { usuarioId: ID.carla, modulo: 'cdh', ahora: hora('10:00:00') });
    assert.ok(emision.ok);

    // R6 llega primero y quema sus boletos pendientes.
    const quemados = await quemarPendientesDe(pool, ID.carla);
    assert.ok(quemados >= 1);

    const canje = await canjearBoleto(pool, {
      codigo: emision.codigo,
      moduloQueCanjea: 'cdh',
      ahora: hora('10:00:05'),
    });
    assert.equal(canje.ok, false);
    assert.equal(canje.ok === false ? canje.motivo : null, 'inactivo');
  });

  it('un segundo canje normal sigue diciendo «usado»', async () => {
    const emision = await emitirBoleto(pool, { usuarioId: ID.carla, modulo: 'cdh', ahora: hora('10:00:00') });
    assert.ok(emision.ok);
    const primero = await canjearBoleto(pool, {
      codigo: emision.codigo,
      moduloQueCanjea: 'cdh',
      ahora: hora('10:00:05'),
    });
    assert.equal(primero.ok, true);

    const segundo = await canjearBoleto(pool, {
      codigo: emision.codigo,
      moduloQueCanjea: 'cdh',
      ahora: hora('10:00:06'),
    });
    assert.equal(segundo.ok === false ? segundo.motivo : null, 'usado');
  });

  it('el motivo con el que R6 quema queda guardado tal cual', async () => {
    const emision = await emitirBoleto(pool, { usuarioId: ID.ana, modulo: 'cdh', ahora: hora('10:00:00') });
    assert.ok(emision.ok);
    await quemarPendientesDe(pool, ID.ana);
    const fila = await unaFila<{ resultado: string }>(
      pool,
      `SELECT resultado FROM core.boletos WHERE usuario_id = $1::uuid ORDER BY emitido DESC LIMIT 1`,
      [ID.ana],
    );
    assert.equal(fila?.resultado, RESULTADO_USUARIO_DESACTIVADO);
  });
});

describe('4 · sesiones revocadas: no se cuentan las ya vencidas', () => {
  it('sólo cuenta las que seguían vivas', async () => {
    const ahora = hora('12:00:00');
    // Una vencida hace rato y dos vivas.
    await crearSesion(pool, ID.eva, { ahora: ahora - 86_400_000, horas: 1 });
    await crearSesion(pool, ID.eva, { ahora, horas: 12 });
    await crearSesion(pool, ID.eva, { ahora, horas: 12 });

    const revocadas = await revocarSesionesDe(pool, ID.eva, ahora);
    assert.equal(revocadas, 2, 'la vencida no debe contarse');
  });

  it('la vencida se queda sin revocar, porque no había nada que cortar', async () => {
    const ahora = hora('13:00:00');
    await crearSesion(pool, ID.beto, { ahora: ahora - 86_400_000, horas: 1 });
    await revocarSesionesDe(pool, ID.beto, ahora);
    const fila = await unaFila<{ n: string }>(
      pool,
      `SELECT count(*) AS n FROM core.sesiones
        WHERE usuario_id = $1::uuid AND revocada IS NULL AND expira < (timestamptz 'epoch' + $2::bigint * interval '1 millisecond')`,
      [ID.beto, ahora],
    );
    assert.ok(Number(fila?.n ?? 0) >= 1);
  });
});

describe('5 · emitir un boleto para un id que no existe', () => {
  it('responde «usuario_desconocido», no «usuario_inactivo»', async () => {
    const emision = await emitirBoleto(pool, { usuarioId: NADIE, modulo: 'cdh', ahora: hora('10:00:00') });
    assert.equal(emision.ok, false);
    assert.equal(emision.ok === false ? emision.motivo : null, 'usuario_desconocido');
  });

  it('una persona que sí existe pero está desactivada sigue dando «usuario_inactivo»', async () => {
    const emision = await emitirBoleto(pool, { usuarioId: ID.dani, modulo: 'cdh', ahora: hora('10:00:00') });
    assert.equal(emision.ok === false ? emision.motivo : null, 'usuario_inactivo');
  });

  it('no crea boleto en ninguno de los dos casos', async () => {
    const fila = await unaFila<{ n: string }>(
      pool,
      `SELECT count(*) AS n FROM core.boletos WHERE usuario_id IN ($1::uuid, $2::uuid)`,
      [NADIE, ID.dani],
    );
    assert.equal(Number(fila?.n ?? -1), 0);
  });
});

describe('6 · la rama del punto de guardado', () => {
  it('lo suelta al terminar bien', async () => {
    const cliente: PoolClient = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await enTransaccion(cliente, async (c) => {
        await c.query(`SELECT 1`);
      });
      // Si el punto siguiera existiendo, volver a él funcionaría; como se
      // soltó, Postgres contesta 3B001 (punto de guardado inválido).
      await assert.rejects(
        cliente.query('ROLLBACK TO SAVEPOINT cq_punto'),
        (error: unknown) => (error as { code?: string }).code === '3B001',
        'el punto de guardado debió soltarse',
      );
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      cliente.release();
    }
  });

  it('la sonda sólo se traga 25P01: cualquier otro error sigue subiendo', async () => {
    let trabajoCorrio = false;
    const roto = {
      release: () => undefined,
      query: () => Promise.reject(Object.assign(new Error('conexión caída'), { code: '08006' })),
    } as unknown as Ejecutor;

    await assert.rejects(
      enTransaccion(roto, async () => {
        trabajoCorrio = true;
      }),
      /conexión caída/,
    );
    assert.equal(trabajoCorrio, false, 'no debió correr el trabajo sin protección');
  });
});
