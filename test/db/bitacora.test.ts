/** Fase 02: `core.bitacora` sólo admite INSERT (PRD §6 e invariante 8). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCIONES, ENTIDADES, anotar, listarBitacora } from '../../src/db/repos/bitacora.ts';
import { ID, baseDePrueba, sembrarEjemplo } from '../apoyo/pg.ts';

const base = baseDePrueba();

describe('core.bitacora', () => {
  it('anota y devuelve la fila completa', async () => {
    await sembrarEjemplo(base.pool());
    const antes = Date.now();
    const fila = await anotar(base.pool(), {
      quien: ID.ana,
      accion: ACCIONES.usuarioActualizado,
      entidad: ENTIDADES.usuario,
      entidad_id: ID.beto,
      antes: { nombre: 'Beto' },
      despues: { nombre: 'Beto García' },
    });
    assert.equal(fila.quien, ID.ana);
    assert.equal(fila.accion, ACCIONES.usuarioActualizado);
    assert.equal(fila.entidad, ENTIDADES.usuario);
    assert.equal(fila.entidad_id, ID.beto);
    assert.deepEqual(fila.antes, { nombre: 'Beto' });
    assert.deepEqual(fila.despues, { nombre: 'Beto García' });
    assert.ok(Number(fila.n) > 0, 'n debe ser el consecutivo');
    assert.ok(fila.cuando instanceof Date, 'cuando lo sella el servidor');
    assert.ok(fila.cuando.getTime() >= antes - 60_000, 'cuando debería ser de ahora (now() del servidor)');
  });

  it('acepta anotaciones del sistema (quien nulo) y sin antes/después', async () => {
    const fila = await anotar(base.pool(), {
      quien: null,
      accion: ACCIONES.sesionRevocada,
      entidad: ENTIDADES.sesion,
      entidad_id: 'purga',
    });
    assert.equal(fila.quien, null);
    assert.equal(fila.antes, null);
    assert.equal(fila.despues, null);
  });

  it('listarBitacora devuelve lo más nuevo primero y filtra', async () => {
    const pool = base.pool();
    await anotar(pool, {
      quien: ID.ana,
      accion: ACCIONES.accesoGuardado,
      entidad: ENTIDADES.acceso,
      entidad_id: `${ID.carla}:cdh`,
    });
    await anotar(pool, {
      quien: ID.ana,
      accion: ACCIONES.accesoDesactivado,
      entidad: ENTIDADES.acceso,
      entidad_id: `${ID.carla}:cdh`,
    });

    const deAcceso = await listarBitacora(pool, { entidad: ENTIDADES.acceso });
    assert.equal(deAcceso.length, 2);
    assert.equal(deAcceso[0]?.accion, ACCIONES.accesoDesactivado, 'lo más nuevo va primero');
    assert.equal(deAcceso[1]?.accion, ACCIONES.accesoGuardado);

    const porId = await listarBitacora(pool, { entidad_id: `${ID.carla}:cdh` });
    assert.equal(porId.length, 2);

    const porAccion = await listarBitacora(pool, { accion: ACCIONES.accesoGuardado });
    assert.deepEqual(
      porAccion.map((a) => a.accion),
      [ACCIONES.accesoGuardado],
    );

    const delSistema = await listarBitacora(pool, { quien: ID.ana, limite: 1 });
    assert.equal(delSistema.length, 1);
  });

  it('un disparador rechaza UPDATE', async () => {
    const pool = base.pool();
    const fila = await anotar(pool, {
      quien: null,
      accion: 'prueba.update',
      entidad: ENTIDADES.usuario,
      entidad_id: ID.dani,
    });
    await assert.rejects(
      () => pool.query(`UPDATE core.bitacora SET accion = 'alterada' WHERE n = $1`, [fila.n]),
      'UPDATE sobre core.bitacora debe fallar',
    );
    const { rows } = await pool.query<{ accion: string }>(`SELECT accion FROM core.bitacora WHERE n = $1`, [fila.n]);
    assert.equal(rows[0]?.accion, 'prueba.update', 'la fila no cambió');
  });

  it('un disparador rechaza DELETE', async () => {
    const pool = base.pool();
    const fila = await anotar(pool, {
      quien: null,
      accion: 'prueba.delete',
      entidad: ENTIDADES.usuario,
      entidad_id: ID.dani,
    });
    await assert.rejects(
      () => pool.query(`DELETE FROM core.bitacora WHERE n = $1`, [fila.n]),
      'DELETE sobre core.bitacora debe fallar',
    );
    await assert.rejects(
      () => pool.query(`DELETE FROM core.bitacora`),
      'un DELETE sin WHERE tampoco debe pasar',
    );
    const { rows } = await pool.query<{ n: string }>(`SELECT n FROM core.bitacora WHERE n = $1`, [fila.n]);
    assert.equal(rows.length, 1, 'la fila sigue ahí');
  });

  it('un disparador rechaza TRUNCATE, con y sin CASCADE', async () => {
    const pool = base.pool();
    const fila = await anotar(pool, {
      quien: null,
      accion: 'prueba.truncate',
      entidad: ENTIDADES.usuario,
      entidad_id: ID.dani,
    });
    await assert.rejects(
      () => pool.query(`TRUNCATE core.bitacora`),
      'TRUNCATE sobre core.bitacora debe fallar (invariante 8)',
    );
    await assert.rejects(
      () => pool.query(`TRUNCATE core.bitacora CASCADE`),
      'TRUNCATE … CASCADE tampoco debe pasar',
    );
    const { rows } = await pool.query<{ n: string }>(`SELECT n FROM core.bitacora WHERE n = $1`, [fila.n]);
    assert.equal(rows.length, 1, 'la fila sigue ahí');
  });

  it('con un cliente en transacción se va con el ROLLBACK', async () => {
    const pool = base.pool();
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await anotar(pool, { quien: null, accion: 'prueba.rollback', entidad: ENTIDADES.usuario, entidad_id: ID.eva }, cliente);
      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
    const quedan = await listarBitacora(pool, { accion: 'prueba.rollback' });
    assert.deepEqual(quedan, []);
  });

  it('con un cliente en transacción se queda con el COMMIT', async () => {
    const pool = base.pool();
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await anotar(pool, { quien: null, accion: 'prueba.commit', entidad: ENTIDADES.usuario, entidad_id: ID.eva }, cliente);
      await cliente.query('COMMIT');
    } finally {
      cliente.release();
    }
    const quedan = await listarBitacora(pool, { accion: 'prueba.commit' });
    assert.equal(quedan.length, 1);
  });
});
