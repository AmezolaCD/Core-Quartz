/**
 * Armado de la aplicación Express 5 del shell, montada bajo `CQ_BASE_PATH`
 * (por omisión `/portal`).
 *
 * Todo lo que toca el mundo exterior entra por `Dependencias`: el pool, la
 * configuración, los clientes de Supabase y del CDH, y el reloj. Las pruebas
 * pasan servidores HTTP locales de verdad en lugar de sustituir módulos, así
 * que también se prueban los códigos de estado.
 */
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Config } from './config.ts';
import type { ClienteSupabase } from './servicios/supabase-auth.ts';
import type { ClienteCdh } from './servicios/cdh-cliente.ts';

export interface Dependencias {
  pool: Pool;
  config: Config;
  supabase: ClienteSupabase;
  cdh: ClienteCdh;
  /** Reloj inyectable: el código nunca llama a `Date.now()` directamente. */
  ahora?: () => number;
}

/** Arma la aplicación con el prefijo de `config.basePath` ya aplicado. */
export function crearApp(_deps: Dependencias): Express {
  throw new Error('no implementado: crearApp');
}
