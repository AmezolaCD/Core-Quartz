/** R7: identidad por módulo (usuario del CDH ligado a una sola persona). */
import type { Acceso, NuevaAsignacion, ResultadoAsignacion, ResultadoNormalizacion, Usuario } from './tipos.ts';

/** R7: minúsculas y `[a-z0-9._-]{3,40}`. */
export function normalizarUsuarioCdh(texto: string): ResultadoNormalizacion {
  // Se valida antes de pasar a minúsculas para que ningún carácter no ASCII se «convierta» en uno válido.
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(texto)) return { ok: false, motivo: 'formato' };
  return { ok: true, valor: texto.toLowerCase() };
}

/**
 * R7: valida una asignación de acceso contra los accesos existentes.
 * CDH: normaliza el usuario y rechaza duplicados (sin distinguir mayúsculas) ligados a otra persona.
 * CRM: `usuario_modulo` debe venir nulo o vacío.
 */
export function validarAsignacion(
  nueva: NuevaAsignacion,
  accesosExistentes: Acceso[],
  usuarios: Usuario[],
): ResultadoAsignacion {
  if (nueva.modulo === 'crm') {
    // R7: en el CRM la identidad es el correo.
    return nueva.usuario_modulo ? { ok: false, motivo: 'crm_con_usuario' } : { ok: true, usuario_modulo: null };
  }
  const norm = normalizarUsuarioCdh(nueva.usuario_modulo ?? '');
  if (!norm.ok) return norm;
  // R7: uno a uno sin distinguir mayúsculas; los accesos inactivos también ocupan el nombre.
  const ocupado = accesosExistentes.find(
    (a) =>
      a.modulo === 'cdh' &&
      a.usuario_id !== nueva.usuario_id &&
      a.usuario_modulo !== null &&
      a.usuario_modulo.toLowerCase() === norm.valor,
  );
  if (ocupado) {
    const dueno = usuarios.find((u) => u.id === ocupado.usuario_id)?.nombre ?? ocupado.usuario_id;
    return { ok: false, motivo: 'duplicado', dueno };
  }
  return { ok: true, usuario_modulo: norm.valor };
}
