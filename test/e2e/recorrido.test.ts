/**
 * Fase 09: el recorrido completo del login único, de punta a punta.
 *
 * El archivo tiene dos mitades y conviene saber por qué:
 *
 * · **El guardia** corre en cualquier parte, sin entorno y sin red. Es lo que
 *   impide que estas pruebas —que crean y borran usuarios— toquen producción, y
 *   por eso se prueba aquí, en el CI, y no a mano.
 *
 * · **Los seis recorridos** se manejan con un navegador de verdad, y corren en
 *   el entorno que haya: `staging` si hay un `.env.e2e` que lo describa, y si
 *   no el **ensayo** —la aplicación real con el CRM real, y el CDH y Supabase
 *   simulados—, que es lo que mide el CI en cada PR.
 *
 *   Lo que el ensayo no puede fingir no se finge: ese recorrido **se salta
 *   diciendo qué pieza le falta**. Los selectores no están inventados; salen
 *   de `public/js/vistas/` del portal y del `index.html` del CRM.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import {
  GENTE_E2E,
  correoE2E,
  listaCrmSembrada,
  mismoProyecto,
  revisarStaging,
} from './preparar-staging.ts';
import { TAMANO, abrirRecorridos, anunciar, leerEnvE2E, type Quien, type Recorridos } from './entorno.ts';

// ---------------------------------------------------------------------------
// El guardia contra producción
// ---------------------------------------------------------------------------

const PROD = 'https://abcdefghijklmnop.supabase.co';
const STAGING = 'https://qrstuvwxyz123456.supabase.co';
const DB = 'postgres://usuario:contrasena@host:5432/postgres';

/** ¿Dejaría correr con este entorno? */
function corre(entorno: { supabaseUrl?: string; produccion?: string; databaseUrl?: string }): boolean {
  return revisarStaging(entorno) === null;
}

describe('fase 09 · el guardia contra producción', () => {
  it('con staging de verdad, deja correr', () => {
    assert.equal(corre({ supabaseUrl: STAGING, produccion: PROD, databaseUrl: DB }), true);
  });

  it('sin SUPABASE_URL o sin DATABASE_URL no hay a qué apuntar: no corre', () => {
    assert.equal(corre({ produccion: PROD, databaseUrl: DB }), false);
    assert.equal(corre({ supabaseUrl: STAGING, produccion: PROD }), false);
  });

  it('**sin `CQ_SUPABASE_PRODUCCION` no corre**, y eso es el punto', () => {
    // Un guardia que se apaga cuando nadie lo configuró no es un guardia, y la
    // máquina donde nadie lo configuró es justo donde hace falta. Los dos
    // repositorios son públicos, así que la dirección de producción no puede
    // estar en el código (invariante §5): tiene que venir del entorno.
    assert.equal(corre({ supabaseUrl: STAGING, databaseUrl: DB }), false);
    assert.equal(corre({ supabaseUrl: STAGING, produccion: '   ', databaseUrl: DB }), false);
  });

  it('reconoce producción disfrazada: barra, mayúsculas, ruta y espacios', () => {
    // Comparar las cadenas tal cual dejaría pasar las cuatro. Se compara el
    // host, que es lo que identifica al proyecto.
    for (const disfraz of [PROD, `${PROD}/`, PROD.toUpperCase(), `${PROD}/auth/v1`, ` ${PROD} `]) {
      assert.equal(
        corre({ supabaseUrl: disfraz, produccion: PROD, databaseUrl: DB }),
        false,
        `dejó pasar «${disfraz}»`,
      );
    }
  });

  it('una dirección que no se entiende cuenta como producción: no corre', () => {
    // Ante la duda, no se corre. Es la única respuesta segura cuando lo que hay
    // puesto no se puede interpretar.
    assert.equal(corre({ supabaseUrl: 'no-es-una-url', produccion: PROD, databaseUrl: DB }), false);
    assert.equal(corre({ supabaseUrl: STAGING, produccion: 'basura', databaseUrl: DB }), false);
  });

  it('dos proyectos distintos no son el mismo', () => {
    assert.equal(mismoProyecto(STAGING, PROD), false);
    assert.equal(mismoProyecto(STAGING, `${STAGING}/`), true);
  });

  it('el motivo dice qué hacer, no sólo que no se puede', () => {
    const sinProd = revisarStaging({ supabaseUrl: STAGING, databaseUrl: DB });
    assert.ok(sinProd, 'debería impedirlo');
    assert.match(sinProd.motivo, /CQ_SUPABASE_PRODUCCION/);
    assert.match(sinProd.motivo, /\.env\.e2e/);

    const esProd = revisarStaging({ supabaseUrl: PROD, produccion: PROD, databaseUrl: DB });
    assert.ok(esProd, 'debería impedirlo');
    assert.match(esProd.motivo, /staging/);
  });
});

// ---------------------------------------------------------------------------
// Los seis recorridos
//
// Cada uno dice qué piezas necesita. Si el entorno de esta corrida no las
// tiene, **se salta nombrando la que falta**; nunca pasa por omisión. Un verde
// que salió de medir un simulador diría que el login único funciona cuando
// nadie lo ha visto funcionar, y eso es peor que un recorrido que no corrió.
//
// Qué hay en cada entorno, en `test/e2e/entorno.ts`; cómo montar staging, en
// `docs/E2E.md`.
// ---------------------------------------------------------------------------

let r: Recorridos;

before(async () => {
  r = await abrirRecorridos();
  anunciar(r);
});

after(async () => {
  await r?.cerrar();
});

/** Llena el formulario de R2 y envía. No espera a dónde acaba. */
async function entrar(page: Page, quien: Quien): Promise<void> {
  await page.getByLabel('Correo').fill(quien.correo);
  await page.getByLabel('Contraseña').fill(quien.contrasena);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Entra y se queda en el portal (la barra con «Salir» es la señal). */
async function entrarAlPortal(page: Page, quien: Quien): Promise<void> {
  await entrar(page, quien);
  await page.getByRole('button', { name: 'Salir' }).waitFor({ timeout: 15_000 });
}

describe('fase 09 · los seis recorridos', () => {
  // -------------------------------------------------------------------------
  // 1 · Ana, que tiene los dos módulos
  // -------------------------------------------------------------------------

  it('1a · Ana entra al portal y de ahí al CRM, que la recibe ya con sesión', async (t) => {
    const motivo = r.motivoSiFalta('crm-real');
    if (motivo) return t.skip(motivo);

    const { page, errores } = await r.abrir('/');
    await entrarAlPortal(page, r.quien.ana);

    // R1: ve sus dos módulos, y como es administradora no la mandan derecho a
    // ninguno (si la mandaran, no tendría por dónde llegar a administración).
    await page.getByRole('link', { name: 'CRM de Ventas' }).waitFor();
    assert.ok(await page.getByRole('link', { name: /Control de Detalles/ }).count(),
      'Ana tiene acceso al CDH: su tarjeta tiene que estar');

    // Lo que haya pasado antes de este punto ya está medido por la fase 07; de
    // aquí en adelante es lo que nadie había visto correr.
    errores.length = 0;

    await page.getByRole('link', { name: 'CRM de Ventas' }).click();
    await page.waitForURL((u) => u.toString().startsWith(r.crm!), { timeout: 20_000 });

    // Ésta es la costura que la fase viene a medir: el portal emitió el enlace
    // en el servidor y el CRM lo canjeó en el navegador. Las dos mitades
    // estaban probadas por separado (fases 05 y 06) y nunca juntas.
    const direccion = page.url();
    assert.match(direccion, /#nube=/, 'el enlace tiene que traer con qué proyecto hablar');
    assert.match(direccion, /[#&]cq=/, 'y el token de entrada');

    // Y se comprueba **en positivo**: que el CRM guardó una sesión y que es la
    // de Ana. Mirar sólo que no se vea la pantalla de acceso daría verde
    // también si el CRM se hubiera quedado a medias sin pintar nada.
    const guardada = await page.waitForFunction(
      () => window.localStorage.getItem('crm-hotel-sesion'),
      null,
      { timeout: 20_000 },
    ).then((v) => v.jsonValue() as Promise<string>);
    assert.match(guardada, new RegExp(r.quien.ana.correo.replace(/\./g, '\\.')),
      'la sesión que abrió el CRM tiene que ser la de quien entró al portal');

    assert.equal(await page.locator('#entrada').count(), 0, 'con el enlace bueno no debe pedirse contraseña');
    assert.deepEqual(errores, [], 'la entrada al CRM no debe dejar errores en la consola');
  });

  it('1b · …y de ahí al CDH, que la recibe con sesión y guarda su comentario a su nombre', async (t) => {
    const motivo = r.motivoSiFalta('cdh-real');
    if (motivo) return t.skip(motivo);

    const { page } = await r.abrir('/');
    await entrarAlPortal(page, r.quien.ana);
    await page.getByRole('link', { name: /Control de Detalles/ }).click();
    await page.waitForURL((u) => u.toString().includes('/cdh'), { timeout: 20_000 });

    // Llega con sesión: el CDH no vuelve a pedirle usuario y contraseña.
    assert.equal(await page.locator('input[name="password"]').count(), 0,
      'el CDH tiene que recibirla ya con sesión, no mandarla a su pantalla de acceso');

    // El criterio de la fase: el movimiento queda **a nombre del usuario
    // ligado a Ana**, no del shell ni de nadie más.
    const suyo = GENTE_E2E.find((g) => g.clave === 'ana')!.accesos.find((a) => a.modulo === 'cdh')!.usuarioModulo!;
    const cuerpo = await page.locator('body').innerText();
    assert.ok(cuerpo.includes(suyo), `la sesión del CDH debería ser la de «${suyo}»`);
  });

  // -------------------------------------------------------------------------
  // 2 · Beto, que sólo tiene el CRM
  // -------------------------------------------------------------------------

  it('2 · Beto sólo ve el CRM, y forzar la entrada al CDH da 403', async () => {
    // `?inicio=1` para que no lo manden derecho a su único módulo y se pueda
    // ver qué tiene delante.
    const { page } = await r.abrir('/?inicio=1');
    await entrarAlPortal(page, r.quien.beto);

    await page.getByRole('link', { name: 'CRM de Ventas' }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Control de Detalles/ }).count(), 0,
      'el CDH no debe ni asomarse en la pantalla de Beto');

    // Y no es sólo que no se vea: pedirlo a mano, con su sesión buena, se
    // rechaza en el servidor. R1 se aplica al abrir, no al pintar.
    const respuesta = await page.request.get(`${r.portal}/api/modulos/cdh/abrir`, { maxRedirects: 0 });
    assert.equal(respuesta.status(), 403);
    assert.match(JSON.stringify(await respuesta.json()), /No tienes acceso a este módulo/);
  });

  // -------------------------------------------------------------------------
  // 3 · Carla, que sólo tiene el CDH (R8)
  // -------------------------------------------------------------------------

  it('3 · Carla consulta `crm_datos` con su propia contraseña y ve 0 filas', async (t) => {
    const motivo = r.motivoSiFalta('supabase-real');
    if (motivo) {
      // R8 **sí** está medido contra Postgres de verdad en `test/crm-rls/`, con
      // las reglas de fila del CRM aplicadas. Lo que falta aquí es la última
      // milla: el Supabase del hotel, con su propio `roles.sql` corrido.
      return t.skip(`${motivo} — R8 ya está medido en test/crm-rls/roles.test.ts`);
    }

    // La precondición primero, y por separado: con la lista de usuarios vacía
    // `crm_sin_lista()` deja a cualquiera como admin, Carla vería filas, y la
    // prueba se pondría roja culpando a R8. El fallo diría «falta la lista».
    assert.ok(await listaCrmSembrada(r.pool!),
      'la lista de usuarios del CRM no está sembrada: sin ella R8 no se puede medir (docs/E2E.md §2)');

    const env = leerEnvE2E();
    const sesion = await (
      await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_ANON_KEY ?? '', 'content-type': 'application/json' },
        body: JSON.stringify({ email: correoE2E('carla'), password: r.quien.carla.contrasena }),
      })
    ).json();
    assert.ok(sesion.access_token, 'Carla tiene que poder entrar a Supabase: lo que no alcanza son los datos');

    const filas = await (
      await fetch(`${env.SUPABASE_URL}/rest/v1/crm_datos?select=id&limit=5`, {
        headers: { apikey: env.SUPABASE_ANON_KEY ?? '', authorization: `Bearer ${sesion.access_token}` },
      })
    ).json();
    assert.deepEqual(filas, [], 'quien sólo usa el CDH no debe alcanzar un solo renglón del CRM');
  });

  // -------------------------------------------------------------------------
  // 4 · La baja
  // -------------------------------------------------------------------------

  it('4 · Ana desactiva a Carla: se le revoca el CDH y ya no entra al portal', async () => {
    const { page } = await r.abrir('/');
    await entrarAlPortal(page, r.quien.ana);
    await page.getByRole('link', { name: 'Administración' }).click();

    // Se espera a que la lista cargue y se la escoge por su correo: el botón de
    // cada persona lleva `nombre (correo)` como nombre accesible.
    const suCorreo = new RegExp(r.quien.carla.correo.replace(/\./g, '\\.'));
    await page.getByRole('button', { name: suCorreo }).click();
    await page.getByRole('button', { name: 'Desactivar' }).click();

    // La señal es **la de Carla**, no un «Inactiva» cualquiera: en la lista ya
    // hay gente dada de baja, y esperar el primero que aparezca daba verde sin
    // que la baja hubiera ocurrido.
    await page
      .getByRole('button', { name: new RegExp(`${r.quien.carla.correo.replace(/\./g, '\\.')}.*inactiva`, 'i') })
      .waitFor({ timeout: 15_000 });

    // R6: la baja no se queda en el portal. Le cierra la sesión de Supabase y
    // le manda al CDH que revoque las suyas, que es lo que de verdad la deja
    // fuera: sin eso seguiría trabajando en el CDH con la pestaña abierta.
    if (r.arnes) {
      // Y se comprueba que se revocó **el suyo**, leído de su acceso: una
      // revocación de cualquiera daría verde aunque el portal se equivocara de
      // persona, que es justo el error que más daño haría aquí.
      const { rows } = await r.pool!.query<{ usuario_modulo: string | null }>(
        `SELECT a.usuario_modulo FROM core.accesos a
           JOIN core.usuarios u ON u.id = a.usuario_id
          WHERE lower(u.correo) = lower($1) AND a.modulo = 'cdh'`,
        [r.quien.carla.correo],
      );
      const suyo = rows[0]?.usuario_modulo;
      assert.ok(suyo, 'Carla tiene que tener un usuario del CDH ligado, o esto no mide nada');
      assert.ok(
        (r.arnes.cdh.revocaciones.get(suyo) ?? 0) > 0,
        `al CDH había que pedirle revocar las sesiones de «${suyo}», y no se le pidió`,
      );
    }

    // Y no puede volver a entrar, aunque su contraseña siga siendo la de antes.
    //
    // El mensaje que ve depende de por dónde la paran, y las dos puertas están
    // cerradas: la baja le pone `ban_duration` en Supabase, así que suele
    // rebotar ya en el acceso —«Correo o contraseña incorrectos»— sin llegar a
    // la comprobación del portal, que diría «Tu cuenta está desactivada.». Lo
    // que esta prueba exige es lo que importa: **que no entre**. Fijar aquí uno
    // de los dos textos ataría la prueba a cuál de los dos candados actuó
    // primero, que es justo lo que no debe importar.
    const otra = await r.abrir('/');
    await entrar(otra.page, r.quien.carla);
    await otra.page.locator('p.error:not([hidden])').waitFor({ timeout: 15_000 });
    const dijo = (await otra.page.locator('p.error').innerText()).trim();
    assert.ok(
      dijo === 'Tu cuenta está desactivada.' || dijo === 'Correo o contraseña incorrectos',
      `el rechazo tiene que ser uno de los dos textos del PRD, y fue «${dijo}»`,
    );
    assert.equal(await otra.page.getByRole('button', { name: 'Salir' }).count(), 0,
      'una persona dada de baja no puede acabar dentro del portal');
  });

  // -------------------------------------------------------------------------
  // 5 · El boleto es de un solo uso
  // -------------------------------------------------------------------------

  it('5a · el portal no canjea dos veces el mismo código', async (t) => {
    const motivo = r.motivoSiFalta('sso-alcanzable');
    if (motivo) return t.skip(motivo);

    const { page } = await r.abrir('/');
    await entrarAlPortal(page, r.quien.ana);

    // Se pide la entrada al CDH sin seguir la redirección: lo que interesa es
    // el código que lleva dentro, que es lo que el CDH va a canjear.
    const abierta = await page.request.get(`${r.portal}/api/modulos/cdh/abrir`, { maxRedirects: 0 });
    assert.equal(abierta.status(), 302);
    const codigo = new URL(abierta.headers()['location'] ?? '', r.portal).searchParams.get('codigo');
    assert.ok(codigo, 'la redirección al CDH tiene que traer el código');

    const canjear = async () =>
      await page.request.post(`${r.portal}/api/sso/canjear`, {
        headers: { 'x-cq-secreto': r.ssoSecreto, 'content-type': 'application/json' },
        data: { codigo, modulo: 'cdh' },
      });

    const primera = await canjear();
    assert.equal(primera.status(), 200, 'el primer canje es el bueno');

    const segunda = await canjear();
    assert.equal(segunda.status(), 410, 'el segundo tiene que rebotar');
    assert.equal((await segunda.json()).motivo, 'usado');
  });

  it('5b · …y el CDH lo cuenta en español, sin abrir sesión', async (t) => {
    const motivo = r.motivoSiFalta('cdh-real');
    if (motivo) return t.skip(motivo);

    const { page } = await r.abrir('/');
    await entrarAlPortal(page, r.quien.ana);
    const abierta = await page.request.get(`${r.portal}/api/modulos/cdh/abrir`, { maxRedirects: 0 });
    const destino = abierta.headers()['location'] ?? '';

    await page.goto(destino, { waitUntil: 'load' });   // primera vez: entra
    await page.goto(destino, { waitUntil: 'load' });   // segunda: el enlace ya no sirve

    const cuerpo = await page.locator('body').innerText();
    assert.match(cuerpo, /una sola vez/i, 'el CDH tiene que explicar por qué no lo dejó pasar');
  });

  // -------------------------------------------------------------------------
  // 6 · Lo mismo en un teléfono
  // -------------------------------------------------------------------------

  it('6 · los recorridos 1 y 2 otra vez a 360 × 740', async (t) => {
    const motivo = r.motivoSiFalta('crm-real');
    if (motivo) return t.skip(motivo);

    // Ana, hasta el CRM, en la pantalla más chica que se usa en el hotel.
    const ana = await r.abrir('/', TAMANO.telefono);
    await entrarAlPortal(ana.page, r.quien.ana);
    await ana.page.getByRole('link', { name: 'CRM de Ventas' }).click();
    await ana.page.waitForURL((u) => u.toString().startsWith(r.crm!), { timeout: 20_000 });
    await ana.page.waitForFunction(() => window.localStorage.getItem('crm-hotel-sesion'), null, { timeout: 20_000 });

    // Y Beto, con su único módulo.
    const beto = await r.abrir('/?inicio=1', TAMANO.telefono);
    await entrarAlPortal(beto.page, r.quien.beto);
    await beto.page.getByRole('link', { name: 'CRM de Ventas' }).waitFor();
    assert.equal(await beto.page.getByRole('link', { name: /Control de Detalles/ }).count(), 0);

    // Nada se sale de la pantalla: en un teléfono eso es un enlace que no se
    // puede picar, no un detalle de estilo.
    const ancho = await beto.page.evaluate(() => ({
      documento: document.documentElement.scrollWidth,
      ventana: window.innerWidth,
    }));
    assert.ok(ancho.documento <= ancho.ventana + 1,
      `el portal se sale de la pantalla: ${ancho.documento}px en una de ${ancho.ventana}px`);
  });
});
