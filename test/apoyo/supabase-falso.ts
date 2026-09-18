/**
 * Supabase Auth simulado: un servidor HTTP **de verdad** en un puerto libre.
 *
 * La fase 04 pide simuladores locales y no sustituir módulos, para que las
 * pruebas también pasen por los códigos de estado y por el `fetch` real del
 * cliente. Guarda las llamadas recibidas para poder afirmar qué se llamó.
 */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface CuentaFalsa {
  id: string;
  correo: string;
  contrasena: string;
  /** R6: `ban_duration` puesto por el shell. */
  bloqueada: boolean;
  /** R6: cuántas veces se pidió cerrar sus sesiones. */
  cierres: number;
}

export interface LlamadaSupabase {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
}

export interface SupabaseFalso {
  url: string;
  llamadas: LlamadaSupabase[];
  /** Cuentas por correo en minúsculas. */
  cuentas: Map<string, CuentaFalsa>;
  agregar(correo: string, contrasena: string, id?: string): CuentaFalsa;
  /** Último `hashed_token` entregado por `generate_link`. */
  ultimoTokenHash: string | null;
  cerrar(): Promise<void>;
}

/** Cuerpo JSON de la petición (vacío si no trae). */
async function leerCuerpo(peticion: import('node:http').IncomingMessage): Promise<unknown> {
  const trozos: Buffer[] = [];
  for await (const t of peticion) trozos.push(t as Buffer);
  if (trozos.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8'));
  } catch {
    return {};
  }
}

export async function levantarSupabaseFalso(): Promise<SupabaseFalso> {
  const cuentas = new Map<string, CuentaFalsa>();
  const llamadas: LlamadaSupabase[] = [];
  const estado = { ultimoTokenHash: null as string | null };

  const servidor: Server = createServer(async (peticion, respuesta) => {
    const url = new URL(peticion.url ?? '/', 'http://local');
    const cuerpo = await leerCuerpo(peticion);
    llamadas.push({ metodo: peticion.method ?? 'GET', ruta: url.pathname + url.search, cuerpo });

    const responder = (estadoHttp: number, datos: unknown): void => {
      respuesta.writeHead(estadoHttp, { 'content-type': 'application/json' });
      respuesta.end(JSON.stringify(datos));
    };
    const datos = cuerpo as Record<string, string>;

    // R2.1: contraseña.
    if (peticion.method === 'POST' && url.pathname === '/auth/v1/token') {
      const cuenta = cuentas.get((datos.email ?? '').toLowerCase());
      if (!cuenta || cuenta.contrasena !== datos.password || cuenta.bloqueada) {
        return responder(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      return responder(200, {
        access_token: `falso.${cuenta.id}`,
        token_type: 'bearer',
        user: { id: cuenta.id, email: cuenta.correo },
      });
    }

    // Alta de cuenta (el admin captura una contraseña temporal).
    if (peticion.method === 'POST' && url.pathname === '/auth/v1/admin/users') {
      const correo = (datos.email ?? '').toLowerCase();
      if (cuentas.has(correo)) return responder(422, { msg: 'User already registered' });
      const cuenta: CuentaFalsa = {
        id: randomUUID(),
        correo,
        contrasena: datos.password ?? '',
        bloqueada: false,
        cierres: 0,
      };
      cuentas.set(correo, cuenta);
      return responder(200, { id: cuenta.id, email: cuenta.correo });
    }

    // R5.3: enlace mágico generado en el servidor (no envía correo).
    if (peticion.method === 'POST' && url.pathname === '/auth/v1/admin/generate_link') {
      const cuenta = cuentas.get((datos.email ?? '').toLowerCase());
      if (!cuenta) return responder(404, { msg: 'User not found' });
      const hash = `th_${randomUUID().replace(/-/g, '')}`;
      estado.ultimoTokenHash = hash;
      return responder(200, {
        properties: { hashed_token: hash, action_link: `https://ejemplo/verify?token=${hash}` },
        user: { id: cuenta.id, email: cuenta.correo },
      });
    }

    const cierre = /^\/auth\/v1\/admin\/users\/([^/]+)\/logout$/.exec(url.pathname);
    if (peticion.method === 'POST' && cierre) {
      const cuenta = [...cuentas.values()].find((c) => c.id === cierre[1]);
      if (!cuenta) return responder(404, { msg: 'User not found' });
      cuenta.cierres += 1;
      return responder(200, {});
    }

    const porId = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(url.pathname);
    if (peticion.method === 'PUT' && porId) {
      const cuenta = [...cuentas.values()].find((c) => c.id === porId[1]);
      if (!cuenta) return responder(404, { msg: 'User not found' });
      // R6: `ban_duration: 'none'` es el desbloqueo.
      cuenta.bloqueada = datos.ban_duration !== undefined && datos.ban_duration !== 'none';
      return responder(200, { id: cuenta.id, email: cuenta.correo });
    }

    return responder(404, { msg: 'ruta desconocida en el Supabase falso' });
  });

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = (servidor.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${puerto}`,
    llamadas,
    cuentas,
    agregar(correo, contrasena, id) {
      const cuenta: CuentaFalsa = {
        id: id ?? randomUUID(),
        correo: correo.toLowerCase(),
        contrasena,
        bloqueada: false,
        cierres: 0,
      };
      cuentas.set(cuenta.correo, cuenta);
      return cuenta;
    },
    get ultimoTokenHash() {
      return estado.ultimoTokenHash;
    },
    cerrar: () => {
      // Igual que el servidor del shell: sin esto, los sockets keep-alive del
      // cliente mantienen vivo el simulador y el cierre nunca termina.
      servidor.closeAllConnections();
      return new Promise<void>((listo) => servidor.close(() => listo()));
    },
  };
}
