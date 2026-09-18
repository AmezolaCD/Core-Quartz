/**
 * Configuración del servidor, leída del entorno (PRD §9 y `.env.example`).
 *
 * Nada de esto viaja al navegador: `service_role`, `DATABASE_URL` y
 * `CQ_SSO_SECRETO` son secretos de servidor (invariante 5).
 */
import { normalizarBasePath } from './nucleo/enlaces.ts';

export interface Config {
  /** Puerto del shell. */
  puerto: number;
  /** Prefijo público del shell, normalizado (`''` o `/algo`). Por omisión `/portal`. */
  basePath: string;
  /** Prefijo público del CDH, normalizado. Por omisión `/cdh`. */
  basePathCdh: string;
  /** Postgres del esquema `core` (y de la lista de usuarios del CRM, R5.2). */
  databaseUrl: string;
  /** Dirección del proyecto Supabase (nunca se publica en el repo del CRM). */
  supabaseUrl: string;
  /** Llave pública; es la única que puede llegar al navegador. */
  supabaseAnon: string;
  /** Llave de administración: sólo servidor. */
  supabaseServiceRole: string;
  /** Secreto compartido con el CDH para `/api/sso/*` (R4). */
  ssoSecreto: string;
  /** Dirección interna del CDH (red privada), ya con su prefijo. */
  cdhInterno: string;
}

/** Lee y valida la configuración. Lanza si falta algo sin lo que no se puede servir. */
export function leerConfig(_entorno: NodeJS.ProcessEnv = process.env): Config {
  throw new Error('no implementado: leerConfig');
}

/** Normaliza un prefijo de ruta o lanza diciendo cuál venía mal. */
export function basePathValida(_nombre: string, _texto: string): string {
  throw new Error('no implementado: basePathValida');
}

export { normalizarBasePath };
