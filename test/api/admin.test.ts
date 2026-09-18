/**
 * R6 (desactivar a una persona) y R7 (asignar accesos), por HTTP.
 *
 * Cada fila de esas dos tablas del PRD es un caso, con su código y su texto.
 * El CDH y Supabase son los simuladores: se comprueba también **qué se les
 * llamó**, porque una baja que no bloquea en Supabase no es una baja (R6).
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ID, levantarEntorno, sembrarListaCrm, type Entorno, type Navegador } from '../apoyo/app.ts';
import { ACCION_REVOCACION_PENDIENTE, MENSAJES, mensajeDuplicado } from '../../src/rutas/admin.ts';
import { unaFila } from '../apoyo/pg.ts';

const P = '/portal';
const CONTRASENA = 'contraseña-de-prueba';

let e: Entorno;
let ana: Navegador;

async function comoQuien(correo: string): Promise<Navegador> {
  const nav = e.navegador();
  const r = await nav.pedir('POST', `${P}/api/auth/entrar`, { cuerpo: { correo, contrasena: CONTRASENA } });
  assert.equal(r.estado, 200, `no entró ${correo}`);
  return nav;
}

async function activo(id: string): Promise<boolean> {
  const fila = await unaFila<{ activo: boolean }>(e.pool, `SELECT activo FROM core.usuarios WHERE id = $1::uuid`, [id]);
  return fila?.activo ?? false;
}

before(async () => {
  e = await levantarEntorno();
  for (const [correo, id] of [
    ['ana@quartz.example', ID.ana],
    ['beto@quartz.example', ID.beto],
    ['carla@quartz.example', ID.carla],
    ['eva@quartz.example', ID.eva],
  ] as const) {
    e.supabase.agregar(correo, CONTRASENA, id);
  }
  e.cdh.agregar('carla.ama', true);
  e.cdh.agregar('eva.rec', true);
  e.cdh.agregar('sistemas', true);
  e.cdh.agregar('inactivo.cdh', false);
  await sembrarListaCrm(e.pool, ['beto@quartz.example', 'eva@quartz.example', 'nuevo@quartz.example']);
  ana = await comoQuien('ana@quartz.example');
});

beforeEach(() => {
  e.cdh.caido = false;
});

describe('la puerta de administración', () => {
  it('quien no es admin recibe 403 (decisión #18)', async () => {
    const beto = await comoQuien('beto@quartz.example');
    const r = await beto.pedir('GET', `${P}/api/admin/usuarios`);
    assert.equal(r.estado, 403);
  });

  it('sin sesión, 401', async () => {
    const r = await e.pedir('GET', `${P}/api/admin/usuarios`);
    assert.equal(r.estado, 401);
  });

  it('Ana sí puede listar', async () => {
    const r = await ana.pedir('GET', `${P}/api/admin/usuarios`);
    assert.equal(r.estado, 200);
    assert.ok(Array.isArray((r.cuerpo as { usuarios: unknown[] }).usuarios));
  });
});

describe('R7 · asignar accesos', () => {
  it('«Carla.Ama» se guarda en minúsculas', async () => {
    const r = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.carla}/accesos/cdh`, {
      cuerpo: { usuario_modulo: 'Carla.Ama' },
    });
    assert.equal(r.estado, 200);
    const fila = await unaFila<{ usuario_modulo: string }>(
      e.pool,
      `SELECT usuario_modulo FROM core.accesos WHERE usuario_id = $1::uuid AND modulo = 'cdh'`,
      [ID.carla],
    );
    assert.equal(fila?.usuario_modulo, 'carla.ama');
  });

  it('ligar «carla.ama» a Eva: 409 nombrando a Carla', async () => {
    const r = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.eva}/accesos/cdh`, {
      cuerpo: { usuario_modulo: 'carla.ama' },
    });
    assert.equal(r.estado, 409);
    assert.deepEqual(r.cuerpo, { error: mensajeDuplicado('Carla') });
  });

  it('«juan perez» no pasa el formato: 422', async () => {
    const r = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.eva}/accesos/cdh`, {
      cuerpo: { usuario_modulo: 'juan perez' },
    });
    assert.equal(r.estado, 422);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.formatoUsuarioCdh });
  });

  it('«fantasma» no existe en el CDH: 422', async () => {
    const r = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.eva}/accesos/cdh`, {
      cuerpo: { usuario_modulo: 'fantasma' },
    });
    assert.equal(r.estado, 422);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.noExisteEnCdh });
  });

  it('un usuario del CDH que existe pero está inactivo: el mismo 422', async () => {
    const r = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.eva}/accesos/cdh`, {
      cuerpo: { usuario_modulo: 'inactivo.cdh' },
    });
    assert.equal(r.estado, 422);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.noExisteEnCdh });
  });

  it('el CRM no lleva usuario_modulo, y valida R5.2', async () => {
    const conUsuario = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.beto}/accesos/crm`, {
      cuerpo: { usuario_modulo: 'beto' },
    });
    assert.equal(conUsuario.estado, 422);

    const bien = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.beto}/accesos/crm`, { cuerpo: {} });
    assert.equal(bien.estado, 200);
  });

  it('asignar crm a quien no está en la lista del CRM: 409 (R5.2 al asignar)', async () => {
    const r = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.carla}/accesos/crm`, { cuerpo: {} });
    assert.equal(r.estado, 409);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.faltaEnCrm });
  });

  it('desactivar el acceso crm de Eva no bloquea su cuenta de Supabase', async () => {
    const antes = e.supabase.cuentas.get('eva@quartz.example')?.bloqueada;
    const r = await ana.pedir('DELETE', `${P}/api/admin/usuarios/${ID.eva}/accesos/crm`);
    assert.equal(r.estado, 200);
    assert.equal(e.supabase.cuentas.get('eva@quartz.example')?.bloqueada, antes);
  });

  it('un módulo que no existe: 404', async () => {
    const r = await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.eva}/accesos/xyz`, { cuerpo: {} });
    assert.equal(r.estado, 404);
  });
});

describe('R6 · desactivar a una persona', () => {
  it('Beto sale del portal en su siguiente petición y queda bloqueado en Supabase', async () => {
    const beto = await comoQuien('beto@quartz.example');
    assert.equal((await beto.pedir('GET', `${P}/api/auth/yo`)).estado, 200);

    const baja = await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.beto}`, { cuerpo: { activo: false } });
    assert.equal(baja.estado, 200);
    assert.deepEqual((baja.cuerpo as { avisos: string[] }).avisos, []);

    assert.equal(await activo(ID.beto), false);
    assert.equal(e.supabase.cuentas.get('beto@quartz.example')?.bloqueada, true);
    assert.equal((await beto.pedir('GET', `${P}/api/auth/yo`)).estado, 401);
  });

  it('reactivar quita el bloqueo pero no revive sesiones viejas', async () => {
    const beto = await comoQuien('beto@quartz.example');
    const cookie = beto.sesion();
    await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.beto}`, { cuerpo: { activo: false } });
    const alta = await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.beto}`, { cuerpo: { activo: true } });
    assert.equal(alta.estado, 200);
    assert.equal(e.supabase.cuentas.get('beto@quartz.example')?.bloqueada, false);
    assert.equal((await e.pedir('GET', `${P}/api/auth/yo`, { cookie })).estado, 401);
  });

  it('la baja revoca sus sesiones del CDH', async () => {
    await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.carla}`, { cuerpo: { activo: false } });
    assert.ok((e.cdh.revocaciones.get('carla.ama') ?? 0) >= 1);
    await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.carla}`, { cuerpo: { activo: true } });
  });

  it('con el CDH caído: 200 con avisos ["cdh"] y bitácora revocacion_pendiente', async () => {
    e.cdh.caido = true;
    const r = await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.carla}`, { cuerpo: { activo: false } });
    assert.equal(r.estado, 200);
    assert.deepEqual((r.cuerpo as { avisos: string[] }).avisos, ['cdh']);
    // La baja se guardó igual (decisión #24).
    assert.equal(await activo(ID.carla), false);

    const fila = await unaFila<{ n: string }>(
      e.pool,
      `SELECT count(*) AS n FROM core.bitacora WHERE accion = $1 AND entidad_id = $2`,
      [ACCION_REVOCACION_PENDIENTE, ID.carla],
    );
    assert.ok(Number(fila?.n ?? 0) >= 1);
  });

  it('el reintento con el CDH arriba limpia el pendiente', async () => {
    e.cdh.caido = false;
    const antes = e.cdh.revocaciones.get('carla.ama') ?? 0;
    const r = await ana.pedir('POST', `${P}/api/admin/usuarios/${ID.carla}/reintentar-revocacion`);
    assert.equal(r.estado, 200);
    assert.deepEqual((r.cuerpo as { avisos: string[] }).avisos, []);
    assert.equal(e.cdh.revocaciones.get('carla.ama'), antes + 1);
    await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.carla}`, { cuerpo: { activo: true } });
  });

  it('la única admin activa no puede desactivarse: 409', async () => {
    const r = await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.ana}`, { cuerpo: { activo: false } });
    assert.equal(r.estado, 409);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.ultimoAdmin });
    assert.equal(await activo(ID.ana), true);
  });

  it('tampoco puede quitarse es_admin siendo la única: 409', async () => {
    const r = await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.ana}`, { cuerpo: { es_admin: false } });
    assert.equal(r.estado, 409);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.ultimoAdmin });
  });

  it('una persona que no existe: 404', async () => {
    const r = await ana.pedir('PATCH', `${P}/api/admin/usuarios/00000000-0000-4000-8000-0000000000ff`, {
      cuerpo: { activo: false },
    });
    assert.equal(r.estado, 404);
  });
});

describe('fase 04 · alta de personas', () => {
  it('si el correo no existe en Supabase Auth, se crea con la contraseña temporal', async () => {
    const r = await ana.pedir('POST', `${P}/api/admin/usuarios`, {
      cuerpo: {
        correo: 'nuevo@quartz.example',
        nombre: 'Nuevo',
        contrasena_temporal: 'temporal-123456',
      },
    });
    assert.equal(r.estado, 201);
    const cuenta = e.supabase.cuentas.get('nuevo@quartz.example');
    assert.ok(cuenta, 'debió crearse en Supabase');
    assert.equal(cuenta?.contrasena, 'temporal-123456');

    // Y con esa contraseña ya puede entrar.
    const entrada = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'nuevo@quartz.example', contrasena: 'temporal-123456' },
    });
    assert.equal(entrada.estado, 200);
  });

  it('si la cuenta ya existía en Supabase, se reutiliza su id', async () => {
    const cuenta = e.supabase.agregar('viejo@quartz.example', 'ya-tenia');
    const r = await ana.pedir('POST', `${P}/api/admin/usuarios`, {
      cuerpo: { correo: 'viejo@quartz.example', nombre: 'Viejo' },
    });
    assert.equal(r.estado, 201);
    const fila = await unaFila<{ id: string }>(e.pool, `SELECT id FROM core.usuarios WHERE correo = $1`, [
      'viejo@quartz.example',
    ]);
    assert.equal(fila?.id, cuenta.id);
  });

  it('el correo se guarda en minúsculas', async () => {
    await ana.pedir('POST', `${P}/api/admin/usuarios`, {
      cuerpo: { correo: 'MAYUS@Quartz.example', nombre: 'Mayus', contrasena_temporal: 'temporal-123456' },
    });
    const fila = await unaFila<{ correo: string }>(e.pool, `SELECT correo FROM core.usuarios WHERE lower(correo) = $1`, [
      'mayus@quartz.example',
    ]);
    assert.equal(fila?.correo, 'mayus@quartz.example');
  });
});

describe('fase 04 · bitácora', () => {
  it('toda acción de admin queda anotada', async () => {
    await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.eva}`, { cuerpo: { nombre: 'Eva Recepción' } });
    const r = await ana.pedir('GET', `${P}/api/admin/bitacora`);
    assert.equal(r.estado, 200);
    const filas = (r.cuerpo as { bitacora: Array<{ accion: string; entidad_id: string }> }).bitacora;
    assert.ok(filas.some((f) => f.entidad_id === ID.eva));
  });

  it('devuelve 200 como máximo y acepta paginar', async () => {
    const r = await ana.pedir('GET', `${P}/api/admin/bitacora?limite=5`);
    assert.equal(r.estado, 200);
    assert.ok((r.cuerpo as { bitacora: unknown[] }).bitacora.length <= 5);
  });

  it('quien no es admin no la lee', async () => {
    const eva = await comoQuien('eva@quartz.example');
    assert.equal((await eva.pedir('GET', `${P}/api/admin/bitacora`)).estado, 403);
  });
});
