/**
 * Invariantes transversales de la fase 04 (PRD §8 y §9):
 * ningún secreto sale del servidor, la cabecera CSP no deja scripts en línea,
 * el shell sólo habla con el CDH por sus dos rutas de sesión, y `/api/sso/*`
 * no existe si el servidor no tiene secreto configurado.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ID, levantarEntorno, SECRETOS_DE_PRUEBA, sembrarListaCrm, type Entorno, type Navegador } from '../apoyo/app.ts';

const P = '/portal';
const CONTRASENA = 'contraseña-de-prueba';

let e: Entorno;
let ana: Navegador;

/** Valores que jamás deben aparecer en una respuesta (invariante 5). */
const PROHIBIDOS = [SECRETOS_DE_PRUEBA.serviceRole, SECRETOS_DE_PRUEBA.sso];

async function comoQuien(correo: string): Promise<Navegador> {
  const nav = e.navegador();
  await nav.pedir('POST', `${P}/api/auth/entrar`, { cuerpo: { correo, contrasena: CONTRASENA } });
  return nav;
}

before(async () => {
  e = await levantarEntorno();
  e.supabase.agregar('ana@quartz.example', CONTRASENA, ID.ana);
  e.supabase.agregar('beto@quartz.example', CONTRASENA, ID.beto);
  await sembrarListaCrm(e.pool, ['beto@quartz.example']);
  ana = await comoQuien('ana@quartz.example');
});

describe('invariante 5 · los secretos se quedan en el servidor', () => {
  it('ninguna respuesta —ni de error— trae service_role ni el secreto de SSO', async () => {
    const rutas: Array<[string, string, unknown]> = [
      ['GET', `${P}/api/salud`, undefined],
      ['GET', `${P}/api/auth/yo`, undefined],
      ['POST', `${P}/api/auth/entrar`, { correo: 'beto@quartz.example', contrasena: 'mala' }],
      ['POST', `${P}/api/auth/entrar`, { correo: 'no-existe', contrasena: 'x' }],
      ['GET', `${P}/api/modulos/crm/abrir`, undefined],
      ['GET', `${P}/api/modulos/xyz/abrir`, undefined],
      ['GET', `${P}/api/admin/usuarios`, undefined],
      ['GET', `${P}/api/admin/bitacora`, undefined],
      ['POST', `${P}/api/sso/canjear`, { codigo: 'x', modulo: 'cdh' }],
      ['GET', `${P}/api/no-existe`, undefined],
    ];
    for (const [metodo, ruta, cuerpo] of rutas) {
      for (const nav of [e, ana]) {
        const r = await nav.pedir(metodo, ruta, { cuerpo });
        for (const secreto of PROHIBIDOS) {
          assert.ok(!r.texto.includes(secreto), `${metodo} ${ruta} filtró un secreto`);
        }
        assert.ok(!r.texto.includes(e.config.databaseUrl), `${metodo} ${ruta} filtró DATABASE_URL`);
      }
    }
  });

  it('la llave anon sí puede salir: es la única pública (R5.3)', async () => {
    const beto = await comoQuien('beto@quartz.example');
    const r = await beto.pedir('GET', `${P}/api/modulos/crm/abrir`);
    assert.equal(r.estado, 302);
    const nube = /#nube=([^&]+)/.exec(r.destino ?? '')?.[1] ?? '';
    const datos = JSON.parse(Buffer.from(nube, 'base64url').toString('utf8')) as { k: string };
    assert.equal(datos.k, SECRETOS_DE_PRUEBA.anon);
  });

  it('un error inesperado no devuelve la traza', async () => {
    const r = await e.pedir('POST', `${P}/api/auth/entrar`, { cuerpo: { correo: 42, contrasena: {} } });
    assert.ok(r.estado >= 400);
    assert.ok(!r.texto.includes('at '), 'no debe traer pila de llamadas');
    assert.ok(!/node_modules|\/src\//.test(r.texto), 'no debe traer rutas del servidor');
  });
});

describe('PRD §5 · cabeceras de las respuestas del shell', () => {
  it('llevan Content-Security-Policy sin unsafe-inline para scripts', async () => {
    const r = await e.pedir('GET', `${P}/api/salud`);
    const csp = r.cabeceras.get('content-security-policy');
    assert.ok(csp, 'falta la cabecera CSP');
    const scripts = /script-src ([^;]+)/.exec(csp ?? '')?.[1] ?? '';
    assert.ok(!scripts.includes("'unsafe-inline'"), `script-src no debe traer unsafe-inline: ${scripts}`);
  });
});

describe('R4 · la puerta interna', () => {
  it('un secreto equivocado del mismo largo tampoco pasa', async () => {
    const mismoLargo = 'x'.repeat(SECRETOS_DE_PRUEBA.sso.length);
    const r = await e.pedir('POST', `${P}/api/sso/canjear`, {
      cuerpo: { codigo: 'x', modulo: 'cdh' },
      cabeceras: { 'x-cq-secreto': mismoLargo },
    });
    assert.equal(r.estado, 401);
  });

  it('si el servidor no tiene secreto configurado, /api/sso/* no existe', async () => {
    const sinSecreto = await levantarEntorno({ ssoSecreto: '', sembrar: false });
    const r = await sinSecreto.pedir('POST', `${P}/api/sso/canjear`, {
      cuerpo: { codigo: 'x', modulo: 'cdh' },
      cabeceras: { 'x-cq-secreto': 'lo-que-sea' },
    });
    assert.equal(r.estado, 404);
  });
});

describe('invariante 1 · el shell no escribe en la base del CDH', () => {
  it('sólo llama a las dos rutas de sesión del CDH', async () => {
    e.cdh.agregar('sistemas', true);
    await ana.pedir('PUT', `${P}/api/admin/usuarios/${ID.ana}/accesos/cdh`, { cuerpo: { usuario_modulo: 'sistemas' } });
    await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.beto}`, { cuerpo: { activo: false } });
    await ana.pedir('PATCH', `${P}/api/admin/usuarios/${ID.beto}`, { cuerpo: { activo: true } });

    assert.ok(e.cdh.llamadas.length > 0, 'debió hablar con el CDH');
    for (const llamada of e.cdh.llamadas) {
      assert.match(
        llamada.ruta,
        /^\/cdh\/api\/auth\/sso\/(usuario\/[^/]+|revocar)$/,
        `ruta inesperada al CDH: ${llamada.metodo} ${llamada.ruta}`,
      );
    }
  });

  it('siempre manda el secreto compartido al CDH', async () => {
    for (const llamada of e.cdh.llamadas) {
      assert.equal(llamada.secreto, SECRETOS_DE_PRUEBA.sso, `${llamada.metodo} ${llamada.ruta} fue sin secreto`);
    }
  });
});

describe('PRD §5 · el prefijo es configurable', () => {
  it('con CQ_BASE_PATH vacío el shell vive en la raíz', async () => {
    const raiz = await levantarEntorno({ basePath: '', sembrar: false });
    const r = await raiz.pedir('GET', '/api/salud');
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo, { ok: true, app: 'Core Quartz' });
  });

  it('la cookie usa el prefijo configurado como Path', async () => {
    const otro = await levantarEntorno({ basePath: '/shell', sembrar: false });
    otro.supabase.agregar('ana@quartz.example', CONTRASENA, ID.ana);
    const r = await otro.pedir('POST', '/shell/api/auth/entrar', {
      cuerpo: { correo: 'ana@quartz.example', contrasena: CONTRASENA },
    });
    assert.equal(r.estado, 200);
    assert.match(r.cookies.join(';'), /Path=\/shell/i);
  });
});
