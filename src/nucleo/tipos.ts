/**
 * Tipos compartidos del núcleo de Core Quartz (PRD §6).
 *
 * Convención de horas: todas las horas son **milisegundos desde la época Unix**
 * (`number`, como `Date.prototype.getTime()`). El núcleo nunca lee el reloj:
 * quien llama pasa la hora como parámetro.
 */

/** Milisegundos desde la época Unix. */
export type Instante = number;

export type CodigoModulo = 'crm' | 'cdh';

export interface Usuario {
  id: string;
  /** Siempre en minúsculas. */
  correo: string;
  nombre: string;
  es_admin: boolean;
  activo: boolean;
}

export interface Modulo {
  codigo: CodigoModulo;
  nombre: string;
  activo: boolean;
  orden: number;
}

export interface Acceso {
  usuario_id: string;
  modulo: CodigoModulo;
  /** CDH: su `username`; CRM: siempre `null` (se usa el correo). */
  usuario_modulo: string | null;
  activo: boolean;
}

export interface Boleto {
  /** SHA-256 hex del código; el código en claro nunca se guarda. */
  codigo_hash: string;
  usuario_id: string;
  modulo: CodigoModulo;
  usuario_modulo: string | null;
  emitido: Instante;
  expira: Instante;
  /** `null` mientras no se haya intentado canjear. */
  canjeado: Instante | null;
  /** Motivo del canje (`'ok'` o el motivo del rechazo); `null` si no se ha canjeado. */
  resultado: string | null;
}

// ---- R1 ----

export type MotivoNoEntra =
  | 'usuario_inactivo'
  | 'modulo_inactivo'
  | 'sin_acceso'
  | 'acceso_inactivo'
  | 'sin_usuario_modulo'
  | 'modulo_desconocido';

export type ResultadoPuedeEntrar = { ok: true } | { ok: false; motivo: MotivoNoEntra };

// ---- R2 ----

export type ResultadoEntrada = 'ok' | 'sin_acceso' | 'desactivado';

// ---- R3 / R4 ----

/** Generador de bytes aleatorios inyectado (p. ej. `crypto.randomBytes` en el servidor). */
export type GeneradorBytes = (n: number) => Uint8Array;

export interface CodigoNuevo {
  /** base64url de 32 bytes: 43 caracteres. */
  codigo: string;
  /** SHA-256 hex de `codigo`. */
  hash: string;
}

export interface ContextoCanje {
  ahora: Instante;
  moduloQueCanjea: CodigoModulo;
  /** El usuario del boleto, leído al momento del canje. */
  usuario: Usuario | null;
  /** Su acceso al módulo del boleto, leído al momento del canje. */
  acceso: Acceso | null;
  /** La fila del módulo del boleto, leída al momento del canje (`null` si ya no existe). */
  modulo: Modulo | null;
}

export type MotivoCanje = 'desconocido' | 'usado' | 'vencido' | 'modulo' | 'inactivo';

export type ResultadoCanje =
  | { ok: true; usuario_modulo: string | null }
  | { ok: false; motivo: MotivoCanje };

// ---- R6 ----

export type ResultadoQuitarAdmin = { ok: true } | { ok: false; motivo: 'ultimo_admin' };

// ---- R7 ----

export type ResultadoNormalizacion = { ok: true; valor: string } | { ok: false; motivo: 'formato' };

export interface NuevaAsignacion {
  usuario_id: string;
  modulo: CodigoModulo;
  /** Texto tal como lo capturó la persona (o `null`). */
  usuario_modulo: string | null;
}

export type ResultadoAsignacion =
  | { ok: true; usuario_modulo: string | null }
  | { ok: false; motivo: 'formato' }
  | { ok: false; motivo: 'duplicado'; /** nombre del dueño */ dueno: string }
  | { ok: false; motivo: 'crm_con_usuario' };

// ---- Enlaces ----

export interface DatosEnlaceCrm {
  supabaseUrl: string;
  anon: string;
  tokenHash: string;
}

export interface DatosEnlaceCdh {
  /** Ya normalizada con `normalizarBasePath` (`''` o `'/algo'`). */
  basePathCdh: string;
  codigo: string;
}
