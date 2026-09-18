/**
 * CDH simulado: servidor HTTP real que expone sólo las dos rutas de sesión que
 * la fase 05 le agregará (R6 y R7). El shell **nunca** escribe en su base
 * (invariante 1), así que aquí no hay nada más.
 *
 * `caido` corta la conexión de golpe en lugar de responder un 5xx: R6 habla de
 * «el CDH no respondió», y un fallo de red es lo que de verdad pasa cuando la
 * VM está abajo. Un 500 probaría otra cosa.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface UsuarioCdhFalso {
  username: string;
  activo: boolean;
}

export interface LlamadaCdh {
  metodo: string;
  ruta: string;
  secreto: string | undefined;
  cuerpo: unknown;
}

export interface CdhFalso {
  /** Dirección interna **con** el prefijo del CDH, como `CQ_CDH_INTERNO`. */
  interno: string;
  secreto: string;
  llamadas: LlamadaCdh[];
  usuarios: Map<string, UsuarioCdhFalso>;
  agregar(username: string, activo?: boolean): UsuarioCdhFalso;
  /** Sesiones revocadas por `username` (R6). */
  revocaciones: Map<string, number>;
  /** Con `true`, toda petición muere sin respuesta. */
  caido: boolean;
  cerrar(): Promise<void>;
}

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

export interface OpcionesCdhFalso {
  secreto?: string;
  /** Prefijo del CDH; por omisión `/cdh`, como en producción. */
  basePath?: string;
}

export async function levantarCdhFalso(opciones: OpcionesCdhFalso = {}): Promise<CdhFalso> {
  const secreto = opciones.secreto ?? 'secreto-de-prueba';
  const basePath = opciones.basePath ?? '/cdh';
  const usuarios = new Map<string, UsuarioCdhFalso>();
  const revocaciones = new Map<string, number>();
  const llamadas: LlamadaCdh[] = [];
  const estado = { caido: false };

  const servidor: Server = createServer(async (peticion, respuesta) => {
    if (estado.caido) {
      peticion.socket.destroy();
      return;
    }
    const url = new URL(peticion.url ?? '/', 'http://local');
    const cuerpo = await leerCuerpo(peticion);
    const cabecera = peticion.headers['x-cq-secreto'];
    const enviado = Array.isArray(cabecera) ? cabecera[0] : cabecera;
    llamadas.push({ metodo: peticion.method ?? 'GET', ruta: url.pathname, secreto: enviado, cuerpo });

    const responder = (estadoHttp: number, datos: unknown): void => {
      respuesta.writeHead(estadoHttp, { 'content-type': 'application/json' });
      respuesta.end(JSON.stringify(datos));
    };

    if (enviado !== secreto) return responder(401, { error: 'secreto' });

    const consulta = new RegExp(`^${basePath}/api/auth/sso/usuario/([^/]+)$`).exec(url.pathname);
    if (peticion.method === 'GET' && consulta) {
      // R7: el CDH no distingue mayúsculas en su `username`.
      const usuario = usuarios.get(decodeURIComponent(consulta[1] ?? '').toLowerCase());
      if (!usuario) return responder(404, { error: 'no existe' });
      return responder(200, { username: usuario.username, active: usuario.activo ? 1 : 0 });
    }

    if (peticion.method === 'POST' && url.pathname === `${basePath}/api/auth/sso/revocar`) {
      const nombre = String((cuerpo as Record<string, unknown>).usuario_modulo ?? '').toLowerCase();
      const previas = revocaciones.get(nombre) ?? 0;
      revocaciones.set(nombre, previas + 1);
      return responder(200, { revocadas: 1 });
    }

    return responder(404, { error: 'ruta desconocida en el CDH falso' });
  });

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = (servidor.address() as AddressInfo).port;

  return {
    interno: `http://127.0.0.1:${puerto}${basePath}`,
    secreto,
    llamadas,
    usuarios,
    revocaciones,
    agregar(username, activo = true) {
      const usuario: UsuarioCdhFalso = { username, activo };
      usuarios.set(username.toLowerCase(), usuario);
      return usuario;
    },
    get caido() {
      return estado.caido;
    },
    set caido(valor: boolean) {
      estado.caido = valor;
    },
    cerrar: () => {
      // Igual que el servidor del shell: sin esto, los sockets keep-alive del
      // cliente mantienen vivo el simulador y el cierre nunca termina.
      servidor.closeAllConnections();
      return new Promise<void>((listo) => servidor.close(() => listo()));
    },
  };
}
