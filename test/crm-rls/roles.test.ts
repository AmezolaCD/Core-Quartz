/**
 * Fase 03 · R8: blindaje del CRM ante cuentas que no son de ventas (PRD §7-R8).
 *
 * Las pruebas viven aquí, en el repo del shell, pero el SQL que se prueba es el
 * **real del CRM**: se leen `nube.sql`, `roles.sql` y `firmas.sql` del clon que
 * apunte `CRM_REPO`, se cargan en el Postgres 16 local sobre un Supabase
 * simulado (`test/apoyo/supabase-simulado.sql`) y se consulta como `anon` y
 * como `authenticated`, igual que lo haría el navegador.
 *
 * Cada fila de la tabla R8 se prueba **dos veces**:
 *
 *   · «antes»   → contra el `roles.sql` tal como está **commiteado** en el CRM.
 *                 Documenta el hueco: una cuenta que no está en la lista cae
 *                 en el `ejecutivo` por omisión y alcanza a ver cosas.
 *   · «después» → contra el `roles.sql` del **árbol de trabajo** del CRM, que
 *                 es donde la fase 03 hace su único cambio.
 *
 * Mientras la fase 03 no toque `roles.sql`, las dos variantes son el mismo
 * archivo y las pruebas de «después» de Carla fallan. Eso es el rojo que se
 * espera aquí: falta implementación, no hay error de sintaxis.
 *
 * Variables de entorno:
 *   CRM_REPO      ruta al clon del CRM            (por omisión `../CRM-VENTAS-`)
 *   CRM_REF_BASE  referencia git de la línea base (por omisión, la primera de
 *                 `main`, `origin/main`, `origin/HEAD`, `HEAD` que exista)
 *   DATABASE_URL_TEST  Postgres de pruebas, nunca Supabase (PRD §9)
 *
 * Corre con:
 *   docker compose -f docker-compose.test.yml up -d pg
 *   CRM_REPO=../CRM-VENTAS- npm run test:crm-rls
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Dónde está cada cosa
// ---------------------------------------------------------------------------

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

/** Clon del CRM del que se leen los `.sql` reales. */
const CRM = path.resolve(RAIZ, process.env.CRM_REPO ?? '../CRM-VENTAS-');

/**
 * Postgres de pruebas. Se repite aquí en vez de importarlo de `test/apoyo/pg.ts`
 * a propósito: ese módulo crea su base y le corre las migraciones del esquema
 * `core` al importarlo, y estas pruebas necesitan justo lo contrario, una base
 * con el esquema del CRM y sin nada del portal.
 */
const URL_PRUEBAS = process.env.DATABASE_URL_TEST ?? 'postgres://postgres@127.0.0.1:54329/postgres';

const NOMBRE_VALIDO = /^cq_test_[0-9a-f]{12}$/;

const SIMULADO = readFileSync(path.join(RAIZ, 'test', 'apoyo', 'supabase-simulado.sql'), 'utf8');

// ---------------------------------------------------------------------------
// Leer el SQL del CRM
// ---------------------------------------------------------------------------

function git(...args: string[]): string {
  return execFileSync('git', ['-C', CRM, ...args], { encoding: 'utf8' });
}

function existeRef(ref: string): boolean {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Referencia de la línea base: el `roles.sql` «de antes».
 *
 * El PRD la nombra `main`; el CRM puede no tenerla (hoy su rama por omisión es
 * otra), así que se cae hacia la que sí exista y se deja dicho cuál se usó.
 */
function refBase(): string {
  const pedida = process.env.CRM_REF_BASE;
  if (pedida !== undefined && pedida !== '') {
    assert.ok(existeRef(pedida), `CRM_REF_BASE=${pedida} no existe en ${CRM}`);
    return pedida;
  }
  const candidatas = ['main', 'origin/main', 'origin/HEAD', 'HEAD'];
  const hallada = candidatas.find(existeRef);
  assert.ok(hallada, `ninguna de ${candidatas.join(', ')} existe en ${CRM}`);
  return hallada;
}

const REF_BASE = refBase();

/** El archivo tal como está commiteado en la línea base. */
function sqlCommiteado(archivo: string): string {
  return git('show', `${REF_BASE}:${archivo}`);
}

/** El archivo tal como está en el árbol de trabajo del CRM. */
function sqlDelArbol(archivo: string): string {
  return readFileSync(path.join(CRM, archivo), 'utf8');
}

type Variante = 'antes' | 'despues';

/** `roles.sql` de cada variante; lo demás siempre sale del árbol de trabajo. */
function rolesSql(variante: Variante): string {
  return variante === 'antes' ? sqlCommiteado('roles.sql') : sqlDelArbol('roles.sql');
}

// ---------------------------------------------------------------------------
// El juego de datos (uno solo, para que los conteos se puedan comparar)
// ---------------------------------------------------------------------------

/** Clave de firma del convenio de Beto, para las pruebas de `firmas.sql`. */
const CLAVE_V_BETO = 'clave-de-beto';

interface Fila {
  id: string;
  tipo: string;
  datos: Record<string, unknown>;
  duenio: string | null;
}

/**
 * Las cuatro personas de la lista del CRM (una por papel) y la cartera mínima
 * que hace visible cada rama de las políticas. Carla **no** está en la lista a
 * propósito: es la cuenta de sólo-CDH del PRD §7, y es el caso de R8.
 */
const SEMILLA: Fila[] = [
  { id: 'usuarios:ana', tipo: 'usuarios', datos: { correo: 'ana@quartz.example', nombre: 'Ana', rol: 'admin' }, duenio: null },
  { id: 'usuarios:gaby', tipo: 'usuarios', datos: { correo: 'gaby@quartz.example', nombre: 'Gaby', rol: 'gerente' }, duenio: null },
  { id: 'usuarios:beto', tipo: 'usuarios', datos: { correo: 'beto@quartz.example', nombre: 'Beto', rol: 'ejecutivo' }, duenio: null },
  { id: 'usuarios:cata', tipo: 'usuarios', datos: { correo: 'cata@quartz.example', nombre: 'Cata', rol: 'captura' }, duenio: null },
  { id: 'ajustes:global', tipo: 'ajustes', datos: { moneda: 'MXN' }, duenio: null },
  { id: 'habitaciones:h1', tipo: 'habitaciones', datos: { nombre: 'Suite' }, duenio: null },
  { id: 'clientes:c-beto', tipo: 'clientes', datos: { nombre: 'Cliente de Beto' }, duenio: 'Beto' },
  { id: 'clientes:c-gaby', tipo: 'clientes', datos: { nombre: 'Cliente de Gaby' }, duenio: 'Gaby' },
  { id: 'clientes:c-sin', tipo: 'clientes', datos: { nombre: 'Cliente sin dueño' }, duenio: null },
  { id: 'prospectos:p-cata', tipo: 'prospectos', datos: { nombre: 'Prospecto de Cata' }, duenio: 'Cata' },
  { id: 'prospectos:p-beto', tipo: 'prospectos', datos: { nombre: 'Prospecto de Beto' }, duenio: 'Beto' },
  { id: 'convenios:v-beto', tipo: 'convenios', datos: { nombre: 'Convenio de Beto', tokenFirma: CLAVE_V_BETO }, duenio: 'Beto' },
];

const TODO = SEMILLA.map((f) => f.id).sort();

/** Lo que todo el equipo necesita para armar un convenio (`roles.sql` §3). */
const CATALOGO = ['ajustes:global', 'habitaciones:h1', 'usuarios:ana', 'usuarios:beto', 'usuarios:cata', 'usuarios:gaby'];

/** Lo que ve un ejecutivo llamado Beto: el catálogo, lo suyo y lo que no tiene dueño. */
const DE_BETO = [...CATALOGO, 'clientes:c-beto', 'clientes:c-sin', 'convenios:v-beto', 'prospectos:p-beto'].sort();

/** `captura` (Banquetes): sus prospectos y nada más que ajustes y la lista de gente. */
const DE_CATA = ['ajustes:global', 'usuarios:ana', 'usuarios:beto', 'usuarios:cata', 'usuarios:gaby', 'prospectos:p-cata'].sort();

/** El hueco de R8: una cuenta fuera de la lista cae en el `ejecutivo` por omisión. */
const HUECO_DE_CARLA = [...CATALOGO, 'clientes:c-sin'].sort();

// ---------------------------------------------------------------------------
// Bases desechables
// ---------------------------------------------------------------------------

interface Base {
  nombre: string;
  pool: pg.Pool;
  destruir: () => Promise<void>;
}

async function conAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: URL_PRUEBAS });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

function urlDeBase(nombre: string): string {
  const u = new URL(URL_PRUEBAS);
  u.pathname = `/${nombre}`;
  return u.toString();
}

async function destruir(nombre: string, pool: pg.Pool | null): Promise<void> {
  if (!NOMBRE_VALIDO.test(nombre)) throw new Error(`no se borra una base ajena: ${nombre}`);
  if (pool) await pool.end().catch(() => undefined);
  await conAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`));
}

/** Base vacía con el Supabase simulado ya cargado. */
async function baseCruda(): Promise<Base> {
  const nombre = `cq_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  if (!NOMBRE_VALIDO.test(nombre)) throw new Error(`nombre de base inesperado: ${nombre}`);
  await conAdmin((c) => c.query(`CREATE DATABASE "${nombre}"`));

  let pool: pg.Pool | null = null;
  try {
    pool = new pg.Pool({ connectionString: urlDeBase(nombre), max: 8 });
    await pool.query(SIMULADO);
    const suyo = pool;
    return { nombre, pool: suyo, destruir: () => destruir(nombre, suyo) };
  } catch (error) {
    await destruir(nombre, pool);
    throw error;
  }
}

/** Carga el CRM en el orden en que se corre de verdad y siembra el juego de datos. */
async function baseDelCRM(variante: Variante): Promise<Base> {
  const base = await baseCruda();
  try {
    await base.pool.query(sqlDelArbol('nube.sql'));
    await base.pool.query(rolesSql(variante));
    await base.pool.query(sqlDelArbol('firmas.sql'));
    for (const f of SEMILLA) {
      await base.pool.query(
        `INSERT INTO public.crm_datos (id, tipo, datos, duenio) VALUES ($1, $2, $3::jsonb, $4)`,
        [f.id, f.tipo, JSON.stringify(f.datos), f.duenio],
      );
    }
    return base;
  } catch (error) {
    await base.destruir();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Consultar como lo haría el navegador
// ---------------------------------------------------------------------------

interface Actor {
  /** El rol de Postgres con el que PostgREST atendería la petición. */
  rol: 'anon' | 'authenticated';
  /** Correo del token; sin correo, no hay sesión. */
  correo?: string;
  /** Encabezados de la petición (`firmas.sql` lee `x-firma-token` de aquí). */
  encabezados?: Record<string, string>;
}

const ANA: Actor = { rol: 'authenticated', correo: 'ana@quartz.example' };
const GABY: Actor = { rol: 'authenticated', correo: 'gaby@quartz.example' };
const BETO: Actor = { rol: 'authenticated', correo: 'beto@quartz.example' };
const CATA: Actor = { rol: 'authenticated', correo: 'cata@quartz.example' };
/** Carla sólo tiene CDH: su correo no está en la lista de usuarios del CRM. */
const CARLA: Actor = { rol: 'authenticated', correo: 'carla@quartz.example' };

/**
 * Corre `fn` dentro de una transacción con el token, los encabezados y el rol
 * del actor, y la deshace siempre: ninguna prueba se escribe encima de otra.
 */
async function como<T>(base: Base, actor: Actor, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await base.pool.connect();
  try {
    await c.query('BEGIN');
    const token = actor.correo === undefined ? {} : { email: actor.correo, role: actor.rol };
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(token)]);
    await c.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify(actor.encabezados ?? {})]);
    await c.query(`SET LOCAL ROLE ${actor.rol}`);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

/** Los ids de `crm_datos` que ese actor alcanza a ver, ordenados. */
async function loQueVe(base: Base, actor: Actor): Promise<string[]> {
  return como(base, actor, async (c) => {
    const { rows } = await c.query<{ id: string }>(`SELECT id FROM public.crm_datos ORDER BY id`);
    return rows.map((r) => r.id);
  });
}

/** Cuántas filas de la bitácora alcanza a ver. */
async function bitacoraQueVe(base: Base, actor: Actor): Promise<number> {
  return como(base, actor, async (c) => {
    const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM public.crm_bitacora`);
    return Number(rows[0]?.n ?? 0);
  });
}

/** Intenta insertar un cliente nuevo. Devuelve `null` si pasó, o el mensaje si lo rechazaron. */
async function intentaInsertar(base: Base, actor: Actor, tipo = 'clientes'): Promise<string | null> {
  return como(base, actor, async (c) => {
    try {
      await c.query(`INSERT INTO public.crm_datos (id, tipo, datos) VALUES ($1, $2, '{}'::jsonb)`, [
        `${tipo}:colado-${randomUUID().slice(0, 8)}`,
        tipo,
      ]);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}

/** Cuántas filas alcanzó a modificar un UPDATE. Con la política en contra, cero. */
async function intentaEditar(base: Base, actor: Actor, id: string): Promise<number> {
  return como(base, actor, async (c) => {
    const r = await c.query(`UPDATE public.crm_datos SET datos = datos || '{"tocado":true}'::jsonb WHERE id = $1`, [id]);
    return r.rowCount ?? 0;
  });
}

// ---------------------------------------------------------------------------
// Las dos bases, una por variante
// ---------------------------------------------------------------------------

// Se crean con `await` de módulo y no en un gancho `before`: bajo `node --test`
// los `before` de nivel raíz arrancan a la vez y sin esperarse (ver la nota en
// `test/apoyo/pg.ts`), y estas pruebas necesitan la base ya sembrada.
const antes: Base = await baseDelCRM('antes');
const despues: Base = await baseDelCRM('despues');

after(async () => {
  await antes.destruir();
  await despues.destruir();
});

// ---------------------------------------------------------------------------
// R8 · antes: el hueco, tal como está hoy
// ---------------------------------------------------------------------------

describe(`R8 · antes (roles.sql de ${REF_BASE})`, () => {
  it('Beto (ejecutivo en la lista) ve lo suyo y lo que no tiene dueño', async () => {
    assert.deepEqual(await loQueVe(antes, BETO), DE_BETO);
  });

  it('Ana (admin en la lista) ve todo', async () => {
    assert.deepEqual(await loQueVe(antes, ANA), TODO);
  });

  it('Gaby (gerente en la lista) ve todo', async () => {
    assert.deepEqual(await loQueVe(antes, GABY), TODO);
  });

  it('Cata (captura en la lista) ve sus prospectos, ajustes y usuarios', async () => {
    assert.deepEqual(await loQueVe(antes, CATA), DE_CATA);
  });

  it('Carla (fuera de la lista) cae en el ejecutivo por omisión: ve catálogo, usuarios y lo sin dueño', async () => {
    assert.equal(
      await como(antes, CARLA, async (c) => {
        const { rows } = await c.query<{ rol: string }>(`SELECT public.crm_rol() AS rol`);
        return rows[0]?.rol;
      }),
      'ejecutivo',
      'este es el hueco que cierra la fase 03',
    );
    assert.deepEqual(await loQueVe(antes, CARLA), HUECO_DE_CARLA);
  });

  it('Carla, además, puede escribir', async () => {
    assert.equal(await intentaInsertar(antes, CARLA), null, 'hoy nadie la frena al insertar');
    assert.equal(await intentaEditar(antes, CARLA, 'clientes:c-sin'), 1, 'hoy alcanza a editar lo que no tiene dueño');
  });
});

// ---------------------------------------------------------------------------
// R8 · después: lo que la fase 03 tiene que lograr
// ---------------------------------------------------------------------------

describe('R8 · después (roles.sql del árbol de trabajo del CRM)', () => {
  it('Carla queda en el papel `ninguno`', async () => {
    const rol = await como(despues, CARLA, async (c) => {
      const { rows } = await c.query<{ rol: string }>(`SELECT public.crm_rol() AS rol`);
      return rows[0]?.rol;
    });
    assert.equal(rol, 'ninguno', 'crm_rol() debe devolver `ninguno` cuando el correo no está en la lista');
  });

  it('Carla no lee nada: cero filas de cualquier tipo', async () => {
    assert.deepEqual(await loQueVe(despues, CARLA), [], 'una cuenta fuera de la lista lee 0 filas de crm_datos');
  });

  it('Carla no lee la bitácora', async () => {
    assert.equal(await bitacoraQueVe(despues, CARLA), 0);
  });

  it('a Carla le rechazan insertar', async () => {
    const error = await intentaInsertar(despues, CARLA);
    assert.match(String(error), /row-level security/i, 'el INSERT de una cuenta fuera de la lista debe ser rechazado');
  });

  it('a Carla le rechazan editar, incluso lo que no tiene dueño', async () => {
    assert.equal(await intentaEditar(despues, CARLA, 'clientes:c-sin'), 0);
    assert.equal(await intentaEditar(despues, CARLA, 'ajustes:global'), 0);
  });

  it('Beto, Ana, Gaby y Cata ven exactamente lo mismo que antes', async () => {
    for (const [quien, actor] of [
      ['Beto', BETO],
      ['Ana', ANA],
      ['Gaby', GABY],
      ['Cata', CATA],
    ] as const) {
      assert.deepEqual(await loQueVe(despues, actor), await loQueVe(antes, actor), `${quien} no debe notar el cambio`);
    }
  });

  it('la bitácora sigue siendo de gerencia, con los mismos conteos', async () => {
    for (const [quien, actor] of [
      ['Ana', ANA],
      ['Gaby', GABY],
      ['Beto', BETO],
      ['Cata', CATA],
    ] as const) {
      assert.equal(await bitacoraQueVe(despues, actor), await bitacoraQueVe(antes, actor), `${quien} no debe notar el cambio`);
    }
  });

  it('Beto y Cata siguen pudiendo escribir lo que les toca', async () => {
    assert.equal(await intentaInsertar(despues, BETO), null);
    assert.equal(await intentaInsertar(despues, CATA, 'prospectos'), null);
    assert.equal(await intentaEditar(despues, BETO, 'clientes:c-beto'), 1);
  });

  it('a Cata le siguen rechazando los ajustes y la lista de usuarios', async () => {
    assert.match(String(await intentaInsertar(despues, CATA, 'ajustes')), /row-level security/i);
    assert.match(String(await intentaInsertar(despues, CATA, 'usuarios')), /row-level security/i);
  });
});

// ---------------------------------------------------------------------------
// La firma anónima no se toca (firmas.sql)
// ---------------------------------------------------------------------------

describe('firmas.sql · el cliente sin cuenta sigue firmando', () => {
  const conClave = (clave: string): Actor => ({ rol: 'anon', encabezados: { 'x-firma-token': clave } });

  for (const [variante, base] of [
    ['antes', antes],
    ['después', despues],
  ] as const) {
    it(`${variante}: con la clave correcta lee su convenio y sólo el suyo`, async () => {
      assert.deepEqual(await loQueVe(base, conClave(CLAVE_V_BETO)), ['convenios:v-beto']);
    });

    it(`${variante}: sin clave no ve nada`, async () => {
      assert.deepEqual(await loQueVe(base, { rol: 'anon' }), []);
    });

    it(`${variante}: con una clave que no es, no ve nada`, async () => {
      assert.deepEqual(await loQueVe(base, conClave('clave-inventada')), []);
    });

    it(`${variante}: deja su firma en el buzón con la clave correcta`, async () => {
      await como(base, conClave(CLAVE_V_BETO), async (c) => {
        await c.query(
          `INSERT INTO public.crm_firmas (convenio_id, token, nombre) VALUES ($1, $2, $3)`,
          ['v-beto', CLAVE_V_BETO, 'Quien firma'],
        );
      });
    });

    it(`${variante}: con una clave que no es, no puede dejar firma`, async () => {
      await assert.rejects(
        () =>
          como(base, conClave('clave-inventada'), async (c) => {
            await c.query(`INSERT INTO public.crm_firmas (convenio_id, token) VALUES ($1, $2)`, [
              'v-beto',
              'clave-inventada',
            ]);
          }),
        /row-level security/i,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Los tres archivos siguen siendo re-ejecutables
// ---------------------------------------------------------------------------

describe('nube.sql → roles.sql → firmas.sql', () => {
  it('se pueden correr dos veces seguidas sin fallar', async () => {
    const base = await baseCruda();
    try {
      for (const vuelta of [1, 2]) {
        for (const archivo of ['nube.sql', 'roles.sql', 'firmas.sql']) {
          const sql = archivo === 'roles.sql' ? rolesSql('despues') : sqlDelArbol(archivo);
          await assert.doesNotReject(() => base.pool.query(sql), `${archivo}, vuelta ${vuelta}`);
        }
      }
    } finally {
      await base.destruir();
    }
  });
});
