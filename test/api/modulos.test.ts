/**
 * R3 (boleto del CDH) y R5 (enlace mágico del CRM), más R1 aplicada en el
 * momento de abrir. Cada fila de esas tablas del PRD es un caso.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ID, levantarEntorno, sembrarListaCrm, borrarDeListaCrm, type Entorno, type Navegador } from '../apoyo/app.ts';
import { MENSAJES } from '../../src/rutas/modulos.ts';
import { unaFila } from '../apoyo/pg.ts';

const P = '/portal';
const CONTRASENA = 'contraseña-de-prueba';

let e: Entorno;

/** Entra al portal y devuelve un navegador con su cookie. */
async function comoQuien(correo: string): Promise<Navegador> {
  const nav = e.navegador();
  const r = await nav.pedir('POST', `${P}/api/auth/entrar`, { cuerpo: { correo, contrasena: CONTRASENA } });
  assert.equal(r.estado, 200, `no entró ${correo}`);
  return nav;
}

async function boletosDe(usuarioId: string): Promise<number> {
  const fila = await unaFila<{ n: string }>(e.pool, `SELECT count(*) AS n FROM core.boletos WHERE usuario_id = $1::uuid`, [
    usuarioId,
  ]);
  return Number(fila?.n ?? 0);
}

before(async () => {
  e = await levantarEntorno();
  e.supabase.agregar('ana@quartz.example', CONTRASENA, ID.ana);
  e.supabase.agregar('beto@quartz.example', CONTRASENA, ID.beto);
  e.supabase.agregar('carla@quartz.example', CONTRASENA, ID.carla);
  e.supabase.agregar('eva@quartz.example', CONTRASENA, ID.eva);
  // R5.2: en la lista del CRM están Beto y Eva; Ana **no**, aunque sea admin.
  await sembrarListaCrm(e.pool, ['beto@quartz.example', 'eva@quartz.example']);
});

describe('R3 · emisión del boleto del CDH', () => {
  it('Carla pide cdh: 302 a /cdh/api/auth/sso con un código de 43 caracteres', async () => {
    const nav = await comoQuien('carla@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
    assert.equal(r.estado, 302);
    const destino = r.destino ?? '';
    assert.match(destino, /^\/cdh\/api\/auth\/sso\?codigo=/);
    const codigo = new URL(destino, 'http://local').searchParams.get('codigo') ?? '';
    assert.equal(codigo.length, 43);
  });

  it('el código en claro no queda en la base: sólo su SHA-256', async () => {
    const nav = await comoQuien('carla@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
    const codigo = new URL(r.destino ?? '', 'http://local').searchParams.get('codigo') ?? '';
    const fila = await unaFila<{ n: string }>(
      e.pool,
      `SELECT count(*) AS n FROM core.boletos WHERE strpos(codigo_hash, $1) > 0`,
      [codigo],
    );
    assert.equal(Number(fila?.n ?? -1), 0);
  });

  it('Beto pide cdh: 403 y **no** se crea boleto', async () => {
    const antes = await boletosDe(ID.beto);
    const nav = await comoQuien('beto@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
    assert.equal(r.estado, 403);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.sinAcceso });
    assert.equal(await boletosDe(ID.beto), antes);
  });

  it('Carla pide xyz: 404 «Módulo desconocido.»', async () => {
    const nav = await comoQuien('carla@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/xyz/abrir`);
    assert.equal(r.estado, 404);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.desconocido });
  });

  it('emitir no invalida el boleto anterior: dos pestañas valen', async () => {
    const nav = await comoQuien('carla@quartz.example');
    const uno = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
    const dos = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
    const a = new URL(uno.destino ?? '', 'http://local').searchParams.get('codigo');
    const b = new URL(dos.destino ?? '', 'http://local').searchParams.get('codigo');
    assert.notEqual(a, b);
    const fila = await unaFila<{ n: string }>(
      e.pool,
      `SELECT count(*) AS n FROM core.boletos WHERE usuario_id = $1::uuid AND canjeado IS NULL`,
      [ID.carla],
    );
    assert.ok(Number(fila?.n ?? 0) >= 2);
  });

  it('sin sesión: 401, y sin tocar la base', async () => {
    const r = await e.pedir('GET', `${P}/api/modulos/cdh/abrir`);
    assert.equal(r.estado, 401);
  });
});

describe('R5 · entrada al CRM', () => {
  it('Beto abre el CRM: 302 a /#nube=…&cq=…, relativo al mismo dominio', async () => {
    const nav = await comoQuien('beto@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/crm/abrir`);
    assert.equal(r.estado, 302);
    const destino = r.destino ?? '';
    assert.ok(destino.startsWith('/#nube='), destino);
    assert.ok(!destino.startsWith('//'), 'nunca debe empezar con //');
    assert.match(destino, /&cq=/);
  });

  it('el fragmento nube= decodifica a {u,k} con la dirección y la llave anon', async () => {
    const nav = await comoQuien('beto@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/crm/abrir`);
    const destino = r.destino ?? '';
    const nube = /#nube=([^&]+)/.exec(destino)?.[1] ?? '';
    const datos = JSON.parse(Buffer.from(nube, 'base64url').toString('utf8')) as { u: string; k: string };
    assert.equal(datos.u, e.config.supabaseUrl);
    assert.equal(datos.k, e.config.supabaseAnon);
  });

  it('el cq= es el hashed_token que entregó Supabase, no otra cosa', async () => {
    const nav = await comoQuien('beto@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/crm/abrir`);
    const cq = /[&?]cq=([^&]+)/.exec(r.destino ?? '')?.[1] ?? '';
    assert.equal(decodeURIComponent(cq), e.supabase.ultimoTokenHash);
  });

  it('Ana es admin del portal pero su correo no está en la lista del CRM: 409', async () => {
    const nav = await comoQuien('ana@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/crm/abrir`);
    assert.equal(r.estado, 409);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.faltaEnCrm });
  });

  it('Eva tiene el acceso crm inactivo: 403 sin mirar siquiera la lista del CRM (R1)', async () => {
    // En la semilla del PRD §7 el acceso `crm` de Eva está inactivo: R1 corta
    // antes que R5.2, así que el 403 gana al 409.
    const nav = await comoQuien('eva@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/crm/abrir`);
    assert.equal(r.estado, 403);
    assert.deepEqual(r.cuerpo, { error: MENSAJES.sinAcceso });
  });

  it('un correo marcado como borrado en la lista del CRM no cuenta (R5.2)', async () => {
    // Con el acceso ya activo, lo único que puede fallar es la lista del CRM.
    await e.pool.query(`UPDATE core.accesos SET activo = true WHERE usuario_id = $1::uuid AND modulo = 'crm'`, [ID.eva]);
    await borrarDeListaCrm(e.pool, 'eva@quartz.example');
    try {
      const nav = await comoQuien('eva@quartz.example');
      const r = await nav.pedir('GET', `${P}/api/modulos/crm/abrir`);
      assert.equal(r.estado, 409);
      assert.deepEqual(r.cuerpo, { error: MENSAJES.faltaEnCrm });
    } finally {
      await e.pool.query(`UPDATE core.accesos SET activo = false WHERE usuario_id = $1::uuid AND modulo = 'crm'`, [ID.eva]);
    }
  });

  it('queda constancia en core.boletos con modulo = crm (R5.3)', async () => {
    const nav = await comoQuien('beto@quartz.example');
    await nav.pedir('GET', `${P}/api/modulos/crm/abrir`);
    const fila = await unaFila<{ n: string }>(
      e.pool,
      `SELECT count(*) AS n FROM core.boletos WHERE usuario_id = $1::uuid AND modulo = 'crm'`,
      [ID.beto],
    );
    assert.ok(Number(fila?.n ?? 0) >= 1);
  });
});

describe('R1 · abrir un módulo apagado', () => {
  it('con modulos.cdh.activo = false, Carla ya no puede abrirlo', async () => {
    await e.pool.query(`UPDATE core.modulos SET activo = false WHERE codigo = 'cdh'`);
    try {
      const nav = await comoQuien('carla@quartz.example');
      const r = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
      assert.equal(r.estado, 403);
      const yo = await nav.pedir('GET', `${P}/api/auth/yo`);
      assert.deepEqual((yo.cuerpo as { modulos: string[] }).modulos, []);
    } finally {
      await e.pool.query(`UPDATE core.modulos SET activo = true WHERE codigo = 'cdh'`);
    }
  });
});

describe('fase 08 · módulos en otro dominio (core.modulos.url_base)', () => {
  const CRM = 'https://core-quartz.vercel.app';
  const CDH = 'https://equipo.tailnet.ts.net/cdh';

  /** Deja `url_base` como estaba, pase lo que pase en la prueba. */
  async function conUrlBase(codigo: string, valor: string, prueba: () => Promise<void>): Promise<void> {
    const previo = await unaFila<{ url_base: string | null }>(
      e.pool,
      `SELECT url_base FROM core.modulos WHERE codigo = $1`,
      [codigo],
    );
    await e.pool.query(`UPDATE core.modulos SET url_base = $2 WHERE codigo = $1`, [codigo, valor]);
    try {
      await prueba();
    } finally {
      await e.pool.query(`UPDATE core.modulos SET url_base = $2 WHERE codigo = $1`, [
        codigo,
        previo?.url_base ?? null,
      ]);
    }
  }

  it('el 302 al CRM sale absoluto: sin esto la entrada cae dentro del portal', async () => {
    await conUrlBase('crm', CRM, async () => {
      const nav = await comoQuien('beto@quartz.example');
      const r = await nav.pedir('GET', `${P}/api/modulos/crm/abrir`);
      assert.equal(r.estado, 302);
      assert.ok(r.destino?.startsWith(`${CRM}/#nube=`), `destino: ${r.destino}`);
      assert.ok(r.destino?.includes('&cq='), `destino: ${r.destino}`);
    });
  });

  it('el 302 al CDH sale absoluto y conserva su prefijo', async () => {
    await conUrlBase('cdh', CDH, async () => {
      const nav = await comoQuien('carla@quartz.example');
      const r = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
      assert.equal(r.estado, 302);
      assert.ok(r.destino?.startsWith(`${CDH}/api/auth/sso?codigo=`), `destino: ${r.destino}`);
    });
  });

  it('con la semilla por omisión todo sigue relativo, como en las fases 04 y 05', async () => {
    const nav = await comoQuien('carla@quartz.example');
    const r = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
    assert.equal(r.estado, 302);
    assert.ok(r.destino?.startsWith('/cdh/api/auth/sso?codigo='), `destino: ${r.destino}`);
  });

  it('una url_base envenenada no manda a nadie a ningún lado: 500, nunca un 302', async () => {
    // Redirección abierta: la fila la escribe una administradora, pero aquí se
    // decide a dónde va alguien que acaba de entrar. Más vale caerse.
    await conUrlBase('cdh', '//malo.example', async () => {
      const nav = await comoQuien('carla@quartz.example');
      const r = await nav.pedir('GET', `${P}/api/modulos/cdh/abrir`);
      assert.equal(r.estado, 500);
      assert.ok(!String(r.destino ?? '').includes('malo.example'), `destino: ${r.destino}`);
    });
  });
});
