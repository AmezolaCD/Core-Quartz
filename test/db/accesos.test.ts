/**
 * Fase 02: `core.accesos` y `core.modulos`.
 * R7 (un usuario del CDH ligado a una sola persona, sin distinguir mayúsculas)
 * y R1 (qué módulos ve cada persona), decididos por `src/nucleo`.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { modulosVisibles } from '../../src/nucleo/accesos.ts';
import { ACCIONES, ENTIDADES, listarBitacora } from '../../src/db/repos/bitacora.ts';
import {
  desactivarAcceso,
  guardarAcceso,
  listarAccesosDe,
  listarModulos,
  modulosVisiblesDe,
} from '../../src/db/repos/accesos.ts';
import { ID, baseDePrueba, modulos, sembrarEjemplo } from '../apoyo/pg.ts';
import { accesos as accesosEjemplo, usuario, usuarios } from '../nucleo/datos.ts';

const base = baseDePrueba();

before(async () => {
  await sembrarEjemplo(base.pool());
});

describe('core.modulos', () => {
  it('la semilla coincide con el catálogo del PRD §7, ordenada por `orden`', async () => {
    const enBase = await listarModulos(base.pool());
    assert.deepEqual(
      enBase.map((m) => ({ codigo: m.codigo, activo: m.activo })),
      modulos().map((m) => ({ codigo: m.codigo, activo: m.activo })),
    );
    assert.deepEqual(
      enBase.map((m) => m.codigo),
      ['crm', 'cdh'],
    );
  });
});

describe('R1 · modulosVisiblesDe', () => {
  it('coincide con el núcleo para las cinco personas del PRD §7', async () => {
    for (const u of usuarios()) {
      const esperado = modulosVisibles(u, modulos(), accesosEjemplo());
      const enBase = await modulosVisiblesDe(base.pool(), u.id);
      assert.deepEqual(enBase, esperado, `${u.nombre} debería ver ${JSON.stringify(esperado)}`);
    }
  });

  it('da exactamente los resultados de la tabla de R1', async () => {
    const pool = base.pool();
    assert.deepEqual(await modulosVisiblesDe(pool, ID.ana), ['crm', 'cdh'], 'Ana: ambos, en orden');
    assert.deepEqual(await modulosVisiblesDe(pool, ID.beto), ['crm'], 'Beto: no tiene fila de cdh');
    assert.deepEqual(await modulosVisiblesDe(pool, ID.carla), ['cdh'], 'Carla: no tiene fila de crm');
    assert.deepEqual(await modulosVisiblesDe(pool, ID.dani), [], 'Dani: usuario inactivo');
    assert.deepEqual(await modulosVisiblesDe(pool, ID.eva), ['cdh'], 'Eva: su acceso crm está inactivo');
  });

  it('quien no existe no ve nada', async () => {
    assert.deepEqual(await modulosVisiblesDe(base.pool(), randomUUID()), []);
  });

  it('con el módulo apagado nadie lo ve, aunque tenga acceso', async () => {
    const pool = base.pool();
    await pool.query(`UPDATE core.modulos SET activo = false WHERE codigo = 'cdh'`);
    try {
      assert.deepEqual(await modulosVisiblesDe(pool, ID.ana), ['crm']);
      assert.deepEqual(await modulosVisiblesDe(pool, ID.carla), []);
    } finally {
      await pool.query(`UPDATE core.modulos SET activo = true WHERE codigo = 'cdh'`);
    }
  });

  it('un acceso cdh sin usuario_modulo no cuenta (R1)', async () => {
    const pool = base.pool();
    const id = randomUUID();
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo) VALUES ($1, 'nora@quartz.example', 'Nora', false, true)`,
      [id],
    );
    await pool.query(`INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', NULL, true)`, [
      id,
    ]);
    assert.deepEqual(await modulosVisiblesDe(pool, id), []);
  });
});

describe('R7 · guardarAcceso', () => {
  it('normaliza el usuario del CDH a minúsculas', async () => {
    const res = await guardarAcceso(
      base.pool(),
      { usuario_id: ID.beto, modulo: 'cdh', usuario_modulo: 'Beto.Ventas' },
      ID.ana,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.acceso.usuario_modulo, 'beto.ventas');
    assert.equal(res.acceso.activo, true);

    const fila = await base
      .pool()
      .query<{ usuario_modulo: string }>(
        `SELECT usuario_modulo FROM core.accesos WHERE usuario_id = $1 AND modulo = 'cdh'`,
        [ID.beto],
      );
    assert.equal(fila.rows[0]?.usuario_modulo, 'beto.ventas', 'en la base queda ya normalizado');
  });

  it('deja constancia en la bitácora', async () => {
    const filas = await listarBitacora(base.pool(), { entidad: ENTIDADES.acceso, accion: ACCIONES.accesoGuardado });
    assert.ok(filas.length > 0, 'guardarAcceso debe anotarse');
    assert.equal(filas[0]?.quien, ID.ana);
  });

  it('la misma persona puede volver a guardar su propio usuario', async () => {
    const res = await guardarAcceso(
      base.pool(),
      { usuario_id: ID.carla, modulo: 'cdh', usuario_modulo: 'Carla.Ama' },
      ID.ana,
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.acceso.usuario_modulo, 'carla.ama');
    const { rows } = await base
      .pool()
      .query(`SELECT 1 FROM core.accesos WHERE usuario_id = $1 AND modulo = 'cdh'`, [ID.carla]);
    assert.equal(rows.length, 1, 'sigue siendo una sola fila (PK usuario_id, modulo)');
  });

  it('rechaza ligar el usuario de otra persona, sin distinguir mayúsculas', async () => {
    const res = await guardarAcceso(
      base.pool(),
      { usuario_id: ID.eva, modulo: 'cdh', usuario_modulo: 'CARLA.AMA' },
      ID.ana,
    );
    assert.deepEqual(res, { ok: false, motivo: 'duplicado', dueno: usuario('carla').nombre });
    const { rows } = await base
      .pool()
      .query<{ usuario_modulo: string }>(
        `SELECT usuario_modulo FROM core.accesos WHERE usuario_id = $1 AND modulo = 'cdh'`,
        [ID.eva],
      );
    assert.equal(rows[0]?.usuario_modulo, 'eva.rec', 'el acceso de Eva no se tocó');
  });

  it('rechaza un usuario del CDH con formato inválido', async () => {
    const res = await guardarAcceso(
      base.pool(),
      { usuario_id: ID.beto, modulo: 'cdh', usuario_modulo: 'juan perez' },
      ID.ana,
    );
    assert.deepEqual(res, { ok: false, motivo: 'formato' });
  });

  it('el CRM no lleva usuario_modulo', async () => {
    const malo = await guardarAcceso(
      base.pool(),
      { usuario_id: ID.carla, modulo: 'crm', usuario_modulo: 'carla' },
      ID.ana,
    );
    assert.deepEqual(malo, { ok: false, motivo: 'crm_con_usuario' });

    const bueno = await guardarAcceso(base.pool(), { usuario_id: ID.carla, modulo: 'crm', usuario_modulo: null }, ID.ana);
    assert.equal(bueno.ok, true);
    if (!bueno.ok) return;
    assert.equal(bueno.acceso.usuario_modulo, null);
    assert.deepEqual(await modulosVisiblesDe(base.pool(), ID.carla), ['crm', 'cdh']);
  });

  it('rechaza a una persona o a un módulo que no existen', async () => {
    const sinPersona = await guardarAcceso(base.pool(), { usuario_id: randomUUID(), modulo: 'crm', usuario_modulo: null });
    assert.deepEqual(sinPersona, { ok: false, motivo: 'usuario_desconocido' });
  });
});

describe('índice único parcial de core.accesos', () => {
  it('dos personas distintas no pueden tener Carla.Ama y carla.ama en cdh', async () => {
    const pool = base.pool();
    const dueno = randomUUID();
    const otro = randomUUID();
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
       VALUES ($1, 'olga@quartz.example', 'Olga', false, true), ($2, 'pepe@quartz.example', 'Pepe', false, true)`,
      [dueno, otro],
    );
    await pool.query(`INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', $2, true)`, [
      dueno,
      'Olga.Ama',
    ]);
    await assert.rejects(
      () =>
        pool.query(`INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', $2, true)`, [
          otro,
          'olga.ama',
        ]),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, '23505', 'debe ser violación de unicidad');
        return true;
      },
    );
  });

  it('varias filas de crm con usuario_modulo NULL conviven', async () => {
    const pool = base.pool();
    const uno = randomUUID();
    const dos = randomUUID();
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
       VALUES ($1, 'rita@quartz.example', 'Rita', false, true), ($2, 'saul@quartz.example', 'Saúl', false, true)`,
      [uno, dos],
    );
    await pool.query(
      `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo)
       VALUES ($1, 'crm', NULL, true), ($2, 'crm', NULL, true)`,
      [uno, dos],
    );
    const { rows } = await pool.query(`SELECT 1 FROM core.accesos WHERE modulo = 'crm' AND usuario_modulo IS NULL`);
    assert.ok(rows.length >= 2, 'el índice único es parcial: no aplica a los NULL');
  });

  it('un acceso inactivo también ocupa el nombre (R7)', async () => {
    const pool = base.pool();
    const id = randomUUID();
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo) VALUES ($1, 'tona@quartz.example', 'Toña', false, true)`,
      [id],
    );
    await pool.query(
      `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', 'tona.ama', false)`,
      [id],
    );
    const res = await guardarAcceso(pool, { usuario_id: ID.beto, modulo: 'cdh', usuario_modulo: 'Tona.Ama' }, ID.ana);
    assert.deepEqual(res, { ok: false, motivo: 'duplicado', dueno: 'Toña' });
  });
});

describe('listarAccesosDe y desactivarAcceso', () => {
  it('listarAccesosDe trae los accesos de esa persona, activos e inactivos', async () => {
    const accesos = await listarAccesosDe(base.pool(), ID.eva);
    assert.deepEqual(
      accesos.map((a) => ({ modulo: a.modulo, activo: a.activo, usuario_modulo: a.usuario_modulo })).sort((a, b) => a.modulo.localeCompare(b.modulo)),
      [
        { modulo: 'cdh', activo: true, usuario_modulo: 'eva.rec' },
        { modulo: 'crm', activo: false, usuario_modulo: null },
      ],
    );
  });

  it('desactivarAcceso apaga la fila y el módulo desaparece de R1', async () => {
    const pool = base.pool();
    const apagado = await desactivarAcceso(pool, ID.eva, 'cdh', ID.ana);
    assert.equal(apagado?.activo, false);
    assert.equal(apagado?.usuario_modulo, 'eva.rec', 'no se borra el usuario del CDH, sólo se apaga');
    assert.deepEqual(await modulosVisiblesDe(pool, ID.eva), []);
    const filas = await listarBitacora(pool, { entidad: ENTIDADES.acceso, accion: ACCIONES.accesoDesactivado });
    assert.ok(filas.length > 0, 'la baja del acceso se anota');
  });

  it('desactivar un acceso que no existe devuelve null', async () => {
    assert.equal(await desactivarAcceso(base.pool(), randomUUID(), 'crm', ID.ana), null);
  });
});
