/** R1, R2.2 y R6: qué puede abrir una persona y quién puede dejar de ser admin. */
import type {
  Acceso,
  CodigoModulo,
  Modulo,
  ResultadoEntrada,
  ResultadoPuedeEntrar,
  ResultadoQuitarAdmin,
  Usuario,
} from './tipos.ts';

/**
 * R1: módulos que la persona ve, ordenados por `modulos.orden`.
 * `accesos` puede traer filas de otras personas; sólo cuentan las de `usuario.id`.
 */
export function modulosVisibles(usuario: Usuario, modulos: Modulo[], accesos: Acceso[]): CodigoModulo[] {
  return modulos
    .filter((m) => {
      const acceso = accesos.find((a) => a.usuario_id === usuario.id && a.modulo === m.codigo) ?? null;
      return puedeEntrar(usuario, m, acceso).ok;
    })
    .sort((a, b) => a.orden - b.orden)
    .map((m) => m.codigo);
}

/**
 * R1/R3: si la persona puede abrir el módulo en este instante.
 * `modulo` es `null` cuando el código pedido no existe en el catálogo.
 * `acceso` es `null` cuando no hay fila de acceso para ese módulo.
 */
export function puedeEntrar(usuario: Usuario, modulo: Modulo | null, acceso: Acceso | null): ResultadoPuedeEntrar {
  if (!modulo) return { ok: false, motivo: 'modulo_desconocido' };
  if (!usuario.activo) return { ok: false, motivo: 'usuario_inactivo' };
  if (!modulo.activo) return { ok: false, motivo: 'modulo_inactivo' };
  if (!acceso) return { ok: false, motivo: 'sin_acceso' };
  if (!acceso.activo) return { ok: false, motivo: 'acceso_inactivo' };
  // R1: el CDH además exige su usuario (el admin no da acceso por sí solo).
  if (modulo.codigo === 'cdh' && !acceso.usuario_modulo) return { ok: false, motivo: 'sin_usuario_modulo' };
  return { ok: true };
}

/** R2.2: la fila de `core.usuarios` (o `null` si no existe) decide si entra al portal. */
export function validarEntrada(usuario: Usuario | null): ResultadoEntrada {
  if (!usuario) return 'sin_acceso';
  return usuario.activo ? 'ok' : 'desactivado';
}

/**
 * R6: si se le puede quitar `es_admin` —o desactivar— a `objetivoId` sin dejar
 * al portal sin administradores activos (admin activo = `es_admin && activo`).
 */
export function puedeQuitarAdmin(objetivoId: string, usuarios: Usuario[]): ResultadoQuitarAdmin {
  const adminActivo = (u: Usuario) => u.es_admin && u.activo;
  const objetivo = usuarios.find((u) => u.id === objetivoId);
  if (!objetivo || !adminActivo(objetivo)) return { ok: true };
  const otros = usuarios.some((u) => u.id !== objetivoId && adminActivo(u));
  return otros ? { ok: true } : { ok: false, motivo: 'ultimo_admin' };
}
