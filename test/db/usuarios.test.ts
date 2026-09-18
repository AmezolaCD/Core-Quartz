/**
 * Fase 02: `core.usuarios` y `core.sesiones`.
 * R2 (correo en minúsculas, sesión de 12 h), R6 (desactivar en una sola transacción)
 * y la forma del PRD §6: de los tokens sólo se guarda el hash.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hashToken } from '../../src/nucleo/cripto.ts';
import { ACCIONES, ENTIDADES, listarBitacora } from '../../src/db/repos/bitacora.ts';
import {
  actualizarUsuario,
  crearUsuario,
  desactivarUsuario,
  listarUsuarios,
  obtenerPorCorreo,
  obtenerPorId,
} from '../../src/db/repos/usuarios.ts';
import {
  HORAS_SESION,
  crearSesion,
  purgarSesionesVencidas,
  resolverSesion,
  revocarSesion,
  revocarSesionesDe,
} from '../../src/db/repos/sesiones.ts';
import { RESULTADO_OK, RESULTADO_USUARIO_DESACTIVADO, canjearBoleto } from '../../src/db/repos/boletos.ts';
import { crearPool } from '../../src/db/pool.ts';
import { ID, baseDePrueba, columnasQueContienen, hora, sembrarEjemplo, unaFila } from '../apoyo/pg.ts';

const base = baseDePrueba();
const HORA = 3_600_000;

before(async () => {
  await sembrarEjemplo(base.pool());
});

// ---- Utilidades de siembra (SQL directo: las pruebas no dependen de los repos de escritura) ----

async function insertarSesion(
  pool: Pool,
  datos: { usuarioId: string; token: string; creada: number; expira: number; revocada?: number | null },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO core.sesiones (id, usuario_id, token_hash, ip, agente, creada, expira, revocada)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000),
             to_timestamp($7::double precision / 1000),
             CASE WHEN $8::double precision IS NULL THEN NULL ELSE to_timestamp($8::double precision / 1000) END)`,
    [id, datos.usuarioId, hashToken(datos.token), '10.0.0.9', 'pruebas', datos.creada, datos.expira, datos.revocada ?? null],
  );
  return id;
}

async function insertarBoleto(
  pool: Pool,
  datos: {
    usuarioId: string;
    modulo: string;
    usuarioModulo: string | null;
    codigo: string;
    emitido: number;
    expira: number;
    canjeado?: number | null;
    resultado?: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO core.boletos (id, codigo_hash, usuario_id, modulo, usuario_modulo, emitido, expira, canjeado, resultado, ip)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000), to_timestamp($7::double precision / 1000),
             CASE WHEN $8::double precision IS NULL THEN NULL ELSE to_timestamp($8::double precision / 1000) END, $9, $10)`,
    [
      id,
      hashToken(datos.codigo),
      datos.usuarioId,
      datos.modulo,
      datos.usuarioModulo,
      datos.emitido,
      datos.expira,
      datos.canjeado ?? null,
      datos.resultado ?? null,
      '10.0.0.9',
    ],
  );
  return id;
}

// ---- Altas y lecturas ----

describe('core.usuarios', () => {
  const fabi = { id: randomUUID(), correo: 'FABI@Quartz.example', nombre: 'Fabi' };

  it('crearUsuario guarda el correo en minúsculas y con los valores por omisión', async () => {
    const creado = await crearUsuario(base.pool(), fabi, ID.ana);
    assert.equal(creado.id, fabi.id);
    assert.equal(creado.correo, 'fabi@quartz.example', 'el correo se guarda en minúsculas (R2)');
    assert.equal(creado.nombre, 'Fabi');
    assert.equal(creado.es_admin, false);
    assert.equal(creado.activo, true);
  });

  it('crearUsuario deja constancia en la bitácora', async () => {
    const filas = await listarBitacora(base.pool(), { entidad: ENTIDADES.usuario, entidad_id: fabi.id });
    const alta = filas.find((f) => f.accion === ACCIONES.usuarioCreado);
    assert.ok(alta, `no se anotó ${ACCIONES.usuarioCreado}: ${JSON.stringify(filas)}`);
    assert.equal(alta?.quien, ID.ana);
  });

  it('obtenerPorCorreo no distingue mayúsculas (R2)', async () => {
    const porCorreo = await obtenerPorCorreo(base.pool(), 'ANA@Quartz.example');
    assert.equal(porCorreo?.id, ID.ana);
    assert.equal(porCorreo?.correo, 'ana@quartz.example');
    assert.equal(await obtenerPorCorreo(base.pool(), 'nadie@quartz.example'), null);
  });

  it('obtenerPorId devuelve la persona o null', async () => {
    const carla = await obtenerPorId(base.pool(), ID.carla);
    assert.equal(carla?.nombre, 'Carla');
    assert.equal(carla?.activo, true);
    assert.equal(await obtenerPorId(base.pool(), randomUUID()), null);
  });

  it('el correo es único sin distinguir mayúsculas', async () => {
    await assert.rejects(
      () => crearUsuario(base.pool(), { id: randomUUID(), correo: 'Carla@Quartz.example', nombre: 'Otra Carla' }, ID.ana),
      'dos personas no pueden compartir correo',
    );
  });

  it('listarUsuarios trae a las cinco personas del PRD §7', async () => {
    const todos = await listarUsuarios(base.pool());
    const correos = todos.map((u) => u.correo);
    for (const correo of [
      'ana@quartz.example',
      'beto@quartz.example',
      'carla@quartz.example',
      'dani@quartz.example',
      'eva@quartz.example',
    ]) {
      assert.ok(correos.includes(correo), `falta ${correo}`);
    }
    assert.equal(todos.find((u) => u.correo === 'dani@quartz.example')?.activo, false);
    assert.equal(todos.find((u) => u.correo === 'ana@quartz.example')?.es_admin, true);
  });

  it('actualizarUsuario cambia lo pedido y anota el antes/después', async () => {
    const cambiado = await actualizarUsuario(base.pool(), fabi.id, { nombre: 'Fabiola' }, ID.ana);
    assert.equal(cambiado?.nombre, 'Fabiola');
    assert.equal(cambiado?.correo, 'fabi@quartz.example', 'lo que no se pide no cambia');

    const filas = await listarBitacora(base.pool(), { entidad_id: fabi.id, accion: ACCIONES.usuarioActualizado });
    assert.equal(filas.length, 1);
    assert.deepEqual((filas[0]?.antes as { nombre?: string })?.nombre, 'Fabi');
    assert.deepEqual((filas[0]?.despues as { nombre?: string })?.nombre, 'Fabiola');
  });

  it('actualizarUsuario de alguien que no existe devuelve null', async () => {
    assert.equal(await actualizarUsuario(base.pool(), randomUUID(), { nombre: 'Fantasma' }, ID.ana), null);
  });
});

// ---- Sesiones (R2) ----

describe('core.sesiones', () => {
  const t0 = hora('08:00:00');

  it('crearSesion devuelve el token en claro y una vigencia de 12 h', async () => {
    const { token, expira } = await crearSesion(base.pool(), ID.carla, { ip: '10.0.0.1', agente: 'pruebas', ahora: t0 });
    assert.match(token, /^[A-Za-z0-9_-]{43}$/, 'token de 32 bytes en base64url');
    assert.equal(expira, t0 + HORAS_SESION * HORA);
    assert.equal(HORAS_SESION, 12, 'R2: la sesión del portal dura 12 h');

    const fila = await unaFila<{ usuario_id: string; ip: string | null; agente: string | null; revocada: Date | null }>(
      base.pool(),
      `SELECT usuario_id, ip::text AS ip, agente, revocada FROM core.sesiones WHERE token_hash = $1`,
      [hashToken(token)],
    );
    assert.equal(fila?.usuario_id, ID.carla);
    assert.equal(fila?.ip, '10.0.0.1');
    assert.equal(fila?.agente, 'pruebas');
    assert.equal(fila?.revocada, null);
  });

  it('el token en claro no queda en ninguna columna de core.sesiones', async () => {
    const { token } = await crearSesion(base.pool(), ID.carla, { ahora: t0 });
    const columnas = await columnasQueContienen(base.pool(), 'sesiones', token);
    assert.deepEqual(columnas, [], `el token en claro aparece en: ${columnas.join(', ')}`);
    const { rows } = await base
      .pool()
      .query(`SELECT 1 FROM core.sesiones WHERE token_hash = $1`, [hashToken(token)]);
    assert.equal(rows.length, 1, 'sólo se guarda el SHA-256');
  });

  it('el token en claro tampoco queda en core.bitacora', async () => {
    const { token } = await crearSesion(base.pool(), ID.carla, { ahora: t0 });
    const columnas = await columnasQueContienen(base.pool(), 'bitacora', token);
    assert.deepEqual(columnas, [], `el token en claro aparece en core.bitacora: ${columnas.join(', ')}`);
  });

  it('acepta una vigencia distinta en horas', async () => {
    const { expira } = await crearSesion(base.pool(), ID.carla, { ahora: t0, horas: 1 });
    assert.equal(expira, t0 + HORA);
  });

  it('resolverSesion devuelve la sesión viva y respeta el límite inclusivo', async () => {
    const { token, expira } = await crearSesion(base.pool(), ID.carla, { ip: '10.0.0.2', agente: 'móvil', ahora: t0 });
    const viva = await resolverSesion(base.pool(), token, t0 + 1000);
    assert.equal(viva?.usuario_id, ID.carla);
    assert.equal(viva?.creada, t0);
    assert.equal(viva?.expira, expira);
    assert.equal(viva?.revocada, null);
    assert.equal(viva?.agente, 'móvil');

    assert.notEqual(await resolverSesion(base.pool(), token, expira), null, 'en el instante exacto sigue viva');
    assert.equal(await resolverSesion(base.pool(), token, expira + 1), null, 'un milisegundo después ya no');
  });

  it('un token inventado no resuelve nada', async () => {
    assert.equal(await resolverSesion(base.pool(), 'token-que-no-existe', t0), null);
  });

  it('revocarSesion la apaga y sólo funciona una vez', async () => {
    const { token } = await crearSesion(base.pool(), ID.beto, { ahora: t0 });
    assert.equal(await revocarSesion(base.pool(), token, t0 + 60_000), true);
    assert.equal(await resolverSesion(base.pool(), token, t0 + 61_000), null);
    assert.equal(await revocarSesion(base.pool(), token, t0 + 62_000), false, 'ya estaba revocada');
    assert.equal(await revocarSesion(base.pool(), 'token-inventado', t0), false);
  });

  it('revocarSesionesDe corta sólo las de esa persona', async () => {
    const eva1 = await crearSesion(base.pool(), ID.eva, { ahora: t0 });
    const eva2 = await crearSesion(base.pool(), ID.eva, { ahora: t0 });
    const beto = await crearSesion(base.pool(), ID.beto, { ahora: t0 });

    assert.equal(await revocarSesionesDe(base.pool(), ID.eva, t0 + 1000), 2);
    assert.equal(await resolverSesion(base.pool(), eva1.token, t0 + 2000), null);
    assert.equal(await resolverSesion(base.pool(), eva2.token, t0 + 2000), null);
    assert.notEqual(await resolverSesion(base.pool(), beto.token, t0 + 2000), null, 'Beto no se toca');
    assert.equal(await revocarSesionesDe(base.pool(), ID.eva, t0 + 3000), 0, 'ya no quedaban vivas');
  });

  it('purgarSesionesVencidas borra las vencidas y deja las vivas', async () => {
    const corte = hora('23:59:59');
    const cuantas = async (sql: string) =>
      Number((await unaFila<{ n: string }>(base.pool(), sql, [corte]))?.n ?? -1);

    const vencidas = await cuantas(
      `SELECT count(*) AS n FROM core.sesiones WHERE expira < to_timestamp($1::double precision / 1000)`,
    );
    const vivas = await cuantas(
      `SELECT count(*) AS n FROM core.sesiones WHERE expira >= to_timestamp($1::double precision / 1000)`,
    );
    assert.ok(vencidas > 0, 'la prueba necesita al menos una sesión vencida');

    assert.equal(await purgarSesionesVencidas(base.pool(), corte), vencidas);
    assert.equal(
      await cuantas(`SELECT count(*) AS n FROM core.sesiones WHERE expira < to_timestamp($1::double precision / 1000)`),
      0,
    );
    assert.equal(
      await cuantas(`SELECT count(*) AS n FROM core.sesiones WHERE expira >= to_timestamp($1::double precision / 1000)`),
      vivas,
      'las vivas siguen ahí',
    );
  });
});

// ---- R6 · desactivar a una persona ----

describe('R6 · desactivarUsuario', () => {
  const t1 = hora('12:00:00');
  /** Persona nueva por prueba, con dos sesiones vivas, un boleto pendiente y uno ya canjeado. */
  async function personaConTodo(nombre: string): Promise<{
    id: string;
    tokens: [string, string];
    pendiente: string;
    canjeado: string;
  }> {
    const pool = base.pool();
    const id = randomUUID();
    await pool.query(`INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo) VALUES ($1, $2, $3, false, true)`, [
      id,
      `${nombre}@quartz.example`,
      nombre,
    ]);
    await pool.query(
      `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', $2, true)`,
      [id, `${nombre}.op`],
    );
    const tokens: [string, string] = [`tok-${nombre}-1`, `tok-${nombre}-2`];
    // Las sesiones se anclan al reloj **real** y no a `t1`: quien decide si
    // siguen vivas es el servidor con su `now()` (R6 no recibe ninguna hora),
    // así que unas fechas fijas de hace días serían sesiones ya vencidas y la
    // baja no tendría nada que revocar.
    const desde = Date.now();
    for (const token of tokens) {
      await insertarSesion(pool, { usuarioId: id, token, creada: desde, expira: desde + 12 * HORA });
    }
    const pendiente = await insertarBoleto(pool, {
      usuarioId: id,
      modulo: 'cdh',
      usuarioModulo: `${nombre}.op`,
      codigo: `cod-${nombre}-pendiente`,
      emitido: t1,
      expira: t1 + 60_000,
    });
    const canjeado = await insertarBoleto(pool, {
      usuarioId: id,
      modulo: 'cdh',
      usuarioModulo: `${nombre}.op`,
      codigo: `cod-${nombre}-usado`,
      emitido: t1 - 120_000,
      expira: t1 - 60_000,
      canjeado: t1 - 119_000,
      resultado: RESULTADO_OK,
    });
    return { id, tokens, pendiente, canjeado };
  }

  const leerBoleto = (id: string) =>
    unaFila<{ canjeado: Date | null; resultado: string | null }>(
      base.pool(),
      `SELECT canjeado, resultado FROM core.boletos WHERE id = $1`,
      [id],
    );

  it('revoca sesiones y quema boletos pendientes, y devuelve las cuentas', async () => {
    const hugo = await personaConTodo('hugo');
    const otra = await personaConTodo('iris');

    const res = await desactivarUsuario(base.pool(), hugo.id, ID.ana);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.usuario.activo, false);
    assert.equal(res.sesiones_revocadas, 2);
    assert.equal(res.boletos_quemados, 1, 'sólo los que seguían sin canjear');

    assert.equal((await obtenerPorId(base.pool(), hugo.id))?.activo, false);
    for (const token of hugo.tokens) {
      assert.equal(await resolverSesion(base.pool(), token, t1 + 1000), null, 'sus sesiones quedan revocadas');
    }
    const pendiente = await leerBoleto(hugo.pendiente);
    assert.notEqual(pendiente?.canjeado, null, 'el boleto pendiente queda quemado');
    assert.equal(pendiente?.resultado, RESULTADO_USUARIO_DESACTIVADO);

    const yaUsado = await leerBoleto(hugo.canjeado);
    assert.equal(yaUsado?.resultado, RESULTADO_OK, 'un boleto ya canjeado no se reescribe');

    assert.notEqual(await resolverSesion(base.pool(), otra.tokens[0], t1 + 1000), null, 'nadie más se ve afectado');
    assert.equal((await leerBoleto(otra.pendiente))?.canjeado, null);
  });

  it('anota la desactivación en la bitácora', async () => {
    const jose = await personaConTodo('jose');
    await desactivarUsuario(base.pool(), jose.id, ID.ana);
    const filas = await listarBitacora(base.pool(), { entidad: ENTIDADES.usuario, entidad_id: jose.id });
    const baja = filas.find((f) => f.accion === ACCIONES.usuarioDesactivado);
    assert.ok(baja, `no se anotó ${ACCIONES.usuarioDesactivado}: ${JSON.stringify(filas)}`);
    assert.equal(baja?.quien, ID.ana);
  });

  it('desactivar a quien ya estaba inactivo no cambia nada', async () => {
    const lupe = await personaConTodo('lupe');
    await desactivarUsuario(base.pool(), lupe.id, ID.ana);
    const otra = await desactivarUsuario(base.pool(), lupe.id, ID.ana);
    assert.equal(otra.ok, true);
    if (!otra.ok) return;
    assert.equal(otra.usuario.activo, false);
    assert.equal(otra.sesiones_revocadas, 0);
    assert.equal(otra.boletos_quemados, 0);
  });

  it('quien no existe se rechaza sin tocar nada', async () => {
    const res = await desactivarUsuario(base.pool(), randomUUID(), ID.ana);
    assert.deepEqual(res, { ok: false, motivo: 'desconocido' });
  });

  it('todo ocurre en una sola transacción: si la bitácora falla, nada queda', async () => {
    const pool = base.pool();
    const mario = await personaConTodo('mario');
    await pool.query(
      `CREATE FUNCTION core.prueba_falla_bitacora() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'bitácora caída (simulada)'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER zz_prueba_falla BEFORE INSERT ON core.bitacora
       FOR EACH ROW EXECUTE FUNCTION core.prueba_falla_bitacora()`,
    );
    try {
      await assert.rejects(() => desactivarUsuario(pool, mario.id, ID.ana), 'la desactivación debe propagar el fallo');
      assert.equal((await obtenerPorId(pool, mario.id))?.activo, true, 'sigue activo');
      for (const token of mario.tokens) {
        assert.notEqual(await resolverSesion(pool, token, t1 + 1000), null, 'sus sesiones siguen vivas');
      }
      assert.equal((await leerBoleto(mario.pendiente))?.canjeado, null, 'su boleto sigue pendiente');
    } finally {
      await pool.query(`DROP TRIGGER zz_prueba_falla ON core.bitacora`);
      await pool.query(`DROP FUNCTION core.prueba_falla_bitacora()`);
    }
  });

  it('R6: no deja al portal sin administrador activo', async () => {
    const pool = base.pool();
    const admins = (await listarUsuarios(pool)).filter((u) => u.es_admin && u.activo);
    assert.deepEqual(
      admins.map((u) => u.correo),
      ['ana@quartz.example'],
      'la prueba supone que Ana es la única admin activa',
    );
    const res = await desactivarUsuario(pool, ID.ana, ID.ana);
    assert.deepEqual(res, { ok: false, motivo: 'ultimo_admin' });
    assert.equal((await obtenerPorId(pool, ID.ana))?.activo, true);
  });

  it('con otro administrador activo sí se puede desactivar al primero', async () => {
    const pool = base.pool();
    await pool.query(`UPDATE core.usuarios SET es_admin = true WHERE id = $1`, [ID.beto]);
    const res = await desactivarUsuario(pool, ID.ana, ID.beto);
    assert.equal(res.ok, true);
    assert.equal((await obtenerPorId(pool, ID.ana))?.activo, false);
  });

  it('la anotación de R6 va dentro de la transacción: si falla, no queda ni la baja ni la bitácora', async () => {
    const pool = base.pool();
    const nidia = await personaConTodo('nidia');
    await pool.query(
      `CREATE FUNCTION core.prueba_falla_bitacora_r6() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'bitácora caída (simulada)'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER zz_prueba_falla_r6 BEFORE INSERT ON core.bitacora
       FOR EACH ROW EXECUTE FUNCTION core.prueba_falla_bitacora_r6()`,
    );
    try {
      await assert.rejects(() => desactivarUsuario(pool, nidia.id, ID.ana), 'el fallo de `anotar` debe propagarse');
    } finally {
      await pool.query(`DROP TRIGGER zz_prueba_falla_r6 ON core.bitacora`);
      await pool.query(`DROP FUNCTION core.prueba_falla_bitacora_r6()`);
    }
    assert.equal((await obtenerPorId(pool, nidia.id))?.activo, true, 'la baja se deshizo con la transacción');
    const filas = await listarBitacora(pool, { entidad: ENTIDADES.usuario, entidad_id: nidia.id });
    assert.deepEqual(
      filas.filter((f) => f.accion === ACCIONES.usuarioDesactivado),
      [],
      'la anotación de la baja tampoco quedó',
    );
  });
});

// ---- R6 e invariante 4 · `actualizarUsuario` no puede saltarse al último administrador ----

describe('R6 · actualizarUsuario y el último administrador', () => {
  const t2 = hora('14:00:00');

  /** Deja a Ana como única administradora activa (las pruebas anteriores mueven esto). */
  async function soloAnaAdmin(): Promise<void> {
    const pool = base.pool();
    await pool.query(`UPDATE core.usuarios SET es_admin = false WHERE id <> $1::uuid`, [ID.ana]);
    await pool.query(`UPDATE core.usuarios SET es_admin = true, activo = true WHERE id = $1::uuid`, [ID.ana]);
    const admins = (await listarUsuarios(pool)).filter((u) => u.es_admin && u.activo);
    assert.deepEqual(
      admins.map((u) => u.correo),
      ['ana@quartz.example'],
      'la prueba necesita a Ana como única administradora activa',
    );
  }

  it('no deja desactivar a la última administradora (mismo rechazo que desactivarUsuario)', async () => {
    const pool = base.pool();
    await soloAnaAdmin();
    // `actualizarUsuario` cambia `activo`, así que también le toca R6: el rechazo
    // debe tener la forma de `desactivarUsuario` (`ResultadoDesactivacion`).
    const res: unknown = await actualizarUsuario(pool, ID.ana, { activo: false }, ID.ana);
    assert.deepEqual(res, { ok: false, motivo: 'ultimo_admin' });
    assert.equal((await obtenerPorId(pool, ID.ana))?.activo, true, 'Ana sigue activa');
  });

  it('no deja quitarle es_admin a la última administradora (R6)', async () => {
    const pool = base.pool();
    await soloAnaAdmin();
    const res: unknown = await actualizarUsuario(pool, ID.ana, { es_admin: false }, ID.ana);
    assert.deepEqual(res, { ok: false, motivo: 'ultimo_admin' });
    assert.equal((await obtenerPorId(pool, ID.ana))?.es_admin, true, 'Ana sigue siendo administradora');
  });

  it('desactivar por actualizarUsuario también revoca sesiones y quema boletos (R6)', async () => {
    const pool = base.pool();
    await soloAnaAdmin();

    // Nadia es administradora, pero no la última: Ana sigue activa, así que la baja procede.
    const nadia = randomUUID();
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
       VALUES ($1, 'nadia@quartz.example', 'Nadia', true, true)`,
      [nadia],
    );
    await pool.query(
      `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', 'nadia.op', true)`,
      [nadia],
    );
    // Igual que en `personaConTodo`: las sesiones se anclan al reloj real,
    // porque la baja las juzga con el `now()` del servidor.
    const desde = Date.now();
    for (const token of ['tok-nadia-1', 'tok-nadia-2']) {
      await insertarSesion(pool, { usuarioId: nadia, token, creada: desde, expira: desde + 12 * HORA });
    }
    const pendiente = await insertarBoleto(pool, {
      usuarioId: nadia,
      modulo: 'cdh',
      usuarioModulo: 'nadia.op',
      codigo: 'cod-nadia-pendiente',
      emitido: t2,
      expira: t2 + 60_000,
    });

    await actualizarUsuario(pool, nadia, { activo: false }, ID.ana);
    assert.equal((await obtenerPorId(pool, nadia))?.activo, false, 'Nadia queda inactiva');

    const cuenta = async (sql: string): Promise<number> =>
      Number((await unaFila<{ n: string }>(pool, sql, [nadia]))?.n ?? -1);

    assert.equal(
      await cuenta(`SELECT count(*) AS n FROM core.sesiones WHERE usuario_id = $1::uuid AND revocada IS NOT NULL`),
      2,
      'sus dos sesiones quedan revocadas, igual que con desactivarUsuario',
    );
    assert.equal(
      await cuenta(`SELECT count(*) AS n FROM core.sesiones WHERE usuario_id = $1::uuid AND revocada IS NULL`),
      0,
      'no le queda ninguna sesión viva',
    );
    assert.equal(
      await cuenta(`SELECT count(*) AS n FROM core.boletos WHERE usuario_id = $1::uuid AND canjeado IS NULL`),
      0,
      'no le queda ningún boleto pendiente',
    );

    const fila = await unaFila<{ canjeado: Date | null; resultado: string | null }>(
      pool,
      `SELECT canjeado, resultado FROM core.boletos WHERE id = $1`,
      [pendiente],
    );
    assert.notEqual(fila?.canjeado, null, 'su boleto pendiente quedó quemado');
    assert.equal(fila?.resultado, RESULTADO_USUARIO_DESACTIVADO);

    // Quemado por la baja, así que el motivo exacto es «inactivo» y no «usado»:
    // el boleto no se gastó, se le retiró el acceso a esa persona. Al CDH le
    // sirve la diferencia aunque en los dos casos se le niegue el paso.
    assert.deepEqual(
      await canjearBoleto(pool, { codigo: 'cod-nadia-pendiente', moduloQueCanjea: 'cdh', ahora: t2 + 5_000 }),
      { ok: false, motivo: 'inactivo' },
      'un boleto quemado por la baja se rechaza con el motivo de la baja',
    );
  });
});

// ---- R6 e invariante 4 · dos bajas simultáneas no pueden dejar el portal sin administrador ----

describe('R6 · concurrencia del último administrador', () => {
  it('Ana y Beto se desactivan a la vez: gana una sola y queda un administrador activo', async () => {
    const pool = base.pool();
    await pool.query(`UPDATE core.usuarios SET es_admin = false WHERE id <> $1::uuid AND id <> $2::uuid`, [
      ID.ana,
      ID.beto,
    ]);
    await pool.query(`UPDATE core.usuarios SET es_admin = true, activo = true WHERE id IN ($1::uuid, $2::uuid)`, [
      ID.ana,
      ID.beto,
    ]);
    const antes = (await listarUsuarios(pool))
      .filter((u) => u.es_admin && u.activo)
      .map((u) => u.correo)
      .sort();
    assert.deepEqual(antes, ['ana@quartz.example', 'beto@quartz.example'], 'la prueba parte de dos admins activas');

    // Un disparador que tarda al desactivar abre la ventana de la carrera siempre:
    // las dos transacciones alcanzan a contar las administradoras activas antes
    // de que cualquiera de las dos confirme su baja.
    await pool.query(
      `CREATE FUNCTION core.zz_baja_lenta() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER zz_baja_lenta BEFORE UPDATE ON core.usuarios
       FOR EACH ROW WHEN (old.activo AND NOT new.activo) EXECUTE FUNCTION core.zz_baja_lenta()`,
    );

    // Dos pools distintos para que las dos transacciones compitan de verdad.
    const poolA = crearPool(base.url());
    const poolB = crearPool(base.url());
    try {
      await Promise.all([poolA.query('SELECT 1'), poolB.query('SELECT 1')]);
      const [a, b] = await Promise.all([
        desactivarUsuario(poolA, ID.ana, ID.ana),
        desactivarUsuario(poolB, ID.beto, ID.beto),
      ]);
      const ambos = [a, b];
      const buenos = ambos.filter((r) => r.ok);
      const ultimos = ambos.filter((r) => !r.ok && r.motivo === 'ultimo_admin');
      assert.equal(buenos.length, 1, `sólo una de las dos puede ganar: ${JSON.stringify(ambos)}`);
      assert.equal(ultimos.length, 1, `la otra debe ver «ultimo_admin»: ${JSON.stringify(ambos)}`);
    } finally {
      await Promise.all([poolA.end().catch(() => undefined), poolB.end().catch(() => undefined)]);
      await pool.query(`DROP TRIGGER IF EXISTS zz_baja_lenta ON core.usuarios`);
      await pool.query(`DROP FUNCTION IF EXISTS core.zz_baja_lenta()`);
    }

    const quedan = (await listarUsuarios(pool)).filter((u) => u.es_admin && u.activo);
    assert.equal(quedan.length, 1, `el portal se quedó sin administradores activos: ${JSON.stringify(quedan)}`);
  });
});
