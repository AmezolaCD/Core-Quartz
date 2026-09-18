/**
 * Cliente del CDH por la red interna, con el secreto compartido (R4, R6, R7).
 * El shell **nunca** escribe en la base del CDH (invariante 1): sólo consulta
 * un usuario y pide revocar sesiones.
 */

/** Lo que el CDH contesta sobre uno de sus usuarios (R7). */
export interface UsuarioCdh {
  username: string;
  activo: boolean;
}

/** R6: la revocación puede fallar sin que la baja se deshaga (decisión #24). */
export type ResultadoRevocacion = { ok: true; revocadas: number } | { ok: false; error: string };

export interface ClienteCdh {
  /** R7: `GET <interno>/api/auth/sso/usuario/:username`. `null` si no existe. */
  usuario(username: string): Promise<UsuarioCdh | null>;
  /** R6: `POST <interno>/api/auth/sso/revocar`. Nunca lanza: devuelve el fallo. */
  revocar(usuarioModulo: string): Promise<ResultadoRevocacion>;
}

export interface OpcionesCdh {
  /** Dirección interna, ya con el prefijo del CDH. */
  interno: string;
  secreto: string;
  /** Inyectable para las pruebas; por omisión el `fetch` global. */
  buscar?: typeof fetch;
}

export function crearClienteCdh(_opciones: OpcionesCdh): ClienteCdh {
  throw new Error('no implementado: crearClienteCdh');
}
