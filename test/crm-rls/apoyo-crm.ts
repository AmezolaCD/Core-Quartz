/**
 * Fase 03 · Andamiaje común de las pruebas de RLS del CRM.
 *
 * Aquí vive lo que `roles.test.ts` y `firmas.test.ts` comparten: dónde está el
 * clon del CRM, cómo se leen sus `.sql` (los del árbol de trabajo y los de la
 * línea base publicada), la base desechable con el Supabase simulado, el juego
 * de datos y las funciones que consultan como lo haría el navegador.
 *
 * No trae ninguna prueba ni crea ninguna base al importarse: cada archivo de
 * pruebas arma las suyas y las destruye en su propio `after`.
 *
 * Variables de entorno:
 *   CRM_REPO      ruta al clon del CRM            (por omisión `../CRM-VENTAS-`)
 *   CRM_REF_BASE  referencia git de la línea base (por omisión, el commit fijo
 *                 `BASE_PUBLICADA`; ver la nota de `refBase()`)
 *   DATABASE_URL_TEST  Postgres de pruebas, nunca Supabase (PRD §9)
 */
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
export const CRM = path.resolve(RAIZ, process.env.CRM_REPO ?? '../CRM-VENTAS-');

/**
 * Postgres de pruebas. Se repite aquí en vez de importarlo de `test/apoyo/pg.ts`
 * a propósito: ese módulo crea su base y le corre las migraciones del esquema
 * `core` al importarlo, y estas pruebas necesitan justo lo contrario, una base
 * con el esquema del CRM y sin nada del portal.
 */
export const URL_PRUEBAS = process.env.DATABASE_URL_TEST ?? 'postgres://postgres@127.0.0.1:54329/postgres';

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
 * Último commit publicado del CRM antes de que la fase 03 toque `roles.sql`.
 * Es la línea base de las pruebas de «antes».
 */
const BASE_PUBLICADA = '81a7d1f';

/**
 * Referencia de la línea base: el `roles.sql` «de antes».
 *
 * Va **fijada a un commit** y no resuelta por rama a propósito. El PRD la
 * nombra `main`, pero el CRM no tiene `main`: cualquier cadena de omisiones
 * (`main` → `origin/main` → `origin/HEAD` → `HEAD`) acaba cayendo en la misma
 * rama donde el cambio de la fase 03 se va a commitear, y entonces el «antes»
 * dejaría de ser el antes en cuanto se commiteara: las dos variantes serían el
 * mismo archivo y las pruebas del hueco se pondrían en rojo sin que nada esté
 * mal. Con el commit fijo, el «antes» sigue siendo el antes para siempre.
 *
 * `CRM_REF_BASE` sigue mandando sobre esto, para poder apuntar a otro clon o a
 * otra línea base a mano.
 */
export function refBase(): string {
  const pedida = process.env.CRM_REF_BASE?.trim();
  const usarPedida = pedida !== undefined && pedida !== '';
  const ref = usarPedida ? pedida : BASE_PUBLICADA;
  assert.ok(
    existeRef(ref),
    usarPedida
      ? `CRM_REF_BASE=${ref} no existe en ${CRM}: revisa la referencia o el clon.`
      : `la línea base fijada (${ref}) no existe en ${CRM}: el clon del CRM está incompleto ` +
          `(¿un clon superficial, o de otro repositorio?). Clónalo con todo el historial, ` +
          `o pasa otra referencia con CRM_REF_BASE.`,
  );
  return ref;
}

export const REF_BASE = refBase();

/** El archivo tal como está commiteado en la línea base. */
export function sqlCommiteado(archivo: string): string {
  return git('show', `${REF_BASE}:${archivo}`);
}

/** El archivo tal como está en el árbol de trabajo del CRM. */
export function sqlDelArbol(archivo: string): string {
  return readFileSync(path.join(CRM, archivo), 'utf8');
}

/** Cualquier archivo del CRM, en la variante que se pida. */
export function archivoDelCRM(archivo: string, variante: Variante): string {
  return variante === 'antes' ? sqlCommiteado(archivo) : sqlDelArbol(archivo);
}

export type Variante = 'antes' | 'despues';

/** `roles.sql` de cada variante; lo demás siempre sale del árbol de trabajo. */
export function rolesSql(variante: Variante): string {
  return archivoDelCRM('roles.sql', variante);
}

/**
 * `firmas.sql` de cada variante.
 *
 * La ampliación de la fase 03 también toca este archivo, así que tiene su
 * propio «antes» —el buzón sin guarda de papel, tal como está publicado— y su
 * «después». Se pide aparte del de `roles.sql` porque las dos piezas se
 * combinan: el caso más filoso del hueco es `roles.sql` **ya arreglado** con
 * `firmas.sql` todavía sin arreglar, que es donde se ve que el papel `ninguno`
 * no basta por sí solo.
 */
export function firmasSql(variante: Variante): string {
  return archivoDelCRM('firmas.sql', variante);
}

// ---------------------------------------------------------------------------
// El juego de datos (uno solo, para que los conteos se puedan comparar)
// ---------------------------------------------------------------------------

/** Clave de firma del convenio de Beto, para las pruebas de `firmas.sql`. */
export const CLAVE_V_BETO = 'clave-de-beto';

export interface Fila {
  id: string;
  tipo: string;
  datos: Record<string, unknown>;
  duenio: string | null;
  /** Como en el CRM: dar de baja es marcar, no borrar. Por omisión, `false`. */
  borrado?: boolean;
}

/**
 * Las personas de la lista del CRM (una por papel) y la cartera mínima que hace
 * visible cada rama de las políticas. Carla **no** está en la lista a propósito:
 * es la cuenta de sólo-CDH del PRD §7, y es el caso de R8.
 *
 * Además hay dos filas de usuario que no están por su papel, sino por lo que
 * `crm_yo()` tiene que hacer con ellas:
 *
 *   · **Dora** está en la tabla pero dada de baja (`borrado = true`). No es de
 *     la lista viva: tiene que caer en `ninguno` aunque su fila diga `admin`.
 *   · **Elsa** tiene el correo capturado con mayúsculas. El cotejo del correo
 *     es insensible a mayúsculas por los dos lados, y ella prueba el lado de
 *     la lista (el del token lo prueba `BETO_MAYUSCULAS`).
 *
 * Las filas de usuario dadas de baja siguen bajando a todo el equipo: la
 * política de lectura no mira `borrado`, es la aplicación la que las esconde.
 * Por eso `usuarios:dora` aparece en el catálogo de todos.
 */
export const SEMILLA: Fila[] = [
  { id: 'usuarios:ana', tipo: 'usuarios', datos: { correo: 'ana@quartz.example', nombre: 'Ana', rol: 'admin' }, duenio: null },
  { id: 'usuarios:gaby', tipo: 'usuarios', datos: { correo: 'gaby@quartz.example', nombre: 'Gaby', rol: 'gerente' }, duenio: null },
  { id: 'usuarios:beto', tipo: 'usuarios', datos: { correo: 'beto@quartz.example', nombre: 'Beto', rol: 'ejecutivo' }, duenio: null },
  { id: 'usuarios:cata', tipo: 'usuarios', datos: { correo: 'cata@quartz.example', nombre: 'Cata', rol: 'captura' }, duenio: null },
  { id: 'usuarios:dora', tipo: 'usuarios', datos: { correo: 'dora@quartz.example', nombre: 'Dora', rol: 'admin' }, duenio: null, borrado: true },
  { id: 'usuarios:elsa', tipo: 'usuarios', datos: { correo: 'ELSA@Quartz.Example', nombre: 'Elsa', rol: 'gerente' }, duenio: null },
  { id: 'ajustes:global', tipo: 'ajustes', datos: { moneda: 'MXN' }, duenio: null },
  { id: 'habitaciones:h1', tipo: 'habitaciones', datos: { nombre: 'Suite' }, duenio: null },
  { id: 'clientes:c-beto', tipo: 'clientes', datos: { nombre: 'Cliente de Beto' }, duenio: 'Beto' },
  { id: 'clientes:c-gaby', tipo: 'clientes', datos: { nombre: 'Cliente de Gaby' }, duenio: 'Gaby' },
  { id: 'clientes:c-sin', tipo: 'clientes', datos: { nombre: 'Cliente sin dueño' }, duenio: null },
  { id: 'prospectos:p-cata', tipo: 'prospectos', datos: { nombre: 'Prospecto de Cata' }, duenio: 'Cata' },
  { id: 'prospectos:p-beto', tipo: 'prospectos', datos: { nombre: 'Prospecto de Beto' }, duenio: 'Beto' },
  { id: 'convenios:v-beto', tipo: 'convenios', datos: { nombre: 'Convenio de Beto', tokenFirma: CLAVE_V_BETO }, duenio: 'Beto' },
];

export const TODO = SEMILLA.map((f) => f.id).sort();

/** La lista de gente, que todo el mundo alcanza a leer (también la dada de baja). */
export const USUARIOS = ['usuarios:ana', 'usuarios:beto', 'usuarios:cata', 'usuarios:dora', 'usuarios:elsa', 'usuarios:gaby'];

/** Lo que todo el equipo necesita para armar un convenio (`roles.sql` §3). */
export const CATALOGO = ['ajustes:global', 'habitaciones:h1', ...USUARIOS];

/** Lo que ve un ejecutivo llamado Beto: el catálogo, lo suyo y lo que no tiene dueño. */
export const DE_BETO = [...CATALOGO, 'clientes:c-beto', 'clientes:c-sin', 'convenios:v-beto', 'prospectos:p-beto'].sort();

/** `captura` (Banquetes): sus prospectos y nada más que ajustes y la lista de gente. */
export const DE_CATA = ['ajustes:global', ...USUARIOS, 'prospectos:p-cata'].sort();

/** El hueco de R8: una cuenta fuera de la lista cae en el `ejecutivo` por omisión. */
export const HUECO_DE_CARLA = [...CATALOGO, 'clientes:c-sin'].sort();

// ---------------------------------------------------------------------------
// Bases desechables
// ---------------------------------------------------------------------------

export interface Base {
  nombre: string;
  pool: pg.Pool;
  destruir: () => Promise<void>;
}

export async function conAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
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
export async function baseCruda(): Promise<Base> {
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

/**
 * Mete el juego de datos en una base que ya trae el esquema del CRM.
 *
 * Con `conDuenio = false` no escribe esa columna, porque la agrega `roles.sql`:
 * es lo que hace falta para sembrar una base de `nube.sql` a secas.
 */
export async function sembrar(base: Base, conDuenio = true): Promise<void> {
  for (const f of SEMILLA) {
    if (conDuenio) {
      await base.pool.query(
        `INSERT INTO public.crm_datos (id, tipo, datos, duenio, borrado) VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [f.id, f.tipo, JSON.stringify(f.datos), f.duenio, f.borrado ?? false],
      );
    } else {
      await base.pool.query(
        `INSERT INTO public.crm_datos (id, tipo, datos, borrado) VALUES ($1, $2, $3::jsonb, $4)`,
        [f.id, f.tipo, JSON.stringify(f.datos), f.borrado ?? false],
      );
    }
  }
}

/**
 * Carga el CRM en el orden en que se corre de verdad y siembra el juego de datos.
 *
 * `variante` es la de `roles.sql`. La de `firmas.sql` se pide aparte y por
 * omisión es la del árbol de trabajo, que es lo que `roles.test.ts` necesita:
 * su «antes» habla nada más del papel por omisión, no del buzón.
 */
export async function baseDelCRM(variante: Variante, varianteFirmas: Variante = 'despues'): Promise<Base> {
  const base = await baseCruda();
  try {
    await base.pool.query(sqlDelArbol('nube.sql'));
    await base.pool.query(rolesSql(variante));
    await base.pool.query(firmasSql(varianteFirmas));
    await sembrar(base);
    return base;
  } catch (error) {
    await base.destruir();
    throw error;
  }
}

/**
 * El CRM **sin** `roles.sql`: sólo `nube.sql` y `firmas.sql`.
 *
 * `ROLES.md` declara soportada esta configuración —quien todavía no corrió el
 * blindaje—, y es la que sostiene el atajo `to_regprocedure` de
 * `crm_del_equipo()`. Sin `roles.sql` no existe la columna `duenio`, así que la
 * siembra va sin ella.
 */
export async function baseSinRoles(): Promise<Base> {
  const base = await baseCruda();
  try {
    await base.pool.query(sqlDelArbol('nube.sql'));
    await base.pool.query(sqlDelArbol('firmas.sql'));
    await sembrar(base, false);
    return base;
  } catch (error) {
    await base.destruir();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// El «deshacer» que roles.sql documenta en su §5
//
// La sección «5. Para deshacer» del archivo dice, en comentarios, qué correr
// para volver a como estaba. Las líneas no se copian a las pruebas: se leen del
// archivo y se ejecutan tal cual, así que si alguien renombra una política y se
// le olvida el comentario, las pruebas truenan.
// ---------------------------------------------------------------------------

/** El texto de la sección «5. Para deshacer». */
function seccionDeshacer(sql: string): string {
  const marca = sql.indexOf('5. Para deshacer');
  assert.ok(marca > 0, 'roles.sql ya no trae la sección «5. Para deshacer»');
  return sql.slice(marca);
}

/** Las líneas `drop policy` que roles.sql §5 documenta, sacadas del archivo. */
export function deshacerDocumentado(sql: string): string[] {
  const lineas = [...seccionDeshacer(sql).matchAll(/^--\s+(drop\s+policy\s+.+;)\s*$/gim)].map((m) => m[1]!.trim());
  assert.ok(lineas.length > 0, 'la sección «5. Para deshacer» ya no trae líneas `drop policy`');
  return lineas;
}

/**
 * **Todo** lo que §5 manda soltar, sea del tipo que sea.
 *
 * No sólo políticas: mientras `crm_rol()` siga viva, las reglas del buzón de
 * `firmas.sql` la siguen consultando por `crm_del_equipo()`, y un deshacer que
 * sólo tire políticas deja el buzón cerrado para todo el equipo sin avisar.
 */
export function deshacerCompleto(sql: string): string[] {
  const lineas = [...seccionDeshacer(sql).matchAll(/^--\s+(drop\s+.+;)\s*$/gim)].map((m) => m[1]!.trim());
  assert.ok(lineas.length > 0, 'la sección «5. Para deshacer» ya no trae líneas `drop`');
  return lineas;
}

// ---------------------------------------------------------------------------
// Consultar como lo haría el navegador
// ---------------------------------------------------------------------------

export interface Actor {
  /** El rol de Postgres con el que PostgREST atendería la petición. */
  rol: 'anon' | 'authenticated';
  /** Correo del token; sin correo, no hay sesión. */
  correo?: string;
  /** Encabezados de la petición (`firmas.sql` lee `x-firma-token` de aquí). */
  encabezados?: Record<string, string>;
}

export const ANA: Actor = { rol: 'authenticated', correo: 'ana@quartz.example' };
export const GABY: Actor = { rol: 'authenticated', correo: 'gaby@quartz.example' };
export const BETO: Actor = { rol: 'authenticated', correo: 'beto@quartz.example' };
export const CATA: Actor = { rol: 'authenticated', correo: 'cata@quartz.example' };
/** Carla sólo tiene CDH: su correo no está en la lista de usuarios del CRM. */
export const CARLA: Actor = { rol: 'authenticated', correo: 'carla@quartz.example' };
/** Dora sí está en la tabla, pero dada de baja: tampoco es de la lista viva. */
export const DORA: Actor = { rol: 'authenticated', correo: 'dora@quartz.example' };
/** Beto otra vez, con el correo del token en mayúsculas (lista en minúsculas). */
export const BETO_MAYUSCULAS: Actor = { rol: 'authenticated', correo: 'BETO@QUARTZ.EXAMPLE' };
/** Elsa: el token en minúsculas y el correo de la lista con mayúsculas. */
export const ELSA: Actor = { rol: 'authenticated', correo: 'elsa@quartz.example' };

/** Un visitante sin cuenta, con la clave de firma que le llegó en el enlace. */
export const conClave = (clave: string): Actor => ({ rol: 'anon', encabezados: { 'x-firma-token': clave } });

/**
 * Corre `fn` dentro de una transacción con el token, los encabezados y el rol
 * del actor, y la deshace siempre: ninguna prueba se escribe encima de otra.
 */
export async function como<T>(base: Base, actor: Actor, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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
export async function loQueVe(base: Base, actor: Actor): Promise<string[]> {
  return como(base, actor, async (c) => {
    const { rows } = await c.query<{ id: string }>(`SELECT id FROM public.crm_datos ORDER BY id`);
    return rows.map((r) => r.id);
  });
}

/** Cuántas filas de la bitácora alcanza a ver. */
export async function bitacoraQueVe(base: Base, actor: Actor): Promise<number> {
  return como(base, actor, async (c) => {
    const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM public.crm_bitacora`);
    return Number(rows[0]?.n ?? 0);
  });
}

/** Intenta insertar un cliente nuevo. Devuelve `null` si pasó, o el mensaje si lo rechazaron. */
export async function intentaInsertar(base: Base, actor: Actor, tipo = 'clientes'): Promise<string | null> {
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
export async function intentaEditar(base: Base, actor: Actor, id: string): Promise<number> {
  return como(base, actor, async (c) => {
    const r = await c.query(`UPDATE public.crm_datos SET datos = datos || '{"tocado":true}'::jsonb WHERE id = $1`, [id]);
    return r.rowCount ?? 0;
  });
}

/** Cuál rol de `crm_rol()` le toca a ese actor. */
export async function rolDe(base: Base, actor: Actor): Promise<string | undefined> {
  return como(base, actor, async (c) => {
    const { rows } = await c.query<{ rol: string }>(`SELECT public.crm_rol() AS rol`);
    return rows[0]?.rol;
  });
}

// ---------------------------------------------------------------------------
// Andamios: cómo se prueba la política `edita` por sí sola
//
// Un UPDATE con WHERE no sólo pasa por la política de UPDATE: Postgres primero
// **lee** la fila, y para leerla exige las políticas de SELECT. Como `lee lo
// suyo` ya le niega todo al papel `ninguno`, el UPDATE de Carla se queda en
// cero filas antes de que `edita` llegue a opinar. Resultado: quitarle el
// candado de `ninguno` a `edita` no cambiaría nada en las pruebas, y la mitad
// de «update rechazado» del criterio de aceptación sería un adorno.
//
// Para que `edita` responda por sí sola se le pone un andamio: políticas
// **permisivas** creadas dentro de la misma transacción de la prueba y
// deshechas con el ROLLBACK (crear una política es DDL, y el DDL en Postgres es
// transaccional: no sobrevive ni aunque la prueba truene). No se toca el SQL
// del CRM ni la base de las demás pruebas.
//
// Las políticas permisivas se combinan con OR, y de ahí salen los dos andamios:
//
//   · 'lectura'  → un SELECT `using (true)`. Neutraliza el filtro de lectura y
//                  deja que quien decida qué filas entran al UPDATE sea el
//                  `using` de `edita`.
//   · 'escritura'→ además, un UPDATE `using (true) with check (false)`. El
//                  `using` queda en `edita.using OR true` = siempre cierto, y
//                  el `with check` en `edita.check OR false` = exactamente
//                  `edita.check`: `false` es el neutro del OR, así que el
//                  andamio no regala nada, sólo aparta el `using` de en medio
//                  para poder mirar el `with check`.
// ---------------------------------------------------------------------------

export type Andamio = 'lectura' | 'escritura';

const ANDAMIOS: Record<Andamio, string[]> = {
  lectura: [`CREATE POLICY "andamio lee todo" ON public.crm_datos FOR SELECT TO authenticated USING (true)`],
  escritura: [
    `CREATE POLICY "andamio lee todo" ON public.crm_datos FOR SELECT TO authenticated USING (true)`,
    `CREATE POLICY "andamio edita todo" ON public.crm_datos FOR UPDATE TO authenticated USING (true) WITH CHECK (false)`,
  ],
};

/** Los mismos dos andamios, pero sobre el buzón de firmas. */
const ANDAMIOS_FIRMAS: Record<Andamio, string[]> = {
  lectura: [`CREATE POLICY "andamio lee firmas" ON public.crm_firmas FOR SELECT TO authenticated USING (true)`],
  escritura: [
    `CREATE POLICY "andamio lee firmas" ON public.crm_firmas FOR SELECT TO authenticated USING (true)`,
    `CREATE POLICY "andamio marca firmas" ON public.crm_firmas FOR UPDATE TO authenticated USING (true) WITH CHECK (false)`,
  ],
};

/** Sobre cuál de las dos tablas del CRM se pone el andamio. */
export type Tabla = 'crm_datos' | 'crm_firmas';

/**
 * Como `como()`, pero con el andamio puesto: las políticas se crean como dueño
 * de la tabla antes de bajar a `authenticated`, y el ROLLBACK del `finally` las
 * quita siempre.
 */
export async function conAndamio<T>(
  base: Base,
  actor: Actor,
  andamio: Andamio,
  fn: (c: pg.PoolClient) => Promise<T>,
  tabla: Tabla = 'crm_datos',
): Promise<T> {
  const c = await base.pool.connect();
  try {
    await c.query('BEGIN');
    for (const sql of (tabla === 'crm_datos' ? ANDAMIOS : ANDAMIOS_FIRMAS)[andamio]) await c.query(sql);
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

export interface Intento {
  /** Filas modificadas, o `null` si la política lo rechazó con error. */
  filas: number | null;
  /** El mensaje del rechazo, o `null` si no hubo. */
  error: string | null;
}

/** Un UPDATE con el andamio puesto, distinguiendo «cero filas» de «rechazado». */
export async function editaConAndamio(base: Base, actor: Actor, id: string, andamio: Andamio): Promise<Intento> {
  return conAndamio(base, actor, andamio, async (c) => {
    try {
      const r = await c.query(`UPDATE public.crm_datos SET datos = datos || '{"tocado":true}'::jsonb WHERE id = $1`, [id]);
      return { filas: r.rowCount ?? 0, error: null };
    } catch (error) {
      return { filas: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

// ---------------------------------------------------------------------------
// El buzón sembrado: una firma legítima, pendiente de recoger
// ---------------------------------------------------------------------------

/** Lo que la clienta de Beto dejó en el buzón al abrir su enlace. */
export const FIRMA_LEGITIMA = {
  convenio: 'v-beto',
  nombre: 'Rocío Peralta',
  puesto: 'Gerente de compras',
  celular: '3312345678',
  img: 'data:image/png;base64,FIRMA-DE-LA-CLIENTA',
};

/** Lo que pondría quien quisiera suplantarla. */
export const FIRMA_FALSA = {
  nombre: 'Quien no firmó',
  puesto: 'Apoderado',
  celular: '5500000000',
  img: 'data:image/png;base64,FIRMA-SUSTITUIDA',
};

export interface FilaFirma {
  id: string;
  convenio_id: string;
  token: string;
  nombre: string | null;
  puesto: string | null;
  celular: string | null;
  img: string | null;
  aplicada: boolean;
}

export const COLUMNAS_FIRMA = 'id, convenio_id, token, nombre, puesto, celular, img, aplicada';

/** Deja en el buzón la firma pendiente de la clienta y devuelve su id. */
export async function sembrarBuzon(base: Base): Promise<string> {
  const { rows } = await base.pool.query<{ id: string }>(
    `INSERT INTO public.crm_firmas (convenio_id, token, nombre, puesto, celular, img, aplicada)
     VALUES ($1, $2, $3, $4, $5, $6, false) RETURNING id`,
    [
      FIRMA_LEGITIMA.convenio,
      CLAVE_V_BETO,
      FIRMA_LEGITIMA.nombre,
      FIRMA_LEGITIMA.puesto,
      FIRMA_LEGITIMA.celular,
      FIRMA_LEGITIMA.img,
    ],
  );
  const id = rows[0]?.id;
  assert.ok(id, 'no se pudo sembrar la firma pendiente');
  return id;
}

// ---------------------------------------------------------------------------
// Consultar el buzón como lo haría el navegador
// ---------------------------------------------------------------------------

/** Todo lo que ese actor alcanza a leer del buzón. */
export async function buzonQueVe(base: Base, actor: Actor): Promise<FilaFirma[]> {
  return como(base, actor, async (c) => {
    const { rows } = await c.query<FilaFirma>(`SELECT ${COLUMNAS_FIRMA} FROM public.crm_firmas ORDER BY id`);
    return rows;
  });
}

/** Las claves de convenio que ese actor alcanza a sacar del buzón. */
export async function clavesQueSaca(base: Base, actor: Actor): Promise<string[]> {
  return como(base, actor, async (c) => {
    const { rows } = await c.query<{ token: string }>(`SELECT token FROM public.crm_firmas ORDER BY id`);
    return rows.map((r) => r.token);
  });
}

export interface IntentoFirma extends Intento {
  /**
   * La fila del buzón **como la ve el dueño de la tabla**, leída dentro de la
   * misma transacción y ya sin RLS de por medio.
   */
  fila: FilaFirma | undefined;
}

/**
 * Un UPDATE contra el buzón, contando filas y volviendo a leer la fila como
 * dueño para ver si de verdad cambió algo.
 *
 * Las dos mitades van **en la misma transacción** a propósito. `como()` siempre
 * deshace, así que una relectura hecha después del ROLLBACK mostraría la fila
 * original pasara lo que pasara: sería un «no cambió nada» de adorno. Dentro de
 * la transacción, en cambio, si el UPDATE hubiera entrado se vería.
 *
 * El intento va bajo un SAVEPOINT porque un rechazo de la política aborta la
 * transacción, y entonces ya no se podría releer nada.
 *
 * Con `andamio` se le quita de encima la política de lectura (y, en
 * `'escritura'`, también el `using` de la de UPDATE), igual que en
 * `roles.test.ts`: es la única forma de que «equipo marca firmas» responda por
 * sí sola en vez de quedar tapada por «equipo lee firmas».
 */
export async function intentaSobreElBuzon(
  base: Base,
  actor: Actor,
  id: string,
  sql: string,
  valores: unknown[],
  andamio?: Andamio,
): Promise<IntentoFirma> {
  const cuerpo = async (c: pg.PoolClient): Promise<IntentoFirma> => {
    let filas: number | null = null;
    let error: string | null = null;
    await c.query('SAVEPOINT intento');
    try {
      const r = await c.query(sql, [...valores, id]);
      filas = r.rowCount ?? 0;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      await c.query('ROLLBACK TO SAVEPOINT intento');
    }
    await c.query('RESET ROLE');
    const { rows } = await c.query<FilaFirma>(`SELECT ${COLUMNAS_FIRMA} FROM public.crm_firmas WHERE id = $1`, [id]);
    return { filas, error, fila: rows[0] };
  };
  return andamio
    ? conAndamio(base, actor, andamio, cuerpo, 'crm_firmas')
    : como(base, actor, cuerpo);
}

/** Suplantar a quien firmó: nombre, puesto, celular e imagen. */
export function intentaSustituir(base: Base, actor: Actor, id: string, andamio?: Andamio): Promise<IntentoFirma> {
  return intentaSobreElBuzon(
    base,
    actor,
    id,
    `UPDATE public.crm_firmas SET nombre = $1, puesto = $2, celular = $3, img = $4 WHERE id = $5`,
    [FIRMA_FALSA.nombre, FIRMA_FALSA.puesto, FIRMA_FALSA.celular, FIRMA_FALSA.img],
    andamio,
  );
}

/** Marcar como atendida una firma que nadie recogió: el CRM ya no la aplica. */
export function intentaMarcarAplicada(base: Base, actor: Actor, id: string, andamio?: Andamio): Promise<IntentoFirma> {
  return intentaSobreElBuzon(base, actor, id, `UPDATE public.crm_firmas SET aplicada = true WHERE id = $1`, [], andamio);
}

/** ¿La fila sigue siendo la firma legítima, intacta y pendiente? */
export function firmaIntacta(fila: FilaFirma | undefined): void {
  assert.ok(fila, 'la firma sembrada tiene que seguir en el buzón');
  assert.equal(fila.nombre, FIRMA_LEGITIMA.nombre, 'el nombre de quien firmó no se toca (invariante §8.7)');
  assert.equal(fila.puesto, FIRMA_LEGITIMA.puesto, 'el puesto de quien firmó no se toca');
  assert.equal(fila.celular, FIRMA_LEGITIMA.celular, 'el celular de quien firmó no se toca');
  assert.equal(fila.img, FIRMA_LEGITIMA.img, 'la imagen de la firma no se sustituye');
  assert.equal(fila.aplicada, false, 'la firma legítima sigue pendiente de recoger');
}
