/**
 * `core.sesiones` (PRD §6 y R2). Del token sólo se guarda su SHA-256
 * (`hashToken` de `src/nucleo/cripto.ts`); el valor en claro nunca toca la base.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { nuevoCodigo } from '../../nucleo/boletos.ts';
import { hashToken } from '../../nucleo/cripto.ts';
import type { Instante } from '../../nucleo/tipos.ts';
import type { Ejecutor } from '../pool.ts';
import { ACCIONES, ENTIDADES, anotar } from './bitacora.ts';

/** R2: 12 horas. */
export const HORAS_SESION = 12;

const MS_POR_HORA = 3_600_000;

/** Datos de la sesión nueva; `ahora` lo pone quien llama (el núcleo nunca lee el reloj). */
export interface DatosSesion {
  ip?: string | null;
  agente?: string | null;
  ahora: Instante;
  /** Vigencia en horas; por omisión `HORAS_SESION`. */
  horas?: number;
}

/** Fila de `core.sesiones` con las horas en milisegundos de época. */
export interface Sesion {
  id: string;
  usuario_id: string;
  ip: string | null;
  agente: string | null;
  creada: Instante;
  expira: Instante;
  revocada: Instante | null;
}

/** La fila tal como llega de `pg` (las horas siguen siendo `timestamptz`). */
type FilaSesion = {
  id: string;
  usuario_id: string;
  ip: string | null;
  agente: string | null;
  creada: Date;
  expira: Date;
  revocada: Date | null;
};

const CAMPOS = 'id, usuario_id, ip, agente, creada, expira, revocada';

/** Milisegundos de época a `timestamptz`, con aritmética exacta (sin flotantes). */
function enMs(parametro: number): string {
  return `(timestamptz 'epoch' + $${parametro}::bigint * interval '1 millisecond')`;
}

function comoSesion(fila: FilaSesion): Sesion {
  return {
    id: fila.id,
    usuario_id: fila.usuario_id,
    ip: fila.ip,
    agente: fila.agente,
    creada: fila.creada.getTime(),
    expira: fila.expira.getTime(),
    revocada: fila.revocada ? fila.revocada.getTime() : null,
  };
}

/** Crea la sesión y devuelve el token en claro **una sola vez** (sólo se guarda su hash). */
export async function crearSesion(
  pool: Ejecutor,
  usuarioId: string,
  datos: DatosSesion,
): Promise<{ token: string; expira: Instante }> {
  const { codigo: token, hash } = nuevoCodigo(randomBytes);
  const horas = datos.horas ?? HORAS_SESION;
  const expira = datos.ahora + horas * MS_POR_HORA;
  const id = randomUUID();

  await pool.query(
    `INSERT INTO core.sesiones (id, usuario_id, token_hash, ip, agente, creada, expira)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, ${enMs(6)}, ${enMs(7)})`,
    [id, usuarioId, hash, datos.ip ?? null, datos.agente ?? null, datos.ahora, expira],
  );

  await anotar(pool, {
    quien: usuarioId,
    accion: ACCIONES.sesionCreada,
    entidad: ENTIDADES.sesion,
    entidad_id: id,
    despues: { usuario_id: usuarioId, expira },
  });

  return { token, expira };
}

/** Sesión viva del token (no revocada y `ahora <= expira`), o `null`. */
export async function resolverSesion(pool: Ejecutor, token: string, ahora: Instante): Promise<Sesion | null> {
  const { rows } = await pool.query<FilaSesion>(
    `SELECT ${CAMPOS} FROM core.sesiones
      WHERE token_hash = $1 AND revocada IS NULL AND expira >= ${enMs(2)}`,
    [hashToken(token), ahora],
  );
  const fila = rows[0];
  return fila ? comoSesion(fila) : null;
}

/** Revoca la sesión de ese token; `false` si no existía o ya estaba revocada. */
export async function revocarSesion(pool: Ejecutor, token: string, ahora: Instante): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE core.sesiones SET revocada = ${enMs(2)}
      WHERE token_hash = $1 AND revocada IS NULL
      RETURNING id`,
    [hashToken(token), ahora],
  );
  const fila = rows[0];
  if (!fila) return false;
  await anotar(pool, {
    quien: null,
    accion: ACCIONES.sesionRevocada,
    entidad: ENTIDADES.sesion,
    entidad_id: fila.id,
  });
  return true;
}

/**
 * Apaga todas las sesiones vivas de una persona y las anota. Es la única copia
 * de la regla: `ahora` sella la hora que pasa quien llama y, sin él, la sella
 * el servidor con `now()` (PRD §6).
 */
async function revocarVivasDe(ejecutor: Ejecutor, usuarioId: string, ahora?: Instante): Promise<number> {
  const cuando = ahora === undefined ? 'now()' : enMs(2);
  const valores = ahora === undefined ? [usuarioId] : [usuarioId, ahora];
  // «Viva» es sin revocar **y** sin vencer: una sesión que ya caducó no se
  // revoca porque no hay nada que cortar, y sobre todo no se cuenta, que si no
  // el número de «sesiones revocadas» que ve el administrador sale inflado.
  const { rowCount } = await ejecutor.query(
    `UPDATE core.sesiones SET revocada = ${cuando}
      WHERE usuario_id = $1::uuid AND revocada IS NULL AND expira >= ${cuando}`,
    valores,
  );
  const revocadas = rowCount ?? 0;
  if (revocadas > 0) {
    await anotar(ejecutor, {
      quien: null,
      accion: ACCIONES.sesionRevocada,
      entidad: ENTIDADES.sesion,
      entidad_id: usuarioId,
      despues: { revocadas },
    });
  }
  return revocadas;
}

/** R6: revoca todas las sesiones vivas de una persona y devuelve cuántas. */
export async function revocarSesionesDe(
  pool: Ejecutor,
  usuarioId: string,
  ahora: Instante,
  cliente?: Ejecutor,
): Promise<number> {
  return await revocarVivasDe(cliente ?? pool, usuarioId, ahora);
}

/**
 * R6: lo mismo, pero con la hora del servidor. Lo usa la baja de una persona,
 * que corre dentro de su propia transacción y no recibe ningún `ahora`.
 */
export async function revocarSesionesDeEnServidor(ejecutor: Ejecutor, usuarioId: string): Promise<number> {
  return await revocarVivasDe(ejecutor, usuarioId);
}

/** Borra las sesiones ya vencidas (mantenimiento) y devuelve cuántas. */
export async function purgarSesionesVencidas(pool: Ejecutor, ahora: Instante): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM core.sesiones WHERE expira < ${enMs(1)}`, [ahora]);
  return rowCount ?? 0;
}
