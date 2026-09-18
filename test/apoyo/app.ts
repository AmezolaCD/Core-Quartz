/**
 * Arma la aplicación completa para las pruebas de la fase 04: base desechable,
 * Supabase y CDH simulados (servidores HTTP reales), reloj controlado y un
 * cliente que conserva la cookie como lo haría un navegador.
 *
 * Nada aquí sustituye módulos: el shell habla con los simuladores por `fetch`,
 * igual que hablaría con los de verdad.
 */
import { after } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { crearApp } from '../../src/app.ts';
import type { Config } from '../../src/config.ts';
import { crearClienteSupabase } from '../../src/servicios/supabase-auth.ts';
import { crearClienteCdh } from '../../src/servicios/cdh-cliente.ts';
import { baseDePrueba, sembrarEjemplo } from './pg.ts';
import { levantarSupabaseFalso, type SupabaseFalso } from './supabase-falso.ts';
import { levantarCdhFalso, type CdhFalso } from './cdh-falso.ts';

export { ID } from './pg.ts';

/** Hora fija de arranque de las pruebas (la misma familia que usa el núcleo). */
export const HORA_CERO: number = Date.parse('2026-09-16T10:00:00Z');

export interface Respuesta {
  estado: number;
  cuerpo: unknown;
  texto: string;
  cabeceras: Headers;
  /** `Location` de un 302, tal cual. */
  destino: string | null;
  /** Las cookies que puso esta respuesta, crudas. */
  cookies: string[];
}

export interface OpcionesPeticion {
  cuerpo?: unknown;
  cabeceras?: Record<string, string>;
  /** Cookie a mandar; el navegador la pone sola. */
  cookie?: string | null;
  /** Por omisión no sigue redirecciones: R3 y R5 se prueban por `Location`. */
  seguir?: boolean;
}

/** Cliente que conserva la cookie entre peticiones, como un navegador. */
export interface Navegador {
  pedir(metodo: string, ruta: string, opciones?: OpcionesPeticion): Promise<Respuesta>;
  /** Valor actual de `cq_sesion`, o `null`. */
  sesion(): string | null;
  olvidar(): void;
}

export interface Entorno {
  pool: Pool;
  supabase: SupabaseFalso;
  cdh: CdhFalso;
  config: Config;
  /** Raíz pública del shell, ya con el prefijo: `http://127.0.0.1:<puerto>/portal`. */
  base: string;
  /** Reloj controlado: las pruebas lo mueven para R3 y R4. */
  reloj: { ahora: number };
  pedir(metodo: string, ruta: string, opciones?: OpcionesPeticion): Promise<Respuesta>;
  navegador(): Navegador;
  cerrar(): Promise<void>;
}

export interface OpcionesEntorno {
  /** Prefijo del shell; por omisión `/portal`. */
  basePath?: string;
  /** Secreto de `/api/sso/*`; por omisión el del CDH falso. */
  ssoSecreto?: string;
  /** Con `false` no siembra las cinco personas del PRD §7. */
  sembrar?: boolean;
}

/** Valores de prueba de los secretos: las pruebas de seguridad los buscan en las respuestas. */
export const SECRETOS_DE_PRUEBA = {
  serviceRole: 'service-role-de-prueba-NO-DEBE-SALIR',
  anon: 'anon-de-prueba',
  sso: 'sso-secreto-de-prueba-NO-DEBE-SALIR',
} as const;

/**
 * R5.2: la lista de usuarios del CRM vive en `public.crm_datos`. La base
 * desechable sólo trae el esquema `core`, así que la prueba crea la tabla
 * mínima que lee el shell y siembra los correos que quiera.
 */
export async function sembrarListaCrm(pool: Pool, correos: string[]): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.crm_datos (
      id      bigserial primary key,
      tipo    text not null,
      borrado boolean not null default false,
      datos   jsonb not null
    )`);
  for (const correo of correos) {
    await pool.query(`INSERT INTO public.crm_datos (tipo, borrado, datos) VALUES ('usuarios', false, $1::jsonb)`, [
      JSON.stringify({ correo, nombre: correo.split('@')[0], rol: 'ejecutivo' }),
    ]);
  }
}

/** Marca un correo como borrado en la lista del CRM (R5.2 no debe contarlo). */
export async function borrarDeListaCrm(pool: Pool, correo: string): Promise<void> {
  await pool.query(
    `UPDATE public.crm_datos SET borrado = true WHERE tipo = 'usuarios' AND lower(datos->>'correo') = lower($1)`,
    [correo],
  );
}

function cookiesDe(cabeceras: Headers): string[] {
  const conjunto = (cabeceras as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof conjunto === 'function') return conjunto.call(cabeceras);
  const una = cabeceras.get('set-cookie');
  return una ? [una] : [];
}

/** Valor de una cookie dentro de una lista de `Set-Cookie`. */
export function valorDeCookie(cookies: string[], nombre: string): string | null {
  for (const cruda of cookies) {
    const par = cruda.split(';')[0] ?? '';
    const igual = par.indexOf('=');
    if (igual > 0 && par.slice(0, igual).trim() === nombre) return par.slice(igual + 1);
  }
  return null;
}

/** Atributos de una cookie (`HttpOnly`, `Path`, `SameSite`, `Secure`…). */
export function atributosDeCookie(cookies: string[], nombre: string): string | null {
  for (const cruda of cookies) {
    const par = cruda.split(';')[0] ?? '';
    if (par.slice(0, par.indexOf('=')).trim() === nombre) return cruda;
  }
  return null;
}

export async function levantarEntorno(opciones: OpcionesEntorno = {}): Promise<Entorno> {
  const basePath = opciones.basePath ?? '/portal';
  const pool = baseDePrueba().pool();
  if (opciones.sembrar !== false) await sembrarEjemplo(pool);

  const supabase = await levantarSupabaseFalso();
  const cdh = await levantarCdhFalso({ secreto: SECRETOS_DE_PRUEBA.sso });
  const reloj = { ahora: HORA_CERO };

  const config: Config = {
    puerto: 0,
    basePath,
    basePathCdh: '/cdh',
    databaseUrl: baseDePrueba().url(),
    supabaseUrl: supabase.url,
    supabaseAnon: SECRETOS_DE_PRUEBA.anon,
    supabaseServiceRole: SECRETOS_DE_PRUEBA.serviceRole,
    ssoSecreto: opciones.ssoSecreto ?? SECRETOS_DE_PRUEBA.sso,
    cdhInterno: cdh.interno,
  };

  // Si armar la aplicación falla —y en el paso rojo falla a propósito—, los dos
  // simuladores ya están escuchando: sin cerrarlos, el proceso de prueba se
  // queda colgado con los descriptores abiertos y nunca reporta nada.
  let servidor: Server;
  try {
    const app = crearApp({
      pool,
      config,
      supabase: crearClienteSupabase({
        url: config.supabaseUrl,
        anon: config.supabaseAnon,
        serviceRole: config.supabaseServiceRole,
      }),
      cdh: crearClienteCdh({ interno: config.cdhInterno, secreto: config.ssoSecreto }),
      ahora: () => reloj.ahora,
    });

    servidor = await new Promise((listo) => {
      const s = app.listen(0, '127.0.0.1', () => listo(s));
    });
  } catch (error) {
    await supabase.cerrar();
    await cdh.cerrar();
    throw error;
  }
  const puerto = (servidor.address() as AddressInfo).port;
  const raiz = `http://127.0.0.1:${puerto}`;

  async function pedir(metodo: string, ruta: string, op: OpcionesPeticion = {}): Promise<Respuesta> {
    const cabeceras: Record<string, string> = { ...(op.cabeceras ?? {}) };
    if (op.cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
    if (op.cookie) cabeceras['cookie'] = op.cookie;

    const respuesta = await fetch(`${raiz}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo),
      redirect: op.seguir ? 'follow' : 'manual',
    });
    const texto = await respuesta.text();
    let cuerpo: unknown = texto;
    try {
      cuerpo = texto === '' ? null : JSON.parse(texto);
    } catch {
      /* respuesta no-JSON (una página de error, por ejemplo) */
    }
    return {
      estado: respuesta.status,
      cuerpo,
      texto,
      cabeceras: respuesta.headers,
      destino: respuesta.headers.get('location'),
      cookies: cookiesDe(respuesta.headers),
    };
  }

  function navegador(): Navegador {
    let guardada: string | null = null;
    return {
      async pedir(metodo, ruta, op = {}) {
        const respuesta = await pedir(metodo, ruta, { ...op, cookie: op.cookie ?? guardada });
        const nueva = valorDeCookie(respuesta.cookies, 'cq_sesion');
        if (nueva !== null) guardada = nueva === '' ? null : `cq_sesion=${nueva}`;
        return respuesta;
      },
      sesion: () => guardada,
      olvidar: () => {
        guardada = null;
      },
    };
  }

  const entorno: Entorno = {
    pool,
    supabase,
    cdh,
    config,
    base: `${raiz}${basePath}`,
    reloj,
    pedir,
    navegador,
    async cerrar() {
      await new Promise<void>((listo) => servidor.close(() => listo()));
      await supabase.cerrar();
      await cdh.cerrar();
    },
  };

  after(() => entorno.cerrar());
  return entorno;
}
