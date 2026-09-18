/** R3 y R5: abrir un módulo (boleto para el CDH, enlace mágico para el CRM). */
import { Router } from 'express';
import type { Dependencias } from '../app.ts';
import { puedeEntrar } from '../nucleo/accesos.ts';
import { enlaceCdh, enlaceCrm } from '../nucleo/enlaces.ts';
import type { CodigoModulo } from '../nucleo/tipos.ts';
import { listarAccesosDe, listarModulos } from '../db/repos/accesos.ts';
import { emitirBoleto } from '../db/repos/boletos.ts';
import { correoEnListaCrm } from '../servicios/supabase-auth.ts';
import { exigirSesion } from '../middleware/sesion.ts';

/** Textos exactos de R3 y R5. */
export const MENSAJES = {
  sinAcceso: 'No tienes acceso a este módulo.',
  desconocido: 'Módulo desconocido.',
  faltaEnCrm: 'Primero dalo de alta en CRM → Ajustes → Usuarios y permisos',
} as const;

export function rutasModulos(deps: Dependencias): Router {
  const rutas = Router();
  const ahora = deps.ahora ?? Date.now;

  rutas.get('/:codigo/abrir', exigirSesion(), async (peticion, respuesta) => {
    const usuario = peticion.cq!.usuario;
    const codigo = String(peticion.params.codigo ?? '');

    const catalogo = await listarModulos(deps.pool);
    const modulo = catalogo.find((m) => m.codigo === codigo) ?? null;
    if (!modulo) {
      respuesta.status(404).json({ error: MENSAJES.desconocido });
      return;
    }

    // R1 se aplica **en este instante**, antes de crear nada.
    const accesos = await listarAccesosDe(deps.pool, usuario.id);
    const acceso = accesos.find((a) => a.modulo === modulo.codigo) ?? null;
    if (!puedeEntrar(usuario, modulo, acceso).ok) {
      respuesta.status(403).json({ error: MENSAJES.sinAcceso });
      return;
    }

    const ip = peticion.ip ?? null;

    if (modulo.codigo === 'crm') {
      // R5.2: el correo debe estar en la lista de usuarios del CRM. Se revisa
      // antes de pedirle nada a Supabase y antes de dejar constancia.
      if (!(await correoEnListaCrm(deps.pool, usuario.correo))) {
        respuesta.status(409).json({ error: MENSAJES.faltaEnCrm });
        return;
      }
      const { tokenHash } = await deps.supabase.enlaceMagico(usuario.correo);
      // R5.3: la constancia va en `core.boletos`; el uso único y la caducidad
      // los impone Supabase, no nosotros.
      await emitirBoleto(deps.pool, { usuarioId: usuario.id, modulo: 'crm', ahora: ahora(), ip });
      respuesta.redirect(
        302,
        enlaceCrm({
          supabaseUrl: deps.config.supabaseUrl,
          anon: deps.config.supabaseAnon,
          tokenHash,
        }),
      );
      return;
    }

    // R3: boleto de un solo uso para el CDH.
    const emision = await emitirBoleto(deps.pool, {
      usuarioId: usuario.id,
      modulo: modulo.codigo as CodigoModulo,
      ahora: ahora(),
      ip,
    });
    if (!emision.ok) {
      // R1 ya pasó arriba; si aquí falla, algo cambió entre medio.
      const estado = emision.motivo === 'modulo_desconocido' ? 404 : 403;
      respuesta
        .status(estado)
        .json({ error: estado === 404 ? MENSAJES.desconocido : MENSAJES.sinAcceso });
      return;
    }
    respuesta.redirect(302, enlaceCdh({ basePathCdh: deps.config.basePathCdh, codigo: emision.codigo }));
  });

  return rutas;
}
