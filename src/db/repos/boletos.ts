/**
 * `core.boletos` (PRD §6, R3 y R4). Del código sólo se guarda su SHA-256.
 * La emisión aplica R1/R3 (`puedeEntrar`, `nuevoCodigo`, `expiraEn`) y el canje
 * es **un solo `UPDATE … WHERE canjeado IS NULL … RETURNING`** más `evaluarCanje`
 * con las filas actuales (`src/nucleo/boletos.ts`).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { puedeEntrar } from '../../nucleo/accesos.ts';
import { evaluarCanje, expiraEn, nuevoCodigo } from '../../nucleo/boletos.ts';
import { hashToken } from '../../nucleo/cripto.ts';
import type {
  Acceso,
  Boleto,
  CodigoModulo,
  Instante,
  Modulo,
  MotivoCanje,
  MotivoNoEntra,
  Usuario,
} from '../../nucleo/tipos.ts';
import type { Ejecutor } from '../pool.ts';
import { enTransaccion } from '../pool.ts';
import { ACCIONES, ENTIDADES, anotar } from './bitacora.ts';

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

/**
 * Motivos por los que no se emite un boleto.
 *
 * Son los de R1 más `usuario_desconocido`: un id que no existe no es lo mismo
 * que una persona desactivada, y si los motivos se mapean a los dos textos 403
 * de R2 saldría el mensaje equivocado («Tu cuenta está desactivada» a quien
 * nunca tuvo cuenta).
 */
export type MotivoEmision = MotivoNoEntra | 'usuario_desconocido';

/** R3: el código en claro se devuelve **una sola vez**; en la base queda su hash. */
export type ResultadoEmision =
  | { ok: true; codigo: string; expira: Instante }
  | { ok: false; motivo: MotivoEmision };

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

/** Las filas tal como llegan de `pg`. */
type FilaUsuario = { id: string; correo: string; nombre: string; es_admin: boolean; activo: boolean };
type FilaModulo = { codigo: CodigoModulo; nombre: string; activo: boolean; orden: number };
type FilaAcceso = { usuario_id: string; modulo: CodigoModulo; usuario_modulo: string | null; activo: boolean };

/** La fila quemada más las filas de usuario, acceso y módulo leídas en el mismo instante. */
type FilaCanje = {
  id: string;
  usuario_id: string;
  modulo: CodigoModulo;
  usuario_modulo: string | null;
  emitido: Date;
  expira: Date;
  u_id: string | null;
  u_correo: string | null;
  u_nombre: string | null;
  u_es_admin: boolean | null;
  u_activo: boolean | null;
  a_usuario_id: string | null;
  a_modulo: CodigoModulo | null;
  a_usuario_modulo: string | null;
  a_activo: boolean | null;
  m_codigo: CodigoModulo | null;
  m_nombre: string | null;
  m_activo: boolean | null;
  m_orden: number | null;
};

/** Milisegundos de época a `timestamptz`, con aritmética exacta (sin flotantes). */
function enMs(parametro: number): string {
  return `(timestamptz 'epoch' + $${parametro}::bigint * interval '1 millisecond')`;
}

/**
 * R6: quema los boletos que esa persona no había canjeado y devuelve cuántos.
 * Vive aquí, junto a su tabla, para que la baja de una persona no tenga su
 * propia copia de la regla (`src/db/repos/usuarios.ts` la usa dentro de su
 * transacción). La hora la sella el servidor (PRD §6).
 */
export async function quemarPendientesDe(ejecutor: Ejecutor, usuarioId: string): Promise<number> {
  const { rowCount } = await ejecutor.query(
    // `SKIP LOCKED`: un boleto que alguien está canjeando en este mismo instante
    // se deja en manos de ese canje. Si se esperara a soltarlo, la baja quedaría
    // atrapada: el canje, al escribir en `core.boletos`, pide la llave ajena de
    // su persona (`FOR KEY SHARE` sobre `core.usuarios`), que esta misma
    // transacción ya tiene tomada —y las dos se abrazarían (40P01). El boleto
    // termina quemado igual, con el motivo que le ponga el canje, que vuelve a
    // leer a la persona y aplica R4 con las filas de ese momento.
    `UPDATE core.boletos SET canjeado = now(), resultado = $2
      WHERE id IN (SELECT id FROM core.boletos
                    WHERE usuario_id = $1::uuid AND canjeado IS NULL
                    FOR UPDATE SKIP LOCKED)`,
    [usuarioId, RESULTADO_USUARIO_DESACTIVADO],
  );
  return rowCount ?? 0;
}

/** R3: emite un boleto si R1 lo permite **en ese instante**; si no, no crea nada. */
export async function emitirBoleto(pool: Ejecutor, datos: DatosEmision): Promise<ResultadoEmision> {
  const { rows: modulos } = await pool.query<FilaModulo>(
    `SELECT codigo, nombre, activo, orden FROM core.modulos WHERE codigo = $1`,
    [datos.modulo],
  );
  const modulo: Modulo | null = modulos[0] ?? null;

  const { rows: usuarios } = await pool.query<FilaUsuario>(
    `SELECT id, correo, nombre, es_admin, activo FROM core.usuarios WHERE id = $1::uuid`,
    [datos.usuarioId],
  );
  const usuario: Usuario | null = usuarios[0] ?? null;
  // Sin módulo no hay nada que revisar; sin persona tampoco se abre nada.
  if (!modulo) return { ok: false, motivo: 'modulo_desconocido' };
  if (!usuario) return { ok: false, motivo: 'usuario_desconocido' };

  const { rows: accesos } = await pool.query<FilaAcceso>(
    `SELECT usuario_id, modulo, usuario_modulo, activo FROM core.accesos
      WHERE usuario_id = $1::uuid AND modulo = $2`,
    [datos.usuarioId, modulo.codigo],
  );
  const acceso: Acceso | null = accesos[0] ?? null;

  // R1/R3: la decisión es del núcleo, con las filas de este instante.
  const permiso = puedeEntrar(usuario, modulo, acceso);
  if (!permiso.ok) return { ok: false, motivo: permiso.motivo };

  const { codigo, hash } = nuevoCodigo(randomBytes);
  const expira = expiraEn(datos.ahora);
  const id = randomUUID();
  await pool.query(
    `INSERT INTO core.boletos (id, codigo_hash, usuario_id, modulo, usuario_modulo, emitido, expira, ip)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, ${enMs(6)}, ${enMs(7)}, $8)`,
    [id, hash, usuario.id, modulo.codigo, acceso?.usuario_modulo ?? null, datos.ahora, expira, datos.ip ?? null],
  );

  await anotar(pool, {
    quien: usuario.id,
    accion: ACCIONES.boletoEmitido,
    entidad: ENTIDADES.boleto,
    entidad_id: id,
    despues: { usuario_id: usuario.id, modulo: modulo.codigo, expira },
  });

  return { ok: true, codigo, expira };
}

/**
 * R4: un solo intento por boleto. Cualquier intento lo quema (`canjeado` y
 * `resultado`), salga bien o mal; un código desconocido no crea nada.
 *
 * Quemar el boleto, guardar el motivo y dejar constancia son **una sola
 * transacción**: si la bitácora o el motivo fallan, el boleto no queda
 * consumido y nunca existe una fila con `canjeado` y `resultado` en NULL.
 */
export async function canjearBoleto(pool: Ejecutor, datos: DatosCanje): Promise<ResultadoCanjeBoleto> {
  const hash = datos.codigo !== undefined ? hashToken(datos.codigo) : datos.codigoHash;
  if (!hash) throw new Error('Falta el código del boleto (o su hash) para canjearlo.');
  return await enTransaccion(pool, (cliente) => canjeEnTransaccion(cliente, datos, hash));
}

/** El canje propiamente dicho, con una transacción ya abierta. */
async function canjeEnTransaccion(
  pool: Ejecutor,
  datos: DatosCanje,
  hash: string,
): Promise<ResultadoCanjeBoleto> {
  // R4 e invariante 3: un solo `UPDATE … WHERE canjeado IS NULL … RETURNING` decide
  // quién gana; en la misma sentencia se leen el usuario, el acceso y el módulo de ahora.
  const { rows } = await pool.query<FilaCanje>(
    `WITH quemado AS (
       UPDATE core.boletos b SET canjeado = ${enMs(2)}
        WHERE b.codigo_hash = $1 AND b.canjeado IS NULL
       RETURNING b.id, b.usuario_id, b.modulo, b.usuario_modulo, b.emitido, b.expira
     )
     SELECT q.id, q.usuario_id, q.modulo, q.usuario_modulo, q.emitido, q.expira,
            u.id AS u_id, u.correo AS u_correo, u.nombre AS u_nombre,
            u.es_admin AS u_es_admin, u.activo AS u_activo,
            a.usuario_id AS a_usuario_id, a.modulo AS a_modulo,
            a.usuario_modulo AS a_usuario_modulo, a.activo AS a_activo,
            m.codigo AS m_codigo, m.nombre AS m_nombre, m.activo AS m_activo, m.orden AS m_orden
       FROM quemado q
       LEFT JOIN core.usuarios u ON u.id = q.usuario_id
       LEFT JOIN core.accesos a ON a.usuario_id = q.usuario_id AND a.modulo = q.modulo
       LEFT JOIN core.modulos m ON m.codigo = q.modulo`,
    [hash, datos.ahora],
  );

  const fila = rows[0];
  if (!fila) {
    // No se quemó nada: o alguien más llegó primero, o el código no existe.
    const { rows: existe } = await pool.query<{ id: string; resultado: string | null }>(
      `SELECT id, resultado FROM core.boletos WHERE codigo_hash = $1`,
      [hash],
    );
    const previo = existe[0];
    if (!previo) return { ok: false, motivo: 'desconocido' };
    // Si quien llegó primero fue la baja de esa persona (R6), el motivo exacto
    // es que ya no tiene acceso, no que el boleto se haya gastado: el CDH
    // merece el mensaje correcto aunque en los dos casos se le niegue el paso.
    if (previo.resultado === RESULTADO_USUARIO_DESACTIVADO) return { ok: false, motivo: 'inactivo' };
    return { ok: false, motivo: 'usado' };
  }

  const boleto: Boleto = {
    codigo_hash: hash,
    usuario_id: fila.usuario_id,
    modulo: fila.modulo,
    usuario_modulo: fila.usuario_modulo,
    emitido: fila.emitido.getTime(),
    expira: fila.expira.getTime(),
    // Lo acabamos de quemar nosotros: para el núcleo seguía sin canjear.
    canjeado: null,
    resultado: null,
  };
  const usuario: Usuario | null =
    fila.u_id === null
      ? null
      : {
          id: fila.u_id,
          correo: fila.u_correo ?? '',
          nombre: fila.u_nombre ?? '',
          es_admin: fila.u_es_admin ?? false,
          activo: fila.u_activo ?? false,
        };
  const acceso: Acceso | null =
    fila.a_usuario_id === null || fila.a_modulo === null
      ? null
      : {
          usuario_id: fila.a_usuario_id,
          modulo: fila.a_modulo,
          usuario_modulo: fila.a_usuario_modulo,
          activo: fila.a_activo ?? false,
        };
  const modulo: Modulo | null =
    fila.m_codigo === null
      ? null
      : {
          codigo: fila.m_codigo,
          nombre: fila.m_nombre ?? '',
          activo: fila.m_activo ?? false,
          orden: fila.m_orden ?? 0,
        };

  // R4: la decisión es del núcleo, con las filas actuales.
  const veredicto = evaluarCanje(boleto, {
    ahora: datos.ahora,
    moduloQueCanjea: datos.moduloQueCanjea,
    usuario,
    acceso,
    modulo,
  });
  const resultado = veredicto.ok ? RESULTADO_OK : veredicto.motivo;

  // El motivo queda guardado en el boleto ya quemado (R4).
  await pool.query(`UPDATE core.boletos SET resultado = $2 WHERE id = $1::uuid`, [fila.id, resultado]);

  await anotar(pool, {
    quien: fila.usuario_id,
    accion: ACCIONES.boletoCanjeado,
    entidad: ENTIDADES.boleto,
    entidad_id: fila.id,
    despues: { modulo: datos.moduloQueCanjea, resultado },
  });

  if (!veredicto.ok) return { ok: false, motivo: veredicto.motivo };
  return {
    ok: true,
    usuario_id: fila.usuario_id,
    nombre: usuario?.nombre ?? '',
    usuario_modulo: veredicto.usuario_modulo,
  };
}
