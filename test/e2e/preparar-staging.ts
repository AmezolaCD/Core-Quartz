/**
 * Fase 09: preparar y limpiar el entorno de **staging** para los recorridos.
 *
 * Dos trabajos, y el primero es el que importa:
 *
 * 1. **Negarse a correr contra producción.** Todo lo demás de este archivo
 *    escribe y borra usuarios; equivocarse de proyecto sería tocar la cartera
 *    de un hotel que está trabajando.
 * 2. Sembrar y limpiar las personas `*@e2e.example`, de forma idempotente.
 */
import pg from 'pg';
import type { Pool } from 'pg';
import { crearPool } from '../../src/db/pool.ts';

/** Sufijo de los correos que esta fase crea y borra. Nada fuera de él se toca. */
export const SUFIJO_E2E = '@e2e.example';

/** Lo que hace falta para preparar staging. Todo sale del entorno, nada del código. */
export interface EntornoE2E {
  /** Supabase de staging. */
  supabaseUrl?: string | undefined;
  /** Supabase de **producción**, para reconocerlo y negarse. */
  produccion?: string | undefined;
  /** Postgres de staging (esquema `core` y la lista del CRM). */
  databaseUrl?: string | undefined;
}

export function leerEntornoE2E(entorno: NodeJS.ProcessEnv = process.env): EntornoE2E {
  return {
    supabaseUrl: entorno.SUPABASE_URL,
    produccion: entorno.CQ_SUPABASE_PRODUCCION,
    databaseUrl: entorno.DATABASE_URL,
  };
}

/**
 * Compara dos direcciones de Supabase por su **host**.
 *
 * No se comparan las cadenas tal cual porque no hace falta que sean idénticas
 * para ser el mismo proyecto: `https://abc.supabase.co`,
 * `https://abc.supabase.co/` y `https://ABC.supabase.co/auth/v1` son todas el
 * proyecto `abc`. Comparar texto dejaría pasar cualquiera de las tres.
 *
 * Una dirección que no se puede interpretar cuenta como **coincidencia**: si no
 * se entiende lo que hay puesto, no se corre. Es la única respuesta segura.
 */
export function mismoProyecto(una: string, otra: string): boolean {
  const host = (texto: string): string | null => {
    try {
      return new URL(texto.trim()).host.toLowerCase();
    } catch {
      return null;
    }
  };
  const a = host(una);
  const b = host(otra);
  if (a === null || b === null) return true;
  return a === b;
}

/** Por qué no se puede correr, o `null` si sí se puede. */
export type Impedimento = { motivo: string } | null;

/**
 * Revisa que se pueda correr contra staging, y sólo contra staging.
 *
 * **La ausencia de `CQ_SUPABASE_PRODUCCION` impide correr**, y eso no es un
 * descuido: los dos repositorios son públicos, así que la dirección de
 * producción no puede estar en el código (invariante §5) y tiene que venir del
 * entorno. Si se dejara pasar cuando falta, el guardia se apagaría solo justo
 * en la máquina donde nadie lo configuró — que es donde hace falta.
 */
export function revisarStaging(e: EntornoE2E): Impedimento {
  if (!e.supabaseUrl || e.supabaseUrl.trim() === '') {
    return { motivo: 'Falta SUPABASE_URL: no hay staging al que apuntar.' };
  }
  if (!e.databaseUrl || e.databaseUrl.trim() === '') {
    return { motivo: 'Falta DATABASE_URL: no hay Postgres de staging.' };
  }
  if (!e.produccion || e.produccion.trim() === '') {
    return {
      motivo:
        'Falta CQ_SUPABASE_PRODUCCION. Sin ella no se puede reconocer producción, y estas pruebas ' +
        'crean y borran usuarios. Ponla en .env.e2e con la dirección del proyecto de producción ' +
        '(nunca en el repositorio: los dos son públicos).',
    };
  }
  if (mismoProyecto(e.supabaseUrl, e.produccion)) {
    return {
      motivo:
        `SUPABASE_URL apunta al mismo proyecto que CQ_SUPABASE_PRODUCCION. Estas pruebas crean y ` +
        `borran usuarios: contra producción eso es la cartera de un hotel trabajando. ` +
        `Apunta SUPABASE_URL a staging.`,
    };
  }
  return null;
}

/** Igual que `revisarStaging`, pero lanza. Es lo que llama la prueba antes de nada. */
export function exigirStaging(entorno: NodeJS.ProcessEnv = process.env): EntornoE2E {
  const e = leerEntornoE2E(entorno);
  const impedimento = revisarStaging(e);
  if (impedimento) throw new Error(`No se corre la e2e: ${impedimento.motivo}`);
  return e;
}

// ---- Siembra y limpieza (sólo `*@e2e.example`) ----

/**
 * Borra de `core` las personas de la e2e. Idempotente y acotado al sufijo.
 *
 * El orden lo manda la llave ajena: accesos y sesiones antes que la persona. La
 * bitácora **no se toca**: es sólo de inserción por disparador (invariante 8), y
 * su rastro de una corrida anterior no molesta a la siguiente.
 */
export async function limpiarE2E(pool: Pool): Promise<number> {
  const patron = `%${SUFIJO_E2E}`;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM core.usuarios WHERE correo LIKE $1`,
    [patron],
  );
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  await pool.query(`DELETE FROM core.accesos  WHERE usuario_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM core.sesiones WHERE usuario_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM core.boletos  WHERE usuario_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM core.usuarios WHERE id = ANY($1::uuid[])`, [ids]);
  return ids.length;
}

/**
 * Siembra la lista de usuarios del CRM en `public.crm_datos`.
 *
 * Sin esto, `crm_sin_lista()` del CRM deja a cualquiera como `admin` y el
 * recorrido 3 mide lo contrario de lo que cree medir. Ver el documento de la
 * fase.
 */
export async function sembrarListaCrmE2E(
  pool: Pool,
  gente: Array<{ correo: string; nombre: string; rol: string }>,
): Promise<void> {
  for (const quien of gente) {
    await pool.query(
      `INSERT INTO public.crm_datos (id, tipo, datos, borrado)
         VALUES ($1, 'usuarios', $2::jsonb, false)
       ON CONFLICT (id) DO UPDATE SET datos = excluded.datos, borrado = false`,
      [`usuarios:e2e-${quien.correo.split('@')[0]}`, JSON.stringify(quien)],
    );
  }
}

/** Abre un pool contra el Postgres de staging, ya comprobado que no es producción. */
export function poolDeStaging(entorno: NodeJS.ProcessEnv = process.env): Pool {
  const e = exigirStaging(entorno);
  return crearPool(e.databaseUrl!);
}

export { pg };

// ---------------------------------------------------------------------------
// La gente de la e2e
//
// `limpiarE2E` sabía borrar desde el principio; crear, no. Esto es lo que
// faltaba, y por eso ninguno de los seis recorridos había podido correr: el
// recorrido 3 mide que Carla NO alcanza nada del CRM, y eso sólo significa algo
// si Carla existe de verdad, con su cuenta y su acceso puesto.
// ---------------------------------------------------------------------------

/** Una persona del PRD §7, tal como queda sembrada en staging. */
export interface PersonaE2E {
  clave: 'ana' | 'beto' | 'carla';
  nombre: string;
  esAdmin: boolean;
  /** `usuario_modulo` sólo lo lleva el CDH; el CRM va por correo. */
  accesos: Array<{ modulo: 'crm' | 'cdh'; usuarioModulo: string | null }>;
}

/**
 * Las tres que hacen falta para los seis recorridos.
 *
 * El `usuario_modulo` de Ana **tiene que existir y estar activo en el CDH**, o
 * el canje se rechaza del lado del CDH y el recorrido 1 falla donde no es. Es
 * el único dato de esta lista que depende de otra máquina, y por eso va a la
 * vista y no escondido en una prueba.
 */
export const GENTE_E2E: readonly PersonaE2E[] = [
  {
    clave: 'ana',
    nombre: 'Ana (e2e)',
    esAdmin: true,
    accesos: [
      { modulo: 'crm', usuarioModulo: null },
      { modulo: 'cdh', usuarioModulo: 'e2e.ana' },
    ],
  },
  { clave: 'beto', nombre: 'Beto (e2e)', esAdmin: false, accesos: [{ modulo: 'crm', usuarioModulo: null }] },
  {
    clave: 'carla',
    nombre: 'Carla (e2e)',
    esAdmin: false,
    accesos: [{ modulo: 'cdh', usuarioModulo: 'e2e.carla' }],
  },
] as const;

export function correoE2E(clave: PersonaE2E['clave']): string {
  return `${clave}${SUFIJO_E2E}`;
}

/** Lo mínimo que esta siembra necesita de Supabase. Lo cumple `crearClienteSupabase`. */
export interface AltaDeCuentas {
  buscarPorCorreo(correo: string): Promise<{ id: string } | null>;
  crearUsuario(correo: string, contrasena: string): Promise<{ id: string }>;
}

/**
 * Siembra a las tres en Supabase, en `core` y en la lista del CRM. Idempotente.
 *
 * Idempotente de verdad, no «vuelve a intentarlo»: el criterio de la fase pide
 * que los seis recorridos pasen **dos veces seguidas**, y entre una corrida y
 * otra `limpiarE2E` borra las filas de `core` pero **no la cuenta de Supabase**
 * —borrarla dejaría sin sesión a cualquier pestaña abierta y no hace falta—.
 * Así que la segunda vuelta siempre encuentra la cuenta hecha y el usuario por
 * crear, y las dos ramas tienen que funcionar.
 *
 * Devuelve el id de cada persona, que es lo que los recorridos usan para
 * hablarle a la administración.
 */
export async function sembrarGenteE2E(
  pool: Pool,
  cuentas: AltaDeCuentas,
  contrasena: string,
): Promise<Map<PersonaE2E['clave'], string>> {
  if (contrasena.trim() === '') {
    throw new Error('Falta la contraseña de la gente de la e2e (CQ_E2E_CONTRASENA en .env.e2e).');
  }
  const ids = new Map<PersonaE2E['clave'], string>();

  for (const persona of GENTE_E2E) {
    const correo = correoE2E(persona.clave);

    // 1. La cuenta de Supabase: es quien manda el id, porque el token que
    //    después llega al portal viene firmado con él.
    const yaEstaba = await cuentas.buscarPorCorreo(correo);
    const cuenta = yaEstaba ?? (await cuentas.crearUsuario(correo, contrasena));

    // 2. La persona en `core`, con el id de la cuenta.
    await pool.query(
      `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
            VALUES ($1::uuid, lower($2), $3, $4, true)
       ON CONFLICT (id) DO UPDATE
            SET correo = excluded.correo, nombre = excluded.nombre,
                es_admin = excluded.es_admin, activo = true`,
      [cuenta.id, correo, persona.nombre, persona.esAdmin],
    );

    // 3. Sus accesos.
    for (const acceso of persona.accesos) {
      await pool.query(
        `INSERT INTO core.accesos (usuario_id, modulo, usuario_modulo, activo)
              VALUES ($1::uuid, $2, $3, true)
         ON CONFLICT (usuario_id, modulo) DO UPDATE
              SET usuario_modulo = excluded.usuario_modulo, activo = true`,
        [cuenta.id, acceso.modulo, acceso.usuarioModulo],
      );
    }
    ids.set(persona.clave, cuenta.id);
  }

  // 4. La lista del CRM. Sólo quien entra al CRM: que Carla NO esté es parte de
  //    lo que mide el recorrido 3, no un olvido.
  await sembrarListaCrmE2E(
    pool,
    GENTE_E2E.filter((p) => p.accesos.some((a) => a.modulo === 'crm')).map((p) => ({
      correo: correoE2E(p.clave),
      nombre: p.nombre,
      rol: p.clave === 'ana' ? 'admin' : 'ejecutivo',
    })),
  );

  return ids;
}

/**
 * ¿Está sembrada la lista de usuarios del CRM?
 *
 * El recorrido 3 **tiene que preguntarlo antes de medir R8**. Con la lista
 * vacía, `crm_sin_lista()` del CRM deja a quien entre como `admin` y le entrega
 * todo: Carla vería filas y la prueba se pondría roja culpando a R8, que es
 * exactamente el fallo que invita a relajar la aserción en vez de sembrar la
 * lista.
 */
export async function listaCrmSembrada(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ cuantos: string }>(
    `SELECT count(*)::text AS cuantos FROM public.crm_datos WHERE tipo = 'usuarios' AND borrado = false`,
  );
  return Number(rows[0]?.cuantos ?? '0') > 0;
}
