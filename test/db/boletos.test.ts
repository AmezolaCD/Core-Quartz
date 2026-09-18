/**
 * Fase 02: `core.boletos`. R3 (emisión de 60 s) y R4 (canje de un solo uso,
 * decidido con un solo `UPDATE … RETURNING` y `evaluarCanje` del núcleo).
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { VIGENCIA_BOLETO_MS } from '../../src/nucleo/boletos.ts';
import { hashToken } from '../../src/nucleo/cripto.ts';
import { crearPool } from '../../src/db/pool.ts';
import { randomUUID } from 'node:crypto';
import {
  RESULTADO_OK,
  RESULTADO_USUARIO_DESACTIVADO,
  canjearBoleto,
  emitirBoleto,
} from '../../src/db/repos/boletos.ts';
import { desactivarUsuario } from '../../src/db/repos/usuarios.ts';
import { ID, baseDePrueba, columnasQueContienen, hora, sembrarEjemplo, unaFila } from '../apoyo/pg.ts';

const base = baseDePrueba();

before(async () => {
  await sembrarEjemplo(base.pool());
});

/** Fila cruda del boleto de ese código. */
function leerBoleto(pool: Pool, codigo: string) {
  return unaFila<{
    usuario_id: string;
    modulo: string;
    usuario_modulo: string | null;
    emitido: Date;
    expira: Date;
    canjeado: Date | null;
    resultado: string | null;
  }>(
    pool,
    `SELECT usuario_id, modulo, usuario_modulo, emitido, expira, canjeado, resultado
       FROM core.boletos WHERE codigo_hash = $1`,
    [hashToken(codigo)],
  );
}

/** Emite un boleto y falla la prueba si R3 lo rechaza. */
async function emitir(pool: Pool, usuarioId: string, modulo: string, ahora: number): Promise<{ codigo: string; expira: number }> {
  const res = await emitirBoleto(pool, { usuarioId, modulo, ahora, ip: '10.0.0.7' });
  assert.equal(res.ok, true, `no se pudo emitir: ${JSON.stringify(res)}`);
  if (!res.ok) throw new Error('inalcanzable');
  return { codigo: res.codigo, expira: res.expira };
}

const cuantosBoletos = async (pool: Pool, usuarioId: string): Promise<number> =>
  Number((await unaFila<{ n: string }>(pool, `SELECT count(*) AS n FROM core.boletos WHERE usuario_id = $1`, [usuarioId]))?.n ?? -1);

describe('R3 · emitirBoleto', () => {
  const t = hora('10:00:00');

  it('Carla pide cdh: código de 43 caracteres y 60 s de vigencia', async () => {
    const pool = base.pool();
    const { codigo, expira } = await emitir(pool, ID.carla, 'cdh', t);
    assert.match(codigo, /^[A-Za-z0-9_-]{43}$/, 'R3: 32 bytes en base64url');
    assert.equal(expira, t + VIGENCIA_BOLETO_MS);

    const fila = await leerBoleto(pool, codigo);
    assert.equal(fila?.usuario_id, ID.carla);
    assert.equal(fila?.modulo, 'cdh');
    assert.equal(fila?.usuario_modulo, 'carla.ama');
    assert.equal(fila?.emitido.getTime(), t);
    assert.equal(fila?.expira.getTime(), t + VIGENCIA_BOLETO_MS);
    assert.equal(fila?.canjeado, null);
    assert.equal(fila?.resultado, null);
  });

  it('el código en claro no queda en ninguna columna de core.boletos', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    const columnas = await columnasQueContienen(pool, 'boletos', codigo);
    assert.deepEqual(columnas, [], `el código en claro aparece en: ${columnas.join(', ')}`);
    assert.notEqual(await leerBoleto(pool, codigo), null, 'sólo se guarda el SHA-256');
  });

  it('el código en claro tampoco queda en core.bitacora', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') });
    const columnas = await columnasQueContienen(pool, 'bitacora', codigo);
    assert.deepEqual(columnas, [], `el código en claro aparece en core.bitacora: ${columnas.join(', ')}`);
  });

  it('R3: emitir no invalida los boletos anteriores (dos pestañas)', async () => {
    const pool = base.pool();
    const uno = await emitir(pool, ID.carla, 'cdh', t);
    const dos = await emitir(pool, ID.carla, 'cdh', t);
    assert.notEqual(uno.codigo, dos.codigo);
    const a = await canjearBoleto(pool, { codigo: uno.codigo, moduloQueCanjea: 'cdh', ahora: t + 1000 });
    const b = await canjearBoleto(pool, { codigo: dos.codigo, moduloQueCanjea: 'cdh', ahora: t + 2000 });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
  });

  it('Beto pide cdh: sin acceso y sin crear boleto', async () => {
    const pool = base.pool();
    const antes = await cuantosBoletos(pool, ID.beto);
    assert.deepEqual(await emitirBoleto(pool, { usuarioId: ID.beto, modulo: 'cdh', ahora: t }), {
      ok: false,
      motivo: 'sin_acceso',
    });
    assert.equal(await cuantosBoletos(pool, ID.beto), antes, 'no se crea boleto (R3)');
  });

  it('Dani está inactivo y Eva tiene el acceso crm apagado', async () => {
    const pool = base.pool();
    assert.deepEqual(await emitirBoleto(pool, { usuarioId: ID.dani, modulo: 'cdh', ahora: t }), {
      ok: false,
      motivo: 'usuario_inactivo',
    });
    assert.deepEqual(await emitirBoleto(pool, { usuarioId: ID.eva, modulo: 'crm', ahora: t }), {
      ok: false,
      motivo: 'acceso_inactivo',
    });
    assert.equal(await cuantosBoletos(pool, ID.dani), 0);
  });

  it('un módulo que no existe se rechaza con modulo_desconocido', async () => {
    assert.deepEqual(await emitirBoleto(base.pool(), { usuarioId: ID.carla, modulo: 'xyz', ahora: t }), {
      ok: false,
      motivo: 'modulo_desconocido',
    });
  });

  it('con el módulo apagado nadie emite', async () => {
    const pool = base.pool();
    await pool.query(`UPDATE core.modulos SET activo = false WHERE codigo = 'cdh'`);
    try {
      assert.deepEqual(await emitirBoleto(pool, { usuarioId: ID.carla, modulo: 'cdh', ahora: t }), {
        ok: false,
        motivo: 'modulo_inactivo',
      });
    } finally {
      await pool.query(`UPDATE core.modulos SET activo = true WHERE codigo = 'cdh'`);
    }
  });

  it('el CRM también deja constancia, sin usuario_modulo (R5.3)', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.ana, 'crm', t);
    const fila = await leerBoleto(pool, codigo);
    assert.equal(fila?.modulo, 'crm');
    assert.equal(fila?.usuario_modulo, null);
  });
});

describe('R4 · canjearBoleto', () => {
  const t = hora('10:00:00');

  it('canje válido a 10:00:05 devuelve el usuario del CDH y quema el boleto', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    const res = await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') });
    assert.deepEqual(res, { ok: true, usuario_id: ID.carla, nombre: 'Carla', usuario_modulo: 'carla.ama' });

    const fila = await leerBoleto(pool, codigo);
    assert.equal(fila?.canjeado?.getTime(), hora('10:00:05'));
    assert.equal(fila?.resultado, RESULTADO_OK);
  });

  it('el mismo código otra vez: usado', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') });
    const otra = await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:06') });
    assert.deepEqual(otra, { ok: false, motivo: 'usado' });

    const fila = await leerBoleto(pool, codigo);
    assert.equal(fila?.canjeado?.getTime(), hora('10:00:05'), 'conserva el primer canje');
    assert.equal(fila?.resultado, RESULTADO_OK);
  });

  it('el límite es inclusivo: en el instante exacto de expira todavía vale', async () => {
    const pool = base.pool();
    const { codigo, expira } = await emitir(pool, ID.carla, 'cdh', t);
    assert.equal(expira, hora('10:01:00'));
    const res = await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: expira });
    assert.equal(res.ok, true);
  });

  it('un milisegundo después: vencido, y el boleto queda quemado', async () => {
    const pool = base.pool();
    const { codigo, expira } = await emitir(pool, ID.carla, 'cdh', t);
    assert.deepEqual(await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: expira + 1 }), {
      ok: false,
      motivo: 'vencido',
    });
    const fila = await leerBoleto(pool, codigo);
    assert.equal(fila?.canjeado?.getTime(), expira + 1, 'cualquier intento lo quema');
    assert.equal(fila?.resultado, 'vencido');
  });

  it('el módulo equivocado: modulo, y el boleto queda quemado', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    assert.deepEqual(await canjearBoleto(pool, { codigo, moduloQueCanjea: 'crm', ahora: hora('10:00:05') }), {
      ok: false,
      motivo: 'modulo',
    });
    const fila = await leerBoleto(pool, codigo);
    assert.notEqual(fila?.canjeado, null);
    assert.equal(fila?.resultado, 'modulo');
  });

  it('un código inventado: desconocido, sin crear nada', async () => {
    const pool = base.pool();
    const antes = Number((await unaFila<{ n: string }>(pool, `SELECT count(*) AS n FROM core.boletos`))?.n);
    assert.deepEqual(await canjearBoleto(pool, { codigo: 'codigo-que-no-existe', moduloQueCanjea: 'cdh', ahora: t }), {
      ok: false,
      motivo: 'desconocido',
    });
    const despues = Number((await unaFila<{ n: string }>(pool, `SELECT count(*) AS n FROM core.boletos`))?.n);
    assert.equal(despues, antes, 'un código desconocido no crea filas');
  });

  it('también se canjea presentando el hash', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    const res = await canjearBoleto(pool, {
      codigoHash: hashToken(codigo),
      moduloQueCanjea: 'cdh',
      ahora: hora('10:00:05'),
    });
    assert.equal(res.ok, true);
  });

  it('si desactivan a la persona entre emisión y canje: inactivo, y queda quemado', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    // Se apaga con SQL directo para no mezclar R6 (que ya quema los boletos pendientes).
    await pool.query(`UPDATE core.usuarios SET activo = false WHERE id = $1`, [ID.carla]);
    try {
      assert.deepEqual(await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') }), {
        ok: false,
        motivo: 'inactivo',
      });
      const fila = await leerBoleto(pool, codigo);
      assert.equal(fila?.canjeado?.getTime(), hora('10:00:05'));
      assert.equal(fila?.resultado, 'inactivo');
    } finally {
      await pool.query(`UPDATE core.usuarios SET activo = true WHERE id = $1`, [ID.carla]);
    }
  });

  it('si apagan su acceso entre emisión y canje: inactivo', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    await pool.query(`UPDATE core.accesos SET activo = false WHERE usuario_id = $1 AND modulo = 'cdh'`, [ID.carla]);
    try {
      assert.deepEqual(await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') }), {
        ok: false,
        motivo: 'inactivo',
      });
    } finally {
      await pool.query(`UPDATE core.accesos SET activo = true WHERE usuario_id = $1 AND modulo = 'cdh'`, [ID.carla]);
    }
  });

  it('si la religan a otro usuario del CDH entre emisión y canje: inactivo (R7)', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    await pool.query(`UPDATE core.accesos SET usuario_modulo = 'carla.rec' WHERE usuario_id = $1 AND modulo = 'cdh'`, [
      ID.carla,
    ]);
    try {
      assert.deepEqual(await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') }), {
        ok: false,
        motivo: 'inactivo',
      });
    } finally {
      await pool.query(`UPDATE core.accesos SET usuario_modulo = 'carla.ama' WHERE usuario_id = $1 AND modulo = 'cdh'`, [
        ID.carla,
      ]);
    }
  });

  it('si apagan el módulo entre emisión y canje: inactivo', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    await pool.query(`UPDATE core.modulos SET activo = false WHERE codigo = 'cdh'`);
    try {
      assert.deepEqual(await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') }), {
        ok: false,
        motivo: 'inactivo',
      });
    } finally {
      await pool.query(`UPDATE core.modulos SET activo = true WHERE codigo = 'cdh'`);
    }
  });

  it('las filas del boleto se releen al canjear: si el dueño cambió, inactivo', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);
    // Beto existe y está activo, pero no tiene acceso al CDH.
    await pool.query(`UPDATE core.boletos SET usuario_id = $1 WHERE codigo_hash = $2`, [ID.beto, hashToken(codigo)]);
    assert.deepEqual(await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') }), {
      ok: false,
      motivo: 'inactivo',
    });
  });
});

describe('R4 · concurrencia (invariante 3)', () => {
  it('20 canjes en paralelo del mismo código: exactamente 1 ok y 19 usado', async () => {
    const t = hora('10:00:00');
    const { codigo } = await emitir(base.pool(), ID.carla, 'cdh', t);

    // 20 conexiones distintas para que realmente compitan.
    const pools = Array.from({ length: 20 }, () => crearPool(base.url()));
    try {
      await Promise.all(pools.map((p) => p.query('SELECT 1')));
      const resultados = await Promise.all(
        pools.map((p) => canjearBoleto(p, { codigo, moduloQueCanjea: 'cdh', ahora: hora('10:00:05') })),
      );
      const buenos = resultados.filter((r) => r.ok);
      const usados = resultados.filter((r) => !r.ok && r.motivo === 'usado');
      assert.equal(buenos.length, 1, `ganó más de uno: ${JSON.stringify(resultados)}`);
      assert.equal(usados.length, 19, `los demás deben ver «usado»: ${JSON.stringify(resultados)}`);
    } finally {
      await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
    }

    const fila = await leerBoleto(base.pool(), codigo);
    assert.equal(fila?.canjeado?.getTime(), hora('10:00:05'));
    assert.equal(fila?.resultado, RESULTADO_OK);
  });
});

// ---- R4: quemar el boleto y dejar constancia son una sola cosa ----

describe('R4 · el canje y su registro van juntos', () => {
  const t = hora('11:00:00');

  /** Crea el par función/disparador que hace fallar una escritura, corre el trabajo y lo quita. */
  async function conDisparadorQueFalla(
    pool: Pool,
    nombre: string,
    tabla: 'core.bitacora' | 'core.boletos',
    clausula: string,
    condicion: string,
    trabajo: () => Promise<void>,
  ): Promise<void> {
    await pool.query(
      `CREATE FUNCTION core.${nombre}() RETURNS trigger LANGUAGE plpgsql AS
       $$ BEGIN RAISE EXCEPTION 'escritura caída (simulada)'; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER zz_${nombre} ${clausula} ON ${tabla} FOR EACH ROW ${condicion} EXECUTE FUNCTION core.${nombre}()`,
    );
    try {
      await trabajo();
    } finally {
      await pool.query(`DROP TRIGGER zz_${nombre} ON ${tabla}`);
      await pool.query(`DROP FUNCTION core.${nombre}()`);
    }
  }

  /** Ningún boleto puede quedar quemado sin su motivo (R4). */
  async function sinQuemadosSinMotivo(pool: Pool): Promise<void> {
    const fila = await unaFila<{ n: string }>(
      pool,
      `SELECT count(*) AS n FROM core.boletos WHERE canjeado IS NOT NULL AND resultado IS NULL`,
    );
    assert.equal(Number(fila?.n), 0, 'quedó un boleto con `canjeado` y `resultado` en NULL');
  }

  it('si la bitácora falla, el boleto no queda consumido', async () => {
    const pool = base.pool();
    // Se emite antes: la emisión también anota en la bitácora.
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);

    await conDisparadorQueFalla(
      pool,
      'prueba_falla_bitacora_canje',
      'core.bitacora',
      'BEFORE INSERT',
      '',
      async () => {
        await assert.rejects(
          () => canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('11:00:05') }),
          'el fallo de la bitácora debe propagarse',
        );
      },
    );

    const fila = await leerBoleto(pool, codigo);
    assert.equal(fila?.canjeado, null, 'sin su anotación, el canje se deshace y el boleto sigue sin consumir');
    assert.equal(fila?.resultado, null);
    await sinQuemadosSinMotivo(pool);

    assert.deepEqual(
      await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('11:00:10') }),
      { ok: true, usuario_id: ID.carla, nombre: 'Carla', usuario_modulo: 'carla.ama' },
      'un canje válido posterior sigue funcionando',
    );
  });

  it('nunca queda `canjeado` con `resultado` en NULL', async () => {
    const pool = base.pool();
    const { codigo } = await emitir(pool, ID.carla, 'cdh', t);

    // Misma simulación que con la bitácora, pero sobre la escritura del motivo.
    await conDisparadorQueFalla(
      pool,
      'prueba_falla_resultado',
      'core.boletos',
      'BEFORE UPDATE',
      'WHEN (old.resultado IS NULL AND new.resultado IS NOT NULL)',
      async () => {
        await assert.rejects(
          () => canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('11:00:05') }),
          'el fallo al guardar el motivo debe propagarse',
        );
      },
    );

    await sinQuemadosSinMotivo(pool);
    const fila = await leerBoleto(pool, codigo);
    assert.equal(fila?.canjeado, null, 'si el motivo no se pudo guardar, el boleto tampoco queda quemado');

    assert.deepEqual(
      await canjearBoleto(pool, { codigo, moduloQueCanjea: 'cdh', ahora: hora('11:00:10') }),
      { ok: true, usuario_id: ID.carla, nombre: 'Carla', usuario_modulo: 'carla.ama' },
      'un canje válido posterior sigue funcionando',
    );
  });
});

// ---- R4 + R6: canjear y dar de baja a la vez no puede terminar en abrazo mortal ----

describe('R4 y R6 · canje y baja simultáneos', () => {
  const RONDAS = 25;
  const t = hora('12:00:00');

  /** Código de Postgres del error (o su texto, si no traía código). */
  const codigoPg = (error: unknown): string => String((error as { code?: string }).code ?? error);

  /** Persona nueva, con su acceso al CDH y un boleto pendiente recién emitido. */
  async function personaConBoleto(pool: Pool, n: number): Promise<{ id: string; codigo: string }> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo) VALUES ($1, $2, $3, false, true)`,
      [id, `abrazo${n}@quartz.example`, `Abrazo ${n}`],
    );
    await pool.query(
      `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo) VALUES ($1, 'cdh', $2, true)`,
      [id, `abrazo${n}.op`],
    );
    const { codigo } = await emitir(pool, id, 'cdh', t);
    return { id, codigo };
  }

  it('el canje y la baja de la misma persona nunca se abrazan (40P01)', async () => {
    const pool = base.pool();

    // Postgres tarda `deadlock_timeout` (1 s por omisión) en notar cada abrazo
    // mortal. En la base desechable —y sólo en ella— se baja para que la prueba
    // no dure medio minuto; no cambia quién se abraza, sólo cuándo se nota.
    // El nombre lo generó `crearBaseDesechable` (`cq_test_<azar>`).
    await pool
      .query(`ALTER DATABASE "${base.nombre()}" SET deadlock_timeout = '40ms'`)
      .catch(() => undefined);

    // Los pools se abren después del ALTER para que sus sesiones ya lo traigan.
    const poolCanje = crearPool(base.url());
    const poolBaja = crearPool(base.url());

    const errores: string[] = [];
    const parejas: string[] = [];
    const boletos: string[] = [];
    try {
      await Promise.all([poolCanje.query('SELECT 1'), poolBaja.query('SELECT 1')]);

      for (let n = 0; n < RONDAS; n++) {
        const { id, codigo } = await personaConBoleto(pool, n);
        const [canje, baja] = await Promise.allSettled([
          canjearBoleto(poolCanje, { codigo, moduloQueCanjea: 'cdh', ahora: t + 5_000 }),
          desactivarUsuario(poolBaja, id, ID.ana),
        ]);

        if (canje.status === 'rejected') errores.push(`ronda ${n} · canje: ${codigoPg(canje.reason)}`);
        if (baja.status === 'rejected') errores.push(`ronda ${n} · baja: ${codigoPg(baja.reason)}`);
        if (canje.status === 'rejected' || baja.status === 'rejected') continue;

        // R4 + R6: las únicas parejas legítimas son «gana el canje», «gana la
        // baja y el canje ve el boleto usado» y «el canje alcanza a ver a la
        // persona ya inactiva».
        const motivoCanje = canje.value.ok ? RESULTADO_OK : canje.value.motivo;
        const legitima =
          baja.value.ok && (motivoCanje === RESULTADO_OK || motivoCanje === 'usado' || motivoCanje === 'inactivo');
        if (!legitima) parejas.push(`ronda ${n}: ${JSON.stringify([canje.value, baja.value])}`);

        const fila = await leerBoleto(pool, codigo);
        // Un canje que responde «inactivo» pudo quemar el boleto él mismo
        // —y entonces el motivo guardado es «inactivo»— o encontrarlo ya
        // quemado por la baja, que lo marca «usuario_desactivado». Las dos
        // son legítimas: el motivo que ve el CDH es el exacto en ambos casos,
        // y la fila recuerda quién lo quemó.
        const esperado =
          motivoCanje === 'inactivo' ? ['inactivo', RESULTADO_USUARIO_DESACTIVADO] : [motivoCanje];
        if (fila?.canjeado == null || !esperado.includes(fila?.resultado ?? '')) {
          boletos.push(`ronda ${n}: canje «${motivoCanje}» dejó ${JSON.stringify(fila)}`);
        }
      }
    } finally {
      await Promise.all([poolCanje.end().catch(() => undefined), poolBaja.end().catch(() => undefined)]);
    }

    assert.deepEqual(errores, [], `ninguna de las dos llamadas debe salir con un error crudo de Postgres`);
    assert.deepEqual(parejas, [], 'el par canje/baja terminó en un estado que no es ninguno de los legítimos');
    assert.deepEqual(boletos, [], 'todo boleto debe quedar quemado y con su motivo');

    const sueltos = await unaFila<{ n: string }>(
      pool,
      `SELECT count(*) AS n FROM core.boletos WHERE canjeado IS NOT NULL AND resultado IS NULL`,
    );
    assert.equal(Number(sueltos?.n), 0, 'ningún boleto puede quedar con `canjeado` y `resultado` en NULL');
  });
});
