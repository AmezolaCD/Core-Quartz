/** R3 y R4: emisión y canje de boletos de un solo uso. */
import { puedeEntrar } from './accesos.ts';
import { hashToken } from './cripto.ts';
import type { Boleto, CodigoNuevo, ContextoCanje, GeneradorBytes, Instante, ResultadoCanje } from './tipos.ts';

/** Vigencia de un boleto. */
export const VIGENCIA_BOLETO_MS = 60_000;

/** R3: código de 32 bytes (del `rng` inyectado) en base64url y su SHA-256 hex. */
export function nuevoCodigo(rng: GeneradorBytes): CodigoNuevo {
  const codigo = Buffer.from(rng(32)).toString('base64url');
  return { codigo, hash: hashToken(codigo) };
}

/** R3: `emitido + 60 000 ms`. */
export function expiraEn(emitido: Instante): Instante {
  return emitido + VIGENCIA_BOLETO_MS;
}

/**
 * R4: decide un canje. Orden de revisión: desconocido → usado → vencido
 * (límite inclusivo, `ahora <= expira`) → modulo → inactivo (R1 con las filas actuales).
 */
export function evaluarCanje(boleto: Boleto | null, contexto: ContextoCanje): ResultadoCanje {
  if (!boleto) return { ok: false, motivo: 'desconocido' };
  // R4: cualquier intento previo (bueno o malo) ya lo quemó.
  if (boleto.canjeado !== null) return { ok: false, motivo: 'usado' };
  // R4: límite inclusivo.
  if (contexto.ahora > boleto.expira) return { ok: false, motivo: 'vencido' };
  if (boleto.modulo !== contexto.moduloQueCanjea) return { ok: false, motivo: 'modulo' };
  // R4: al canjear se vuelve a aplicar R1 con las filas actuales, que deben ser las del boleto.
  const { usuario, acceso, modulo } = contexto;
  const inactivo = { ok: false, motivo: 'inactivo' } as const;
  if (!usuario || !acceso || !modulo) return inactivo;
  if (usuario.id !== boleto.usuario_id || acceso.usuario_id !== boleto.usuario_id) return inactivo;
  if (acceso.modulo !== boleto.modulo || modulo.codigo !== boleto.modulo) return inactivo;
  if (!puedeEntrar(usuario, modulo, acceso).ok) return inactivo;
  if (boleto.modulo === 'crm') return { ok: true, usuario_modulo: null };
  // CDH: si el usuario se religó tras emitir, el boleto ya no vale (R7 sin distinguir mayúsculas).
  if (acceso.usuario_modulo?.toLowerCase() !== boleto.usuario_modulo?.toLowerCase()) return inactivo;
  return { ok: true, usuario_modulo: acceso.usuario_modulo };
}
