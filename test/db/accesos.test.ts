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
import type { ResultadoGuardarAcceso } from '../../src/db/repos/accesos.ts';
import {
  desactivarAcceso,
  guardarAcceso,
  listarAccesosDe,
  listarModulos,
  modulosVisiblesDe,
} from '../../src/db/repos/accesos.ts';
import type { Ejecutor } from '../../src/db/pool.ts';
import { crearPool } from '../../src/db/pool.ts';
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

  it('el índice único no mira `activo`: un acceso inactivo y otro activo con el mismo nombre chocan', async () => {
    const pool = base.pool();
    const inactiva = randomUUID();
    const activa = randomUUID();
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
       VALUES ($1, 'ulises@quartz.example', 'Ulises', false, true), ($2, 'vera@quartz.example', 'Vera', false, true)`,
      [inactiva, activa],
    );
    await pool.query(
      `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', $2, false)`,
      [inactiva, 'Ulises.Ama'],
    );
    await assert.rejects(
      () =>
        pool.query(`INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', $2, true)`, [
          activa,
          'ulises.ama',
        ]),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, '23505', 'el índice parcial ignora `activo` (R7)');
        return true;
      },
    );
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

// ---- R7 bajo carrera: el uno a uno también debe aguantar dos altas simultáneas ----

describe('R7 · guardarAcceso con dos altas simultáneas', () => {
  /** Lo que devolvió un intento: su respuesta, o el error crudo que dejó escapar. */
  type Intento = { tipo: 'valor'; valor: ResultadoGuardarAcceso } | { tipo: 'error'; codigo: string };

  interface Persona {
    id: string;
    nombre: string;
  }

  async function intentar(ejecutor: Ejecutor, usuarioId: string, texto: string): Promise<Intento> {
    try {
      const valor = await guardarAcceso(
        ejecutor,
        { usuario_id: usuarioId, modulo: 'cdh', usuario_modulo: texto },
        ID.ana,
      );
      return { tipo: 'valor', valor };
    } catch (error) {
      return { tipo: 'error', codigo: String((error as { code?: string }).code ?? error) };
    }
  }

  /**
   * Da de alta a dos personas y les asigna el mismo usuario del CDH desde dos
   * pools distintos, en el mismo instante.
   */
  async function carrera(
    etiqueta: string,
    textoUno: string,
    textoDos: string,
  ): Promise<{ uno: Persona; dos: Persona; ia: Intento; ib: Intento }> {
    const pool = base.pool();
    const uno: Persona = { id: randomUUID(), nombre: `${etiqueta} Uno` };
    const dos: Persona = { id: randomUUID(), nombre: `${etiqueta} Dos` };
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
       VALUES ($1, $2, $3, false, true), ($4, $5, $6, false, true)`,
      [uno.id, `${etiqueta}.uno@quartz.example`, uno.nombre, dos.id, `${etiqueta}.dos@quartz.example`, dos.nombre],
    );

    // Un disparador que tarda al insertar abre la ventana de la carrera siempre:
    // las dos llamadas alcanzan a leer los accesos existentes antes de que
    // cualquiera de las dos escriba la suya.
    await pool.query(
      `CREATE FUNCTION core.zz_acceso_lento() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER zz_acceso_lento BEFORE INSERT ON core.accesos
       FOR EACH ROW EXECUTE FUNCTION core.zz_acceso_lento()`,
    );

    const poolA = crearPool(base.url());
    const poolB = crearPool(base.url());
    try {
      // Las conexiones se abren antes para que los dos INSERT compitan de verdad.
      await Promise.all([poolA.query('SELECT 1'), poolB.query('SELECT 1')]);
      const [ia, ib] = await Promise.all([intentar(poolA, uno.id, textoUno), intentar(poolB, dos.id, textoDos)]);
      return { uno, dos, ia, ib };
    } finally {
      await Promise.all([poolA.end().catch(() => undefined), poolB.end().catch(() => undefined)]);
      await pool.query(`DROP TRIGGER IF EXISTS zz_acceso_lento ON core.accesos`);
      await pool.query(`DROP FUNCTION IF EXISTS core.zz_acceso_lento()`);
    }
  }

  /** El perdedor debe ver `duplicado` con el nombre del ganador, nunca un error de Postgres. */
  function revisar(uno: Persona, dos: Persona, ia: Intento, ib: Intento): void {
    const errores = [ia, ib].flatMap((i) => (i.tipo === 'error' ? [i.codigo] : []));
    assert.deepEqual(errores, [], `guardarAcceso dejó escapar un error crudo de Postgres: ${errores.join(', ')}`);

    const va = ia.tipo === 'valor' ? ia.valor : null;
    const vb = ib.tipo === 'valor' ? ib.valor : null;
    const buenos = [va, vb].filter((v) => v?.ok === true);
    assert.equal(buenos.length, 1, `sólo una persona puede quedarse con el usuario: ${JSON.stringify([va, vb])}`);

    const ganador = va?.ok === true ? uno : dos;
    const perdedor = va?.ok === true ? vb : va;
    assert.deepEqual(
      perdedor,
      { ok: false, motivo: 'duplicado', dueno: ganador.nombre },
      'el que pierde la carrera recibe «duplicado» con el nombre del dueño (R7)',
    );
  }

  it('el mismo usuario del CDH para dos personas a la vez: una gana, la otra ve duplicado', async () => {
    const { uno, dos, ia, ib } = await carrera('comp', 'compartido', 'compartido');
    revisar(uno, dos, ia, ib);
  });

  it('la carrera con sólo un cambio de mayúsculas también se resuelve con duplicado', async () => {
    const { uno, dos, ia, ib } = await carrera('mayus', 'compartido.dos', 'Compartido.Dos');
    revisar(uno, dos, ia, ib);
  });

  it('perder la carrera dentro de la transacción de quien llama no la rompe', async () => {
    const pool = base.pool();
    const rival: Persona = { id: randomUUID(), nombre: 'Rival' };
    const llamador: Persona = { id: randomUUID(), nombre: 'Llamador' };
    const previo = randomUUID();
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
       VALUES ($1, 'rival@quartz.example', $2, false, true), ($3, 'llamador@quartz.example', $4, false, true)`,
      [rival.id, rival.nombre, llamador.id, llamador.nombre],
    );

    // El INSERT del rival tarda: así el rival llega primero al índice único y
    // quien llama pierde la carrera **dentro** de su propia transacción.
    await pool.query(
      `CREATE FUNCTION core.zz_acceso_lento_tx() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER zz_acceso_lento_tx BEFORE INSERT ON core.accesos
       FOR EACH ROW EXECUTE FUNCTION core.zz_acceso_lento_tx()`,
    );

    const poolRival = crearPool(base.url());
    const cliente = await pool.connect();
    try {
      await poolRival.query('SELECT 1');
      await cliente.query('BEGIN');
      // Trabajo previo de quien llama, ya dentro de su transacción.
      await cliente.query(
        `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
         VALUES ($1, 'previo@quartz.example', 'Previo', false, true)`,
        [previo],
      );

      const delRival = intentar(poolRival, rival.id, 'compartido.tx');
      // Medio segundo de ventaja para el rival: cuando quien llama inserte, el
      // nombre ya está tomado (pero todavía sin confirmar cuando lo lee).
      await new Promise((listo) => setTimeout(listo, 50));
      const propio = await intentar(cliente, llamador.id, 'Compartido.TX');
      const rivalListo = await delRival;

      assert.deepEqual(
        rivalListo.tipo === 'valor' && rivalListo.valor.ok,
        true,
        `el rival debía quedarse con el usuario: ${JSON.stringify(rivalListo)}`,
      );
      assert.deepEqual(
        propio.tipo === 'valor' ? propio.valor : propio,
        { ok: false, motivo: 'duplicado', dueno: rival.nombre },
        'quien llama dentro de una transacción también recibe «duplicado» (R7)',
      );

      // La transacción de quien llama sigue viva: puede seguir trabajando…
      const { rows } = await cliente.query<{ cuantos: string }>(
        `SELECT count(*)::text AS cuantos FROM core.usuarios WHERE id = $1::uuid`,
        [previo],
      );
      assert.equal(rows[0]?.cuantos, '1', 'la transacción de quien llama debe seguir usable');
      // …y confirmar lo que llevaba hecho.
      await cliente.query('COMMIT');
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      cliente.release();
      await poolRival.end().catch(() => undefined);
      await pool.query(`DROP TRIGGER IF EXISTS zz_acceso_lento_tx ON core.accesos`);
      await pool.query(`DROP FUNCTION IF EXISTS core.zz_acceso_lento_tx()`);
    }

    const { rows } = await pool.query(`SELECT 1 FROM core.usuarios WHERE id = $1::uuid`, [previo]);
    assert.equal(rows.length, 1, 'lo que quien llama había hecho antes en su transacción se pudo confirmar');
  });
});
