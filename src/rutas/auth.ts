/** R2: entrar, salir y saber quién soy. */
import { Router } from 'express';
import type { Dependencias } from '../app.ts';
import { validarEntrada } from '../nucleo/accesos.ts';
import { modulosVisiblesDe } from '../db/repos/accesos.ts';
import { crearSesion, revocarSesion } from '../db/repos/sesiones.ts';
import { obtenerPorCorreo } from '../db/repos/usuarios.ts';
import { COOKIE_SESION, exigirSesion, opcionesCookie } from '../middleware/sesion.ts';
import { crearLimite } from '../middleware/limite.ts';

/** Textos exactos de R2 (el PRD los fija; las pruebas los comparan). */
export const MENSAJES = {
  credenciales: 'Correo o contraseña incorrectos',
  sinAcceso: 'Tu cuenta aún no tiene acceso a Core Quartz. Pídeselo a Sistemas.',
  desactivada: 'Tu cuenta está desactivada.',
  demasiados: 'Demasiados intentos. Espera unos minutos.',
} as const;

/** Lo que se devuelve de una persona: nunca más que esto. */
function comoPublico(usuario: { id: string; correo: string; nombre: string; es_admin: boolean }) {
  return { id: usuario.id, correo: usuario.correo, nombre: usuario.nombre, es_admin: usuario.es_admin };
}

export function rutasAuth(deps: Dependencias): Router {
  const rutas = Router();
  const ahora = deps.ahora ?? Date.now;
  const limite = crearLimite();

  rutas.post('/entrar', async (peticion, respuesta) => {
    const datos = peticion.body as { correo?: unknown; contrasena?: unknown };
    if (typeof datos?.correo !== 'string' || typeof datos?.contrasena !== 'string') {
      respuesta.status(400).json({ error: 'Faltan el correo y la contraseña.' });
      return;
    }
    const correo = datos.correo.trim().toLowerCase();
    const cuando = ahora();

    // El límite cuenta por IP y por correo: cambiar de IP no regala intentos
    // nuevos sobre la misma cuenta (PRD §5, riesgo 3).
    const porIp = `ip:${peticion.ip ?? ''}`;
    const porCorreo = `correo:${correo}`;
    const admitido = limite.admite(porIp, cuando) && limite.admite(porCorreo, cuando);
    if (!admitido) {
      respuesta.status(429).json({ error: MENSAJES.demasiados });
      return;
    }

    const veredicto = await deps.supabase.entrar(correo, datos.contrasena);
    if (!veredicto.ok) {
      // R2: el mismo texto que si el correo no existiera, para no delatar cuentas.
      respuesta.status(401).json({ error: MENSAJES.credenciales });
      return;
    }

    // R2.2: además de Supabase, exige su fila en `core.usuarios`.
    const usuario = await obtenerPorCorreo(deps.pool, correo);
    const entrada = validarEntrada(usuario);
    if (entrada === 'sin_acceso') {
      respuesta.status(403).json({ error: MENSAJES.sinAcceso });
      return;
    }
    if (entrada === 'desactivado') {
      respuesta.status(403).json({ error: MENSAJES.desactivada });
      return;
    }
    if (!usuario) {
      respuesta.status(403).json({ error: MENSAJES.sinAcceso });
      return;
    }

    const { token, expira } = await crearSesion(deps.pool, usuario.id, {
      ip: peticion.ip ?? null,
      agente: peticion.get('user-agent') ?? null,
      ahora: cuando,
    });

    // Entró bien: su cupo vuelve a empezar.
    limite.olvidar(porIp);
    limite.olvidar(porCorreo);

    respuesta.cookie(COOKIE_SESION, token, opcionesCookie(deps.config.basePath, peticion.secure, expira));
    respuesta.json({ usuario: comoPublico(usuario), modulos: await modulosVisiblesDe(deps.pool, usuario.id) });
  });

  rutas.post('/salir', exigirSesion(), async (peticion, respuesta) => {
    await revocarSesion(deps.pool, peticion.cq?.token ?? '', ahora());
    respuesta.clearCookie(COOKIE_SESION, opcionesCookie(deps.config.basePath, peticion.secure));
    respuesta.json({ ok: true });
  });

  rutas.get('/yo', exigirSesion(), async (peticion, respuesta) => {
    const usuario = peticion.cq!.usuario;
    respuesta.json({ usuario: comoPublico(usuario), modulos: await modulosVisiblesDe(deps.pool, usuario.id) });
  });

  return rutas;
}
