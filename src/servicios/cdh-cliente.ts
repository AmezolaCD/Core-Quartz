/**
 * Cliente del CDH por la red interna, con el secreto compartido (R4, R6, R7).
 * El shell **nunca** escribe en la base del CDH (invariante 1): sólo consulta
 * un usuario y pide revocar sesiones.
 */

/** Lo que el CDH contesta sobre uno de sus usuarios (R7). */
export interface UsuarioCdh {
  username: string;
  activo: boolean;
  /**
   * Identidad no interactiva del CDH —con la que el PMS firma lo que escribe
   * allá—. No es de una persona y no puede asignarse a nadie: el CDH no le
   * abre sesión ni por el canje ni con contraseña.
   */
  servicio: boolean;
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

export function crearClienteCdh(opciones: OpcionesCdh): ClienteCdh {
  const buscar = opciones.buscar ?? fetch;
  const base = opciones.interno.replace(/\/+$/, '');
  const cabeceras = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-cq-secreto': opciones.secreto,
  });

  return {
    async usuario(username) {
      const respuesta = await buscar(`${base}/api/auth/sso/usuario/${encodeURIComponent(username)}`, {
        method: 'GET',
        headers: cabeceras(),
      });
      if (respuesta.status === 404) return null;
      if (!respuesta.ok) throw new Error(`El CDH respondió ${respuesta.status} al consultar el usuario.`);
      // El contrato real del CDH (server/routes/sso.js): `{ existe, activo, servicio }`.
      const datos = (await respuesta.json()) as {
        existe?: unknown;
        activo?: unknown;
        servicio?: unknown;
      };
      if (datos.existe !== true) return null;
      // Un CDH anterior a su PR #25 no manda `servicio`, y entonces aquí sale
      // `false`: el portal se comporta como antes. No es un hueco —ese CDH
      // tampoco tiene identidades de servicio— y el CDH que sí las tiene
      // rechaza el canje por su cuenta, así que nunca abre sesión.
      return { username, activo: datos.activo === true, servicio: datos.servicio === true };
    },

    async revocar(usuarioModulo) {
      // R6 y decisión #24: quitar acceso nunca depende de que el CDH esté
      // arriba, así que un fallo se devuelve, no se lanza.
      try {
        const respuesta = await buscar(`${base}/api/auth/sso/revocar`, {
          method: 'POST',
          headers: cabeceras(),
          body: JSON.stringify({ usuario_modulo: usuarioModulo }),
        });
        if (!respuesta.ok) return { ok: false, error: `el CDH respondió ${respuesta.status}` };
        const datos = (await respuesta.json()) as { revocadas?: number };
        return { ok: true, revocadas: datos.revocadas ?? 0 };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
