/**
 * `core.boletos` (PRD §6, R3 y R4). Del código sólo se guarda su SHA-256.
 * La emisión aplica R1/R3 (`puedeEntrar`, `nuevoCodigo`, `expiraEn`) y el canje
 * es **un solo `UPDATE … WHERE canjeado IS NULL … RETURNING`** más `evaluarCanje`
 * con las filas actuales (`src/nucleo/boletos.ts`).
 */
import type { CodigoModulo, Instante, MotivoCanje, MotivoNoEntra } from '../../nucleo/tipos.ts';
import type { Ejecutor } from '../pool.ts';

/** Valor de `boletos.resultado` cuando el canje salió bien. */
export const RESULTADO_OK = 'ok';

/** R6: motivo con el que se queman los boletos pendientes al desactivar a alguien. */
export const RESULTADO_USUARIO_DESACTIVADO = 'usuario_desactivado';

export interface DatosEmision {
  usuarioId: string;
  /** Código del módulo; si no existe en el catálogo, se rechaza con `modulo_desconocido`. */
  modulo: string;
  ahora: Instante;
  ip?: string | null;
}

/** R3: el código en claro se devuelve **una sola vez**; en la base queda su hash. */
export type ResultadoEmision =
  | { ok: true; codigo: string; expira: Instante }
  | { ok: false; motivo: MotivoNoEntra };

/** Se canjea por código en claro o por su hash (el CDH manda el código). */
export interface DatosCanje {
  codigo?: string;
  codigoHash?: string;
  moduloQueCanjea: CodigoModulo;
  ahora: Instante;
}

/** R4: lo que el shell responde al módulo que canjea. */
export type ResultadoCanjeBoleto =
  | { ok: true; usuario_id: string; nombre: string; usuario_modulo: string | null }
  | { ok: false; motivo: MotivoCanje };

/** R3: emite un boleto si R1 lo permite **en ese instante**; si no, no crea nada. */
export function emitirBoleto(pool: Ejecutor, datos: DatosEmision): Promise<ResultadoEmision> {
  void pool;
  void datos;
  throw new Error('no implementado');
}

/**
 * R4: un solo intento por boleto. Cualquier intento lo quema (`canjeado` y
 * `resultado`), salga bien o mal; un código desconocido no crea nada.
 */
export function canjearBoleto(pool: Ejecutor, datos: DatosCanje): Promise<ResultadoCanjeBoleto> {
  void pool;
  void datos;
  throw new Error('no implementado');
}
