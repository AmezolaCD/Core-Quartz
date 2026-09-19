/**
 * R2 del PRD: entrada al portal, sesión y salida.
 *
 * Cada fila de la tabla de R2 es un caso, con el código y el **texto exacto**
 * que fija el PRD. El límite de intentos (10 por 15 min, por IP y por correo)
 * vive aquí porque es la puerta que protege.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  HORA_CERO,
  ID,
  atributosDeCookie,
  levantarEntorno,
  valorDeCookie,
  type Entorno,
} from '../apoyo/app.ts';
import { MENSAJES } from '../../src/rutas/auth.ts';
import { unaFila } from '../apoyo/pg.ts';

const P = '/portal';
const CONTRASENA = 'contraseña-de-prueba';

let e: Entorno;

before(async () => {
  e = await levantarEntorno();
  // Las cinco personas del PRD §7 también existen en Supabase Auth, con el
  // mismo id (PRD §6: `core.usuarios.id` = `auth.users.id`).
  e.supabase.agregar('ana@quartz.example', CONTRASENA, ID.ana);
  e.supabase.agregar('beto@quartz.example', CONTRASENA, ID.beto);
  e.supabase.agregar('carla@quartz.example', CONTRASENA, ID.carla);
  e.supabase.agregar('dani@quartz.example', CONTRASENA, ID.dani);
  e.supabase.agregar('eva@quartz.example', CONTRASENA, ID.eva);
  // Un ejecutivo del CRM con cuenta en Supabase pero sin fila en `core.usuarios`.
  e.supabase.agregar('ajeno@quartz.example', CONTRASENA);
});

describe('R2 · entrar al portal', () => {
  it('el correo no distingue mayúsculas: ANA@Quartz.example entra', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'ANA@Quartz.example', contrasena: CONTRASENA },
    });
    assert.equal(r.estado, 200);
    assert.notEqual(valorDeCookie(r.cookies, 'cq_sesion'), null);
  });

  it('contraseña equivocada: 401 con el texto de R2', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'beto@quartz.example', contrasena: 'otra' },
    });
    assert.equal(r.estado, 401);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.credenciales });
  });

  it('correo que no existe: el mismo 401, palabra por palabra', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'fantasma@quartz.example', contrasena: CONTRASENA },
    });
    assert.equal(r.estado, 401);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.credenciales });
  });

  it('cuenta válida en Supabase pero sin fila en core.usuarios: 403', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'ajeno@quartz.example', contrasena: CONTRASENA },
    });
    assert.equal(r.estado, 403);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.sinAcceso });
    assert.equal(valorDeCookie(r.cookies, 'cq_sesion'), null);
  });

  it('persona desactivada (Dani): 403 «Tu cuenta está desactivada.»', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'dani@quartz.example', contrasena: CONTRASENA },
    });
    assert.equal(r.estado, 403);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.desactivada });
  });

  it('una entrada válida no deja el token en claro en la base (R2, sólo SHA-256)', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'carla@quartz.example', contrasena: CONTRASENA },
    });
    const token = valorDeCookie(r.cookies, 'cq_sesion');
    assert.notEqual(token, null);
    const fila = await unaFila<{ n: string }>(
      e.pool,
      `SELECT count(*) AS n FROM core.sesiones WHERE strpos(token_hash, $1) > 0`,
      [token ?? ''],
    );
    assert.equal(Number(fila?.n ?? -1), 0);
  });
});

describe('R2 · la cookie de sesión', () => {
  it('es HttpOnly, SameSite=Lax y con Path del shell', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'beto@quartz.example', contrasena: CONTRASENA },
    });
    const cookie = atributosDeCookie(r.cookies, 'cq_sesion') ?? '';
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\/portal/i);
  });

  it('sin HTTPS no lleva Secure; con X-Forwarded-Proto: https sí', async () => {
    const plano = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'beto@quartz.example', contrasena: CONTRASENA },
    });
    assert.doesNotMatch(atributosDeCookie(plano.cookies, 'cq_sesion') ?? '', /Secure/i);

    const seguro = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'beto@quartz.example', contrasena: CONTRASENA },
      cabeceras: { 'x-forwarded-proto': 'https' },
    });
    assert.match(atributosDeCookie(seguro.cookies, 'cq_sesion') ?? '', /Secure/i);
  });

  it('la sesión dura 12 horas (R2)', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'beto@quartz.example', contrasena: CONTRASENA },
    });
    const token = valorDeCookie(r.cookies, 'cq_sesion') ?? '';
    const fila = await unaFila<{ ms: string }>(
      e.pool,
      `SELECT (extract(epoch from (expira - creada)) * 1000)::bigint::text AS ms
         FROM core.sesiones ORDER BY creada DESC LIMIT 1`,
    );
    assert.notEqual(token, '');
    assert.equal(Number(fila?.ms ?? 0), 12 * 3_600_000);
  });
});

describe('R1/R2 · GET /api/auth/yo', () => {
  it('sin sesión responde 401', async () => {
    const r = await e.pedir('GET', `${P}/api/auth/yo`);
    assert.equal(r.estado, 401);
  });

  it('con sesión devuelve la persona y sus módulos visibles (R1)', async () => {
    const nav = e.navegador();
    await nav.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'ana@quartz.example', contrasena: CONTRASENA },
    });
    const r = await nav.pedir('GET', `${P}/api/auth/yo`);
    assert.equal(r.estado, 200);
    const cuerpo = r.cuerpo as {
      usuario: { correo: string; es_admin: boolean };
      modulos: { codigo: string; nombre: string; orden: number }[];
    };
    assert.equal(cuerpo.usuario.correo, 'ana@quartz.example');
    assert.equal(cuerpo.usuario.es_admin, true);
    // R1: por `orden`, no alfabético.
    assert.deepEqual(cuerpo.modulos.map((m) => m.codigo), ['crm', 'cdh']);
    // Con su nombre, para que el portal no lo lleve escrito en el JS (fase 07).
    assert.deepEqual(cuerpo.modulos, [
      { codigo: 'crm', nombre: 'CRM de Ventas', orden: 1 },
      { codigo: 'cdh', nombre: 'Control de Detalles por Habitación', orden: 2 },
    ]);
  });

  it('Carla sólo ve el CDH; Beto sólo el CRM; Eva sólo el CDH (R1)', async () => {
    for (const [correo, esperado] of [
      ['carla@quartz.example', ['cdh']],
      ['beto@quartz.example', ['crm']],
      ['eva@quartz.example', ['cdh']],
    ] as const) {
      const nav = e.navegador();
      await nav.pedir('POST', `${P}/api/auth/entrar`, { cuerpo: { correo, contrasena: CONTRASENA } });
      const r = await nav.pedir('GET', `${P}/api/auth/yo`);
      const suyos = (r.cuerpo as { modulos: { codigo: string }[] }).modulos.map((m) => m.codigo);
      assert.deepEqual(suyos, esperado, correo);
    }
  });
});

describe('R2 · salir', () => {
  it('revoca la sesión: la misma cookie ya no sirve', async () => {
    const nav = e.navegador();
    await nav.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'beto@quartz.example', contrasena: CONTRASENA },
    });
    const cookie = nav.sesion();
    assert.notEqual(cookie, null);

    const salida = await nav.pedir('POST', `${P}/api/auth/salir`);
    assert.equal(salida.estado, 200);

    const despues = await e.pedir('GET', `${P}/api/auth/yo`, { cookie });
    assert.equal(despues.estado, 401);
  });
});

describe('fase 04 · límite de intentos', () => {
  it('el 11.º intento desde la misma IP en 15 min responde 429', async () => {
    const ip = '203.0.113.10';
    for (let i = 0; i < 10; i += 1) {
      const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
        cuerpo: { correo: `nadie${i}@quartz.example`, contrasena: 'mala' },
        cabeceras: { 'x-forwarded-for': ip },
      });
      assert.equal(r.estado, 401, `intento ${i + 1}`);
    }
    const onceavo = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'nadie@quartz.example', contrasena: 'mala' },
      cabeceras: { 'x-forwarded-for': ip },
    });
    assert.equal(onceavo.estado, 429);
  });

  it('también el 11.º del mismo correo desde IPs distintas', async () => {
    const correo = 'beto@quartz.example';
    for (let i = 0; i < 10; i += 1) {
      const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
        cuerpo: { correo, contrasena: 'mala' },
        cabeceras: { 'x-forwarded-for': `198.51.100.${i + 1}` },
      });
      assert.equal(r.estado, 401, `intento ${i + 1}`);
    }
    const onceavo = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo, contrasena: 'mala' },
      cabeceras: { 'x-forwarded-for': '198.51.100.250' },
    });
    assert.equal(onceavo.estado, 429);
  });

  it('pasada la ventana de 15 minutos vuelve a admitir', async () => {
    const ip = '192.0.2.77';
    for (let i = 0; i < 11; i += 1) {
      await e.pedir('POST', `${P}/api/auth/entrar`, {
        cuerpo: { correo: 'otro@quartz.example', contrasena: 'mala' },
        cabeceras: { 'x-forwarded-for': ip },
      });
    }
    e.reloj.ahora = HORA_CERO + 900_001;
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, {
      cuerpo: { correo: 'otro@quartz.example', contrasena: 'mala' },
      cabeceras: { 'x-forwarded-for': ip },
    });
    assert.equal(r.estado, 401);
    e.reloj.ahora = HORA_CERO;
  });
});

describe('fase 04 · montaje bajo el prefijo', () => {
  it('GET /api/salud responde con el nombre de la aplicación', async () => {
    const r = await e.pedir('GET', `${P}/api/salud`);
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo, { ok: true, app: 'Core Quartz' });
  });

  it('GET /portal redirige con 301 a /portal/', async () => {
    const r = await e.pedir('GET', P);
    assert.equal(r.estado, 301);
    assert.equal(r.destino, `${P}/`);
  });

  it('fuera del prefijo no hay nada', async () => {
    const r = await e.pedir('GET', '/api/salud');
    assert.equal(r.estado, 404);
  });
});
