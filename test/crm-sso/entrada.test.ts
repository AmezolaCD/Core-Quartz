/**
 * R5 visto desde el CRM (fase 06): el portal manda `#nube=…&cq=<token_hash>` y
 * el CRM abre **su propia** sesión con ese token.
 *
 * Se sirve el `index.html` real del clon y se intercepta Supabase en el
 * navegador. El CRM es un solo archivo sin herramientas, así que sus pruebas
 * viven aquí (decisión #29).
 *
 *   CRM_REPO=../CRM-VENTAS- npm run test:crm-sso
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAVES,
  NUBE,
  abrirCrm,
  esperarLlamada,
  fragmentoNube,
  sesionDe,
} from '../apoyo/supabase-navegador.ts';

const TOKEN = 'hashed-token-de-prueba';
const YO = 'beto@quartz.example';
const OTRA = 'ana@quartz.example';

/** Configuración de nube ya guardada, como un equipo que ya venía usándose. */
const nubeGuardada = (enlazado = true) =>
  JSON.stringify({ url: NUBE.url, anon: NUBE.anon, enlazado });

describe('R5 · llegar del portal con #cq=', () => {
  it('verifica el token una sola vez y deja la barra de direcciones limpia', async () => {
    const nav = await abrirCrm({
      fragmento: `${fragmentoNube()}&cq=${TOKEN}`,
      verify: { ok: true, sesion: { correo: YO } },
    });

    const llamada = await esperarLlamada(nav, '/auth/v1/verify');
    assert.equal(llamada.metodo, 'POST');
    assert.deepEqual(llamada.cuerpo, { type: 'magiclink', token_hash: TOKEN });

    const verificaciones = nav.llamadas.filter((l) => l.url.includes('/auth/v1/verify'));
    assert.equal(verificaciones.length, 1, 'el token se canjea una sola vez');

    // El fragmento se borra antes de que alcance a entrar al historial.
    assert.equal(new URL(nav.page.url()).hash, '');
  });

  it('guarda la sesión igual que el acceso con contraseña', async () => {
    const nav = await abrirCrm({
      fragmento: `${fragmentoNube()}&cq=${TOKEN}`,
      verify: { ok: true, sesion: { correo: YO } },
    });
    await esperarLlamada(nav, '/auth/v1/verify');
    await nav.page.waitForTimeout(600);

    const guardado = (await nav.almacen())[CLAVES.sesion];
    assert.ok(guardado, 'debió quedar una sesión guardada');
    const sesion = JSON.parse(guardado) as { access_token: string; user: { email: string } };
    assert.equal(sesion.user.email, YO);
    assert.ok(sesion.access_token, 'sin token no hay sesión utilizable');
  });

  it('entra al CRM: ya no se ve la pantalla de acceso', async () => {
    const nav = await abrirCrm({
      fragmento: `${fragmentoNube()}&cq=${TOKEN}`,
      verify: { ok: true, sesion: { correo: YO } },
    });
    await esperarLlamada(nav, '/auth/v1/verify');
    await nav.page.waitForTimeout(800);
    assert.equal(await nav.page.locator('#entrada').count(), 0,
      'con sesión válida no debe pedirse correo y contraseña');
  });

  it('no deja errores en la consola', async () => {
    const nav = await abrirCrm({
      fragmento: `${fragmentoNube()}&cq=${TOKEN}`,
      verify: { ok: true, sesion: { correo: YO } },
    });
    await esperarLlamada(nav, '/auth/v1/verify');
    await nav.page.waitForTimeout(800);
    assert.deepEqual(nav.errores, []);
  });
});

describe('R5 · el enlace ya no sirve', () => {
  it('Supabase lo rechaza: pantalla de entrada con el mensaje del PRD', async () => {
    const nav = await abrirCrm({
      fragmento: `${fragmentoNube()}&cq=${TOKEN}`,
      verify: { ok: false, estado: 401, mensaje: 'Token has expired or is invalid' },
    });
    await esperarLlamada(nav, '/auth/v1/verify');
    await nav.page.waitForSelector('#entrada', { timeout: 8_000 });

    const texto = await nav.page.locator('#entrada').innerText();
    assert.match(texto, /El enlace ya se usó; entra desde Core Quartz otra vez/);
  });

  it('y no deja ninguna sesión a medias', async () => {
    const nav = await abrirCrm({
      fragmento: `${fragmentoNube()}&cq=${TOKEN}`,
      verify: { ok: false, estado: 401, mensaje: 'Token has expired or is invalid' },
    });
    await esperarLlamada(nav, '/auth/v1/verify');
    await nav.page.waitForTimeout(600);
    assert.equal((await nav.almacen())[CLAVES.sesion], null);
  });
});

describe('R5 · ya había una sesión en este navegador', () => {
  it('de otro correo: primero sube lo pendiente, luego borra la copia local', async () => {
    const nav = await abrirCrm({
      fragmento: `cq=${TOKEN}`,
      almacen: {
        [CLAVES.nube]: nubeGuardada(),
        [CLAVES.sesion]: JSON.stringify(sesionDe(OTRA)),
        // Una cartera con datos de quien estaba antes.
        [CLAVES.estado]: JSON.stringify({
          clientes: [{ id: 'c9', empresa: 'Pendiente de Ana', estatus: 'contactado' }],
          convenios: [], huespedes: [], ajustes: {},
        }),
      },
      verify: { ok: true, sesion: { correo: YO } },
      filas: [],
    });

    await esperarLlamada(nav, '/auth/v1/verify');
    await nav.page.waitForTimeout(900);

    // Lo que de verdad importa no es el orden contra `verify`, sino **con qué
    // sesión** se sube: lo pendiente de Ana tiene que salir con el token de
    // Ana, mientras el suyo sigue puesto. Si saliera con el de Beto, el
    // servidor lo rechazaría o —peor— lo guardaría a nombre equivocado.
    const subida = nav.llamadas.find((l) => l.url.includes('/rest/v1/') && l.metodo !== 'GET');
    assert.ok(subida, `debió intentarse subir lo pendiente; hubo: ${nav.llamadas.map((l) => `${l.metodo} ${l.url}`).join(' | ')}`);
    const autorizacion = subida?.cabeceras.authorization ?? '';
    assert.match(autorizacion, /token-de-prueba/, 'lo pendiente se sube con la sesión de quien se va');

    // Y la cartera de quien se fue no se queda para el que llega.
    const estado = JSON.parse((await nav.almacen())[CLAVES.estado] ?? '{}') as { clientes?: unknown[] };
    assert.ok(!(estado.clientes ?? []).some((c) => (c as { id?: string }).id === 'c9'),
      'la copia local de la sesión anterior debe borrarse');
  });

  it('del mismo correo: no se borra nada', async () => {
    const nav = await abrirCrm({
      fragmento: `cq=${TOKEN}`,
      almacen: {
        [CLAVES.nube]: nubeGuardada(),
        [CLAVES.sesion]: JSON.stringify(sesionDe(YO)),
        [CLAVES.estado]: JSON.stringify({
          clientes: [{ id: 'c7', empresa: 'Cartera de Beto', estatus: 'ganado' }],
          convenios: [], huespedes: [], ajustes: {},
        }),
      },
      verify: { ok: true, sesion: { correo: YO } },
      filas: [],
    });

    await esperarLlamada(nav, '/auth/v1/verify');
    await nav.page.waitForTimeout(900);

    const estado = JSON.parse((await nav.almacen())[CLAVES.estado] ?? '{}') as { clientes?: unknown[] };
    assert.ok((estado.clientes ?? []).some((c) => (c as { id?: string }).id === 'c7'),
      'es la misma persona: su cartera no se toca');
  });
});

describe('R5 · llega cq sin configuración de nube', () => {
  it('lo dice en lugar de fallar en silencio', async () => {
    const nav = await abrirCrm({ fragmento: `cq=${TOKEN}` });
    // El arranque espera a `entradaLista`, que se resuelve con la animación o
    // a los 3.5 s; antes de eso no ha corrido nada de lo que se está probando.
    await nav.page.waitForTimeout(4_500);

    const visible = await nav.page.evaluate(() => document.body.innerText);
    const avisado = /Abre el CRM desde Core Quartz/.test(visible) ||
      nav.dialogos.some((d) => /Abre el CRM desde Core Quartz/.test(d));
    assert.ok(avisado,
      `debió avisar; se vio: ${visible.slice(0, 200)} · diálogos: ${nav.dialogos.join(' | ')}`);
    assert.equal(nav.llamadas.filter((l) => l.url.includes('/auth/v1/verify')).length, 0,
      'sin dirección de nube no hay a quién preguntarle');
  });
});

describe('Regresión · el enlace de firma del cliente no cambia', () => {
  it('#firmar= sigue abriendo el documento del cliente', async () => {
    const nav = await abrirCrm({ fragmento: 'firmar=abcdef123456' });
    await nav.page.waitForTimeout(4_500);   // como arriba: la animación de entrada
    assert.deepEqual(nav.errores, []);
    assert.equal(nav.llamadas.filter((l) => l.url.includes('/auth/v1/verify')).length, 0,
      'una firma de cliente no canjea ningún token');
  });
});
