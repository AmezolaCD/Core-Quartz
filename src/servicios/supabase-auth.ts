/**
 * Cliente delgado de Supabase Auth con `fetch` nativo (decisión #27: sin
 * `supabase-js`). Son cuatro llamadas y una dependencia menos.
 *
 * En pruebas no se sustituye este módulo: se le apunta a un servidor HTTP
 * local que responde como Supabase, para probar también los códigos de estado.
 */
import type { Ejecutor } from '../db/pool.ts';

/** Una cuenta de Supabase Auth, con el id que también es `core.usuarios.id`. */
export interface CuentaSupabase {
  id: string;
  correo: string;
}

/** R2: lo que devuelve validar correo y contraseña. */
export type ResultadoContrasena = { ok: true; cuenta: CuentaSupabase } | { ok: false };

export interface ClienteSupabase {
  /** R2.1: `grant_type=password`. `ok:false` si Supabase la rechaza. */
  entrar(correo: string, contrasena: string): Promise<ResultadoContrasena>;
  /** Busca una cuenta por correo (sin distinguir mayúsculas); `null` si no existe. */
  buscarPorCorreo(correo: string): Promise<CuentaSupabase | null>;
  /** Alta con contraseña temporal que captura el administrador (fase 04). */
  crearUsuario(correo: string, contrasena: string): Promise<CuentaSupabase>;
  /** R5.3: `generate_link(type:magiclink)`, que **no** envía correo. */
  enlaceMagico(correo: string): Promise<{ tokenHash: string }>;
  /** R6: `ban_duration` para que tampoco entre directo al CRM. */
  bloquear(id: string): Promise<void>;
  /** R6 al reactivar: quita el `ban_duration`. */
  desbloquear(id: string): Promise<void>;
  /** R6: cierra las sesiones abiertas de esa cuenta en Supabase. */
  cerrarSesiones(id: string): Promise<void>;
}

export interface OpcionesSupabase {
  url: string;
  anon: string;
  serviceRole: string;
  /** Inyectable para las pruebas; por omisión el `fetch` global. */
  buscar?: typeof fetch;
}

/** Bloqueo «para siempre» de R6; se quita con `none` al reactivar. */
const BLOQUEO = '876000h';

/** Lo que devuelve `generate_link`: el token y, de paso, la cuenta. */
interface RespuestaEnlace {
  properties?: { hashed_token?: string };
  user?: { id?: string; email?: string };
}

/** Crea el cliente contra la dirección dada (en pruebas, el Supabase falso). */
export function crearClienteSupabase(opciones: OpcionesSupabase): ClienteSupabase {
  const buscar = opciones.buscar ?? fetch;
  const base = opciones.url.replace(/\/+$/, '');

  /** Cabeceras de administración: llevan `service_role`, que nunca sale de aquí. */
  const admin = (): Record<string, string> => ({
    'content-type': 'application/json',
    apikey: opciones.serviceRole,
    authorization: `Bearer ${opciones.serviceRole}`,
  });

  async function pedir(ruta: string, init: RequestInit): Promise<Response> {
    return await buscar(`${base}${ruta}`, init);
  }

  /**
   * R5.3 y también la búsqueda por correo.
   *
   * Supabase Auth no tiene un «dame el usuario de este correo»: la manera
   * soportada es `generate_link`, que devuelve la cuenta junto con el token.
   * Generar el enlace no manda ningún correo ni inicia sesión de nadie, así
   * que sirve igual para averiguar si la cuenta existe.
   */
  async function generar(correo: string): Promise<RespuestaEnlace | null> {
    const respuesta = await pedir('/auth/v1/admin/generate_link', {
      method: 'POST',
      headers: admin(),
      body: JSON.stringify({ type: 'magiclink', email: correo.toLowerCase() }),
    });
    if (respuesta.status === 404 || respuesta.status === 422) return null;
    if (!respuesta.ok) throw new Error(`Supabase respondió ${respuesta.status} al generar el enlace.`);
    return (await respuesta.json()) as RespuestaEnlace;
  }

  return {
    async entrar(correo, contrasena) {
      const respuesta = await pedir('/auth/v1/token?grant_type=password', {
        method: 'POST',
        // La entrada va con la llave pública: no necesita `service_role`.
        headers: { 'content-type': 'application/json', apikey: opciones.anon },
        body: JSON.stringify({ email: correo.toLowerCase(), password: contrasena }),
      });
      if (!respuesta.ok) return { ok: false };
      const datos = (await respuesta.json()) as { user?: { id?: string; email?: string } };
      const id = datos.user?.id;
      if (!id) return { ok: false };
      return { ok: true, cuenta: { id, correo: (datos.user?.email ?? correo).toLowerCase() } };
    },

    async buscarPorCorreo(correo) {
      const datos = await generar(correo);
      const id = datos?.user?.id;
      if (!id) return null;
      return { id, correo: (datos?.user?.email ?? correo).toLowerCase() };
    },

    async crearUsuario(correo, contrasena) {
      const respuesta = await pedir('/auth/v1/admin/users', {
        method: 'POST',
        headers: admin(),
        body: JSON.stringify({ email: correo.toLowerCase(), password: contrasena, email_confirm: true }),
      });
      if (respuesta.status === 422) {
        // Ya existía: se reutiliza su cuenta en vez de inventar otra.
        const existente = await this.buscarPorCorreo(correo);
        if (existente) return existente;
      }
      if (!respuesta.ok) throw new Error(`Supabase respondió ${respuesta.status} al crear la cuenta.`);
      const datos = (await respuesta.json()) as { id?: string; email?: string };
      if (!datos.id) throw new Error('Supabase no devolvió el id de la cuenta creada.');
      return { id: datos.id, correo: (datos.email ?? correo).toLowerCase() };
    },

    async enlaceMagico(correo) {
      const datos = await generar(correo);
      const tokenHash = datos?.properties?.hashed_token;
      if (!tokenHash) throw new Error('Supabase no devolvió el token del enlace mágico.');
      return { tokenHash };
    },

    async bloquear(id) {
      const respuesta = await pedir(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: admin(),
        body: JSON.stringify({ ban_duration: BLOQUEO }),
      });
      if (!respuesta.ok) throw new Error(`Supabase respondió ${respuesta.status} al bloquear la cuenta.`);
    },

    async desbloquear(id) {
      const respuesta = await pedir(`/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: admin(),
        body: JSON.stringify({ ban_duration: 'none' }),
      });
      if (!respuesta.ok) throw new Error(`Supabase respondió ${respuesta.status} al desbloquear la cuenta.`);
    },

    async cerrarSesiones(id) {
      const respuesta = await pedir(`/auth/v1/admin/users/${encodeURIComponent(id)}/logout`, {
        method: 'POST',
        headers: admin(),
      });
      if (!respuesta.ok) throw new Error(`Supabase respondió ${respuesta.status} al cerrar las sesiones.`);
    },
  };
}

/**
 * R5.2: el correo debe existir en la lista de usuarios del CRM
 * (`public.crm_datos` con `tipo = 'usuarios'`, `borrado = false`), comparando
 * sin mayúsculas. Se lee con `pg`, del mismo Postgres del esquema `core`.
 *
 * Si la tabla todavía no existe (una instalación sin el CRM), la respuesta es
 * «no está»: más vale negar el paso que abrirlo por un descuido de montaje.
 */
export async function correoEnListaCrm(pool: Ejecutor, correo: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ uno: number }>(
      `SELECT 1 AS uno FROM public.crm_datos
        WHERE tipo = 'usuarios' AND borrado = false
          AND lower(datos ->> 'correo') = lower($1)
        LIMIT 1`,
      [correo],
    );
    return rows.length > 0;
  } catch (error) {
    // 42P01: la tabla no existe.
    if ((error as { code?: string } | null)?.code === '42P01') return false;
    throw error;
  }
}
