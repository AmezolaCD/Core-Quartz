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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLAVES,
  CRM_REPO,
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

    // El orden importa: lo de Ana se sube antes de que se borre.
    const iSubida = nav.llamadas.findIndex((l) => l.url.includes('/rest/v1/') && l.metodo !== 'GET');
    const iVerify = nav.llamadas.findIndex((l) => l.url.includes('/auth/v1/verify'));
    assert.ok(iSubida >= 0, `debió intentarse subir lo pendiente; hubo: ${nav.llamadas.map((l) => `${l.metodo} ${l.url}`).join(' | ')}`);
    assert.ok(iSubida < iVerify, 'lo pendiente se sube ANTES de canjear el token nuevo');

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
    await nav.page.waitForTimeout(1_200);

    const visible = await nav.page.evaluate(() => document.body.innerText);
    const avisado = /Abre el CRM desde Core Quartz/.test(visible) ||
      /Abre el CRM desde Core Quartz/.test(String(document?.title ?? ''));
    assert.ok(avisado || nav.dialogos.some((d) => /Abre el CRM desde Core Quartz/.test(d)),
      `debió avisar; se vio: ${visible.slice(0, 200)} · diálogos: ${nav.dialogos.join(' | ')}`);
    assert.equal(nav.llamadas.filter((l) => l.url.includes('/auth/v1/verify')).length, 0,
      'sin dirección de nube no hay a quién preguntarle');
  });
});

describe('Regresión · el enlace de firma del cliente no cambia', () => {
  it('#firmar= sigue abriendo el documento del cliente', async () => {
    const nav = await abrirCrm({ fragmento: 'firmar=abcdef123456' });
    await nav.page.waitForTimeout(1_200);
    assert.deepEqual(nav.errores, []);
    assert.equal(nav.llamadas.filter((l) => l.url.includes('/auth/v1/verify')).length, 0,
      'una firma de cliente no canjea ningún token');
  });
});

describe('vercel.json · las reescrituras del portal y del CDH', () => {
  const vercel = JSON.parse(readFileSync(join(CRM_REPO, 'vercel.json'), 'utf8')) as {
    headers?: unknown[];
    rewrites?: Array<{ source: string; destination: string }>;
  };

  /**
   * Traduce el `source` de Vercel a una expresión regular.
   *
   * Se hace aquí y no con `path-to-regexp` a propósito: esa biblioteca sólo
   * está en el árbol como dependencia transitiva de Express y sólo se publica
   * como ESM, así que depender de ella sería frágil y además añadiría una
   * dependencia que el PRD §9 pide evitar. La sintaxis que usan estas dos
   * reglas es la mínima: `:nombre` y `:nombre*`.
   */
  const comoRegExp = (source: string): RegExp => {
    const patron = source
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:[A-Za-z_]\w*\*/g, '.*')
      .replace(/:[A-Za-z_]\w*/g, '[^/]+');
    return new RegExp(`^${patron}$`);
  };

  it('el archivo sigue siendo JSON válido y conserva la cabecera de caché', () => {
    assert.ok(Array.isArray(vercel.headers) && vercel.headers.length > 0,
      'el bloque headers no debe perderse');
  });

  it('reenvía /portal y /cdh, con y sin barra', () => {
    const fuentes = (vercel.rewrites ?? []).map((r) => r.source);
    const alcanza = (ruta: string) => (vercel.rewrites ?? []).some((r) => comoRegExp(r.source).test(ruta));

    assert.ok(fuentes.length >= 4, `faltan reescrituras; hay: ${JSON.stringify(fuentes)}`);
    for (const ruta of ['/portal', '/portal/', '/portal/api/salud', '/cdh', '/cdh/', '/cdh/api/health']) {
      assert.ok(alcanza(ruta), `ninguna reescritura alcanza ${ruta}`);
    }
  });

  it('no captura la raíz ni el propio index.html: el CRM se queda donde está', () => {
    const alcanza = (ruta: string) => (vercel.rewrites ?? []).some((r) => comoRegExp(r.source).test(ruta));
    for (const ruta of ['/', '/index.html', '/manifest.webmanifest', '/plantilla.csv']) {
      assert.ok(!alcanza(ruta), `la reescritura no debe capturar ${ruta}`);
    }
  });

  it('todas apuntan al mismo origen por HTTPS', () => {
    for (const r of vercel.rewrites ?? []) {
      assert.match(r.destination, /^https:\/\//, `${r.source} debe reenviar por HTTPS`);
    }
  });
});
