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
  /** Secreto compartido con el CDH para `/api/sso/*` (R4). Vacío apaga esas rutas. */
  ssoSecreto: string;
  /** Dirección interna del CDH (red privada), ya con su prefijo. */
  cdhInterno: string;
}

/** Normaliza un prefijo de ruta o lanza diciendo cuál venía mal. */
export function basePathValida(nombre: string, texto: string): string {
  const normal = normalizarBasePath(texto);
  if (!normal.ok) throw new Error(`${nombre} no es un prefijo válido: ${JSON.stringify(texto)}`);
  return normal.valor;
}

/** Lee y valida la configuración. Lanza si falta algo sin lo que no se puede servir. */
export function leerConfig(entorno: NodeJS.ProcessEnv = process.env): Config {
  const exigir = (nombre: string): string => {
    const valor = entorno[nombre];
    if (valor === undefined || valor === '') throw new Error(`Falta ${nombre} en el entorno.`);
    return valor;
  };

  const puerto = Number(entorno.PORT ?? 4000);
  if (!Number.isInteger(puerto) || puerto < 0) throw new Error(`PORT no es un puerto válido: ${entorno.PORT}`);

  return {
    puerto,
    basePath: basePathValida('CQ_BASE_PATH', entorno.CQ_BASE_PATH ?? '/portal'),
    basePathCdh: basePathValida('CQ_BASE_PATH_CDH', entorno.CQ_BASE_PATH_CDH ?? '/cdh'),
    databaseUrl: exigir('DATABASE_URL'),
    supabaseUrl: exigir('SUPABASE_URL').replace(/\/+$/, ''),
    supabaseAnon: exigir('SUPABASE_ANON_KEY'),
    supabaseServiceRole: exigir('SUPABASE_SERVICE_ROLE_KEY'),
    // Sin secreto, `/api/sso/*` no se monta: el canje es la puerta del CDH y
    // más vale que no exista a que exista sin llave (R4).
    ssoSecreto: entorno.CQ_SSO_SECRETO ?? '',
    cdhInterno: (entorno.CQ_CDH_INTERNO ?? '').replace(/\/+$/, ''),
  };
}

export { normalizarBasePath };
