/**
 * R4: el CDH canjea el boleto contra el shell, por la red interna y con el
 * secreto compartido. Sin el secreto no se consulta ni se quema nada.
 */
import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Dependencias } from '../app.ts';
import type { CodigoModulo } from '../nucleo/tipos.ts';
import { canjearBoleto } from '../db/repos/boletos.ts';

/** Códigos HTTP de cada motivo de R4. */
export const ESTADO_POR_MOTIVO = {
  desconocido: 410,
  usado: 410,
  vencido: 410,
  modulo: 409,
  inactivo: 403,
} as const;

const MODULOS: readonly string[] = ['crm', 'cdh'];

/**
 * Compara en tiempo constante y sin delatar el largo: se comparan los SHA-256,
 * que siempre miden lo mismo.
 */
function mismoSecreto(enviado: string, esperado: string): boolean {
  const a = createHash('sha256').update(enviado, 'utf8').digest();
  const b = createHash('sha256').update(esperado, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function rutasSso(deps: Dependencias): Router {
  const rutas = Router();
  const ahora = deps.ahora ?? Date.now;

  /**
   * La puerta. Dos respuestas distintas a propósito:
   *
   * - **Sin** cabecera, la ruta no existe (404): para quien no es el CDH,
   *   `/api/sso/*` no debería ni asomarse (documento de la fase 04).
   * - **Con** cabecera equivocada, 401: es un rechazo explícito (PRD R4).
   *
   * En los dos casos se corta antes de tocar la base: el boleto no se quema.
   */
  rutas.use((peticion, respuesta, siguiente) => {
    const cabecera = peticion.get('x-cq-secreto');
    if (cabecera === undefined) {
      respuesta.status(404).json({ error: 'No encontrado.' });
      return;
    }
    if (!deps.config.ssoSecreto || !mismoSecreto(cabecera, deps.config.ssoSecreto)) {
      respuesta.status(401).json({ error: 'Secreto inválido.' });
      return;
    }
    siguiente();
  });

  rutas.post('/canjear', async (peticion, respuesta) => {
    const datos = peticion.body as { codigo?: unknown; modulo?: unknown };
    if (typeof datos?.codigo !== 'string' || typeof datos?.modulo !== 'string') {
      respuesta.status(400).json({ error: 'Falta el código o el módulo.' });
      return;
    }
    if (!MODULOS.includes(datos.modulo)) {
      // No es un módulo del catálogo: se rechaza sin quemar nada.
      respuesta.status(ESTADO_POR_MOTIVO.modulo).json({ motivo: 'modulo' });
      return;
    }

    const veredicto = await canjearBoleto(deps.pool, {
      codigo: datos.codigo,
      moduloQueCanjea: datos.modulo as CodigoModulo,
      ahora: ahora(),
    });

    if (!veredicto.ok) {
      respuesta.status(ESTADO_POR_MOTIVO[veredicto.motivo]).json({ motivo: veredicto.motivo });
      return;
    }
    respuesta.json({ usuario_modulo: veredicto.usuario_modulo, nombre: veredicto.nombre });
  });

  return rutas;
}
