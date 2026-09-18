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

/** Crea el cliente contra la dirección dada (en pruebas, el Supabase falso). */
export function crearClienteSupabase(_opciones: OpcionesSupabase): ClienteSupabase {
  throw new Error('no implementado: crearClienteSupabase');
}

/**
 * R5.2: el correo debe existir en la lista de usuarios del CRM
 * (`public.crm_datos` con `tipo = 'usuarios'`, `borrado = false`), comparando
 * sin mayúsculas. Se lee con `pg`, del mismo Postgres del esquema `core`.
 */
export async function correoEnListaCrm(_pool: Ejecutor, _correo: string): Promise<boolean> {
  throw new Error('no implementado: correoEnListaCrm');
}
