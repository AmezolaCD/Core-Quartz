/**
 * Fase 07: el portal visto desde un navegador de verdad.
 *
 * Levanta la aplicación completa de la fase 04 —con su Supabase y su CDH
 * simulados, que son servidores HTTP reales— y la abre con Chromium. No se
 * sustituye ningún módulo: lo que se prueba es lo que el navegador recibe.
 *
 * Los recorridos son los del PRD §7, con sus cinco personas:
 *
 *   Ana    admin, CRM + CDH      → ve el inicio (siempre, por ser admin)
 *   Beto   sólo CRM              → entrada directa al CRM
 *   Carla  sólo CDH              → entrada directa al CDH
 *   Dani   desactivada           → no entra (R2)
 *   Eva    CRM apagado, CDH vivo → un módulo visible, entrada directa
 *
 * Requiere `CQ_CHROMIUM_PATH` si Playwright no trae su navegador.
 */
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { ID, SECRETOS_DE_PRUEBA, levantarEntorno, sembrarListaCrm, type Entorno } from '../apoyo/app.ts';
import { alCerrar } from '../apoyo/pg.ts';

const CONTRASENA = 'contraseña-de-prueba';

/** Textos que el PRD fija palabra por palabra. */
const TEXTOS = {
  credenciales: 'Correo o contraseña incorrectos',
  desactivada: 'Tu cuenta está desactivada.',
  sinModulos: 'Aún no tienes módulos asignados. Pídeselo a Sistemas.',
} as const;

let e: Entorno;
let navegador: Browser;

/** Páginas abiertas por la prueba en curso; se cierran al terminar cada una. */
const paginas: Page[] = [];

/** Lo que una página nos deja ver de sí misma mientras corre la prueba. */
interface Vista {
  page: Page;
  /** Errores de consola y excepciones no atrapadas. */
  errores: string[];
}

before(async () => {
  e = await levantarEntorno();
  for (const [correo, id] of [
    ['ana@quartz.example', ID.ana],
    ['beto@quartz.example', ID.beto],
    ['carla@quartz.example', ID.carla],
    ['dani@quartz.example', ID.dani],
    ['eva@quartz.example', ID.eva],
  ] as const) {
    e.supabase.agregar(correo, CONTRASENA, id);
  }
  e.cdh.agregar('carla.ama', true);
  e.cdh.agregar('eva.rec', true);
  e.cdh.agregar('sistemas', true);
  e.cdh.agregar('libre.cdh', true);
  await sembrarListaCrm(e.pool, [
    'ana@quartz.example',
    'beto@quartz.example',
    'eva@quartz.example',
    'nueva@quartz.example',
  ]);
  navegador = await chromium.launch({ executablePath: process.env.CQ_CHROMIUM_PATH || undefined });
});

// Se cierra por `alCerrar` y no por un `after()` propio, para que el navegador
// se vaya antes que los servidores y la base (misma razón que la fase 04).
alCerrar(async () => {
  await navegador?.close().catch(() => undefined);
});

afterEach(async () => {
  for (const page of paginas.splice(0)) await page.close().catch(() => undefined);
});

/** Pestaña limpia —sin cookies ni almacenamiento heredado— ya en el portal. */
async function abrir(ruta = '/'): Promise<Vista> {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await contexto.newPage();
  paginas.push(page);
  const errores: string[] = [];
  page.on('console', (mensaje) => {
    if (mensaje.type() === 'error') errores.push(mensaje.text());
  });
  page.on('pageerror', (error) => errores.push(String(error)));
  await page.goto(`${e.base}${ruta}`, { waitUntil: 'load' });
  return { page, errores };
}

/** Llena el formulario de R2 y envía. No espera a dónde acaba. */
async function entrar(page: Page, correo: string, contrasena = CONTRASENA): Promise<void> {
  await page.getByLabel('Correo').fill(correo);
  await page.getByLabel('Contraseña').fill(contrasena);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Entra y espera a quedarse en el portal (sin entrada directa). */
async function entrarAlPortal(page: Page, correo: string): Promise<void> {
  await entrar(page, correo);
  await page.getByRole('button', { name: 'Salir' }).waitFor();
}

/** Lo que el navegador guardó por su cuenta. */
async function almacenamiento(page: Page): Promise<{ local: number; sesion: number }> {
  return page.evaluate(() => ({ local: localStorage.length, sesion: sessionStorage.length }));
}

/**
 * Controles sin nombre accesible. Se calcula en la página, con la cadena que
 * usa un lector de pantalla: `aria-label`, `aria-labelledby`, la etiqueta
 * asociada, `title`, o el texto del propio control cuando es un botón o enlace.
 */
async function sinNombreAccesible(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const anonimos: string[] = [];
    const controles = document.querySelectorAll('a[href], button, input, select, textarea');
    for (const control of controles) {
      const el = control as HTMLElement;
      if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') continue;
      if (el instanceof HTMLInputElement && el.type === 'hidden') continue;
      const porId = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      const porEnvoltura = el.closest('label');
      const referido = (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      const nombre = [
        el.getAttribute('aria-label') ?? '',
        referido,
        porId?.textContent ?? '',
        porEnvoltura?.textContent ?? '',
        el.getAttribute('title') ?? '',
        el instanceof HTMLInputElement ? '' : (el.textContent ?? ''),
      ]
        .join(' ')
        .trim();
      if (nombre === '') anonimos.push(el.outerHTML.slice(0, 120));
    }
    return anonimos;
  });
}

describe('la página del portal se sirve', () => {
  it('`/portal/` devuelve HTML, no el JSON de «No encontrado»', async () => {
    const respuesta = await e.pedir('GET', '/portal/');
    assert.equal(respuesta.estado, 200);
    assert.match(respuesta.cabeceras.get('content-type') ?? '', /text\/html/);
    assert.match(respuesta.texto, /<html/i);
  });

  it('carga sin un solo error de consola', async () => {
    const { errores } = await abrir();
    assert.deepEqual(errores, []);
  });

  it('el HTML y el JS servidos no traen ningún secreto', async () => {
    // Invariante §5: el repo del shell es público y estos archivos van al
    // navegador tal cual. Se revisa lo que de verdad sale por HTTP.
    const inicio = await e.pedir('GET', '/portal/');
    const rutas = [...inicio.texto.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1] ?? '');
    assert.ok(rutas.length > 0, 'la página no enlaza ningún archivo propio');

    const prohibidos = [
      SECRETOS_DE_PRUEBA.serviceRole,
      SECRETOS_DE_PRUEBA.sso,
      e.config.databaseUrl,
      'service_role',
      'DATABASE_URL',
    ];
    for (const ruta of ['', ...rutas]) {
      const archivo = await e.pedir('GET', `/portal/${ruta.replace(/^\.?\//, '')}`);
      for (const secreto of prohibidos) {
        assert.ok(!archivo.texto.includes(secreto), `«${secreto}» aparece en /portal/${ruta}`);
      }
    }
  });

  it('el portal no toca `localStorage` ni `sessionStorage`', async () => {
    // Comparte origen con el CRM (PRD §5): lo que guarde aquí lo ve allá.
    const { page } = await abrir();
    assert.deepEqual(await almacenamiento(page), { local: 0, sesion: 0 });
    await entrarAlPortal(page, 'ana@quartz.example');
    assert.deepEqual(await almacenamiento(page), { local: 0, sesion: 0 });
  });
});

describe('R2 · entrar', () => {
  it('Ana entra con su correo y su contraseña', async () => {
    const { page } = await abrir();
    await entrarAlPortal(page, 'ana@quartz.example');
    await page.getByText('Ana').first().waitFor();
  });

  it('contraseña equivocada: el texto de R2, y sigue en la pantalla de entrada', async () => {
    const { page } = await abrir();
    await entrar(page, 'ana@quartz.example', 'no-es');
    await page.getByRole('alert').filter({ hasText: TEXTOS.credenciales }).waitFor();
    await page.getByRole('button', { name: 'Entrar' }).waitFor();
  });

  it('Dani está desactivada: el texto de R2, y no entra', async () => {
    const { page } = await abrir();
    await entrar(page, 'dani@quartz.example');
    await page.getByRole('alert').filter({ hasText: TEXTOS.desactivada }).waitFor();
    await page.getByRole('button', { name: 'Entrar' }).waitFor();
  });

  it('la contraseña nunca viaja en la dirección', async () => {
    const { page } = await abrir();
    await entrarAlPortal(page, 'ana@quartz.example');
    assert.ok(!page.url().includes(CONTRASENA));
  });
});

describe('R1 · el inicio', () => {
  it('Ana es admin y ve el inicio con sus dos módulos', async () => {
    const { page } = await abrir();
    await entrarAlPortal(page, 'ana@quartz.example');
    await page.getByRole('link', { name: 'CRM' }).waitFor();
    await page.getByRole('link', { name: 'Control de habitaciones' }).waitFor();
  });

  it('Ana ve el enlace de Administración; Carla no', async () => {
    const admin = await abrir();
    await entrarAlPortal(admin.page, 'ana@quartz.example');
    await admin.page.getByRole('link', { name: 'Administración' }).waitFor();

    // Carla entra directo, así que se la trae de vuelta con `?inicio=1`.
    const suya = await abrir();
    await entrar(suya.page, 'carla@quartz.example');
    await suya.page.waitForURL(/\/cdh\/api\/auth\/sso/);
    await suya.page.goto(`${e.base}/?inicio=1`);
    await suya.page.getByRole('button', { name: 'Salir' }).waitFor();
    assert.equal(await suya.page.getByRole('link', { name: 'Administración' }).count(), 0);
  });

  it('a quien no es admin, la API de administración le responde 403', async () => {
    const { page } = await abrir();
    await entrar(page, 'carla@quartz.example');
    await page.waitForURL(/\/cdh\/api\/auth\/sso/);
    await page.goto(`${e.base}/?inicio=1`);
    const estado = await page.evaluate(async (base) => {
      const r = await fetch(`${base}/api/admin/usuarios`, { credentials: 'same-origin' });
      return r.status;
    }, e.base);
    assert.equal(estado, 403);
  });

  it('sin módulos visibles: el mensaje de R1, y ninguna redirección', async () => {
    // A Eva se le apaga el único acceso que le quedaba vivo.
    await e.pool.query(`UPDATE core.accesos SET activo = false WHERE usuario_id = $1::uuid`, [ID.eva]);
    try {
      const { page } = await abrir();
      await entrar(page, 'eva@quartz.example');
      await page.getByText(TEXTOS.sinModulos).waitFor();
      assert.ok(page.url().startsWith(`${e.base}/`), `se fue a ${page.url()}`);
    } finally {
      await e.pool.query(
        `UPDATE core.accesos SET activo = true WHERE usuario_id = $1::uuid AND modulo = 'cdh'`,
        [ID.eva],
      );
    }
  });
});

describe('entrada directa al único módulo', () => {
  it('Carla sólo tiene el CDH: acaba allá sin pulsar nada', async () => {
    const { page } = await abrir();
    await entrar(page, 'carla@quartz.example');
    await page.waitForURL(/\/cdh\/api\/auth\/sso\?codigo=/);
  });

  it('Beto sólo tiene el CRM: acaba allá sin pulsar nada', async () => {
    const { page } = await abrir();
    await entrar(page, 'beto@quartz.example');
    await page.waitForURL(/#nube=.*&cq=/);
  });

  it('Eva ve un solo módulo —el CRM lo tiene apagado— y también entra directo', async () => {
    const { page } = await abrir();
    await entrar(page, 'eva@quartz.example');
    await page.waitForURL(/\/cdh\/api\/auth\/sso\?codigo=/);
  });

  it('Ana es admin: aunque le quede un solo módulo, ve el inicio', async () => {
    // Si se la mandara al módulo, no tendría por dónde llegar a administración.
    await e.pool.query(
      `UPDATE core.accesos SET activo = false WHERE usuario_id = $1::uuid AND modulo = 'crm'`,
      [ID.ana],
    );
    try {
      const { page } = await abrir();
      await entrarAlPortal(page, 'ana@quartz.example');
      await page.getByRole('link', { name: 'Administración' }).waitFor();
      await page.getByRole('link', { name: 'Control de habitaciones' }).waitFor();
    } finally {
      await e.pool.query(
        `UPDATE core.accesos SET activo = true WHERE usuario_id = $1::uuid AND modulo = 'crm'`,
        [ID.ana],
      );
    }
  });

  it('volver con sesión viva también dispara la entrada directa', async () => {
    const { page } = await abrir();
    await entrar(page, 'carla@quartz.example');
    await page.waitForURL(/\/cdh\/api\/auth\/sso/);
    await page.goto(`${e.base}/`);
    await page.waitForURL(/\/cdh\/api\/auth\/sso/);
  });

  it('`?inicio=1` muestra el inicio, y no deja el estado pegado', async () => {
    const { page } = await abrir();
    await entrar(page, 'carla@quartz.example');
    await page.waitForURL(/\/cdh\/api\/auth\/sso/);

    await page.goto(`${e.base}/?inicio=1`);
    await page.getByRole('link', { name: 'Control de habitaciones' }).waitFor();

    // La siguiente entrada vuelve a ser directa: no se recordó nada.
    await page.goto(`${e.base}/`);
    await page.waitForURL(/\/cdh\/api\/auth\/sso/);
  });

  it('desde la entrada directa se puede volver y cerrar sesión', async () => {
    const { page } = await abrir();
    await entrar(page, 'carla@quartz.example');
    await page.waitForURL(/\/cdh\/api\/auth\/sso/);

    await page.goto(`${e.base}/?inicio=1`);
    await page.getByRole('button', { name: 'Salir' }).click();
    await page.getByRole('button', { name: 'Entrar' }).waitFor();

    // Y de verdad salió: volver al portal ya no la reconoce.
    await page.goto(`${e.base}/`);
    await page.getByRole('button', { name: 'Entrar' }).waitFor();
  });
});

describe('administración', () => {
  async function comoAna(): Promise<Page> {
    const { page } = await abrir();
    await entrarAlPortal(page, 'ana@quartz.example');
    await page.getByRole('link', { name: 'Administración' }).click();
    await page.getByRole('heading', { name: 'Administración' }).waitFor();
    return page;
  }

  it('da de alta a una persona nueva con su contraseña temporal', async () => {
    const page = await comoAna();
    await page.getByRole('button', { name: 'Agregar persona' }).click();
    await page.getByLabel('Correo').fill('nueva@quartz.example');
    await page.getByLabel('Nombre').fill('Nueva');
    await page.getByLabel('Contraseña temporal').fill('temporal-de-prueba');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.getByText('nueva@quartz.example').waitFor();
  });

  it('un usuario del CDH ya ligado: el error de R7, nombrando a quien lo tiene', async () => {
    const page = await comoAna();
    await page.getByRole('button', { name: 'Eva' }).click();
    await page.getByLabel('Usuario del CDH').fill('carla.ama');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.getByRole('alert').filter({ hasText: 'ya está ligado a Carla' }).waitFor();
  });

  it('dar de baja con el CDH caído deja el aviso, y «Reintentar» lo resuelve', async () => {
    const page = await comoAna();
    e.cdh.caido = true;
    try {
      await page.getByRole('button', { name: 'Carla' }).click();
      await page.getByRole('button', { name: 'Desactivar' }).click();
      await page.getByRole('alert').filter({ hasText: 'revocación' }).waitFor();
    } finally {
      e.cdh.caido = false;
    }
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await page.getByRole('alert').filter({ hasText: 'revocación' }).waitFor({ state: 'detached' });
  });

  it('la bitácora se puede leer desde la interfaz', async () => {
    const page = await comoAna();
    await page.getByRole('tab', { name: 'Bitácora' }).click();
    await page.getByRole('table').waitFor();
  });
});

describe('adaptable y accesible', () => {
  for (const [nombre, ancho, alto] of [
    ['celular', 360, 740],
    ['escritorio', 1280, 800],
  ] as const) {
    it(`a ${ancho}×${alto} (${nombre}) no hay desplazamiento horizontal`, async () => {
      const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto } });
      const page = await contexto.newPage();
      paginas.push(page);

      const cabe = async (donde: string) => {
        const medida = await page.evaluate(() => ({
          ancho: document.documentElement.scrollWidth,
          ventana: window.innerWidth,
        }));
        assert.ok(medida.ancho <= medida.ventana, `${donde}: ${medida.ancho} > ${medida.ventana}`);
      };

      await page.goto(`${e.base}/`);
      await cabe('entrar');

      await entrar(page, 'ana@quartz.example');
      await page.getByRole('button', { name: 'Salir' }).waitFor();
      await cabe('inicio');

      await page.getByRole('link', { name: 'Administración' }).click();
      await page.getByRole('heading', { name: 'Administración' }).waitFor();
      await cabe('administración');
    });
  }

  it('todos los controles tienen nombre accesible', async () => {
    const { page } = await abrir();
    assert.deepEqual(await sinNombreAccesible(page), [], 'en la pantalla de entrada');

    await entrarAlPortal(page, 'ana@quartz.example');
    assert.deepEqual(await sinNombreAccesible(page), [], 'en el inicio');

    await page.getByRole('link', { name: 'Administración' }).click();
    await page.getByRole('heading', { name: 'Administración' }).waitFor();
    assert.deepEqual(await sinNombreAccesible(page), [], 'en administración');
  });
});
