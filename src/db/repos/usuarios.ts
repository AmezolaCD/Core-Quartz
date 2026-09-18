/**
 * `core.usuarios` (PRD §6). Las reglas viven en `src/nucleo`; aquí sólo se leen
 * y escriben filas y se aplican esas decisiones.
 */
import { puedeQuitarAdmin } from '../../nucleo/accesos.ts';
import type { Usuario } from '../../nucleo/tipos.ts';
import type { Ejecutor } from '../pool.ts';
import { enTransaccion } from '../pool.ts';
import { ACCIONES, ENTIDADES, anotar } from './bitacora.ts';
import { quemarPendientesDe } from './boletos.ts';
import { revocarSesionesDeEnServidor } from './sesiones.ts';

/** Alta: `id` es el de `auth.users`; el correo se guarda en minúsculas. */
export interface NuevoUsuario {
  id: string;
  correo: string;
  nombre: string;
  es_admin?: boolean;
  activo?: boolean;
}

/** Campos editables de una persona (R6: `activo` también se toca con `desactivarUsuario`). */
export interface CambiosUsuario {
  nombre?: string;
  correo?: string;
  es_admin?: boolean;
  activo?: boolean;
}

/** R6: el rechazo por dejar al portal sin administradores activos. */
export type RechazoUltimoAdmin = { ok: false; motivo: 'ultimo_admin' };

/**
 * R6: lo que deja la desactivación. `ultimo_admin` viene de `puedeQuitarAdmin`
 * (`src/nucleo/accesos.ts`) y no cambia nada.
 */
export type ResultadoDesactivacion =
  | { ok: true; usuario: Usuario; sesiones_revocadas: number; boletos_quemados: number }
  | { ok: false; motivo: 'desconocido' | 'ultimo_admin' }
  | RechazoUltimoAdmin;

/**
 * Lo que devuelve `actualizarUsuario`: la persona ya cambiada, `null` si no
 * existe, o el rechazo de R6 cuando el cambio dejaría al portal sin
 * administradores activos. Cada rama declara las llaves de la otra como
 * `undefined` para que `usuario?.nombre` siga siendo legible sin estrechar.
 */
export type ResultadoActualizacion =
  | (Usuario & { ok?: undefined; motivo?: undefined })
  | (RechazoUltimoAdmin & { [K in keyof Usuario]?: undefined });

/** Columnas de `core.usuarios` que forman un `Usuario` del núcleo. */
const CAMPOS = 'id, correo, nombre, es_admin, activo';

/** La fila tal como llega de `pg` (con firma de índice, como pide `query<…>`). */
type FilaUsuario = {
  id: string;
  correo: string;
  nombre: string;
  es_admin: boolean;
  activo: boolean;
};

/** Alta de una persona (y su anotación en la bitácora). */
export async function crearUsuario(pool: Ejecutor, datos: NuevoUsuario, actor?: string | null): Promise<Usuario> {
  const { rows } = await pool.query<FilaUsuario>(
    `INSERT INTO core.usuarios (id, correo, nombre, es_admin, activo)
     VALUES ($1, lower($2), $3, coalesce($4::boolean, false), coalesce($5::boolean, true))
     RETURNING ${CAMPOS}`,
    [datos.id, datos.correo, datos.nombre, datos.es_admin ?? null, datos.activo ?? null],
  );
  const usuario = rows[0];
  if (!usuario) throw new Error('no se pudo crear la persona');
  await anotar(pool, {
    quien: actor ?? null,
    accion: ACCIONES.usuarioCreado,
    entidad: ENTIDADES.usuario,
    entidad_id: usuario.id,
    despues: usuario,
  });
  return usuario;
}

/** Busca por correo sin distinguir mayúsculas (R2). */
export async function obtenerPorCorreo(pool: Ejecutor, correo: string): Promise<Usuario | null> {
  const { rows } = await pool.query<FilaUsuario>(
    `SELECT ${CAMPOS} FROM core.usuarios WHERE lower(correo) = lower($1)`,
    [correo],
  );
  return rows[0] ?? null;
}

export async function obtenerPorId(pool: Ejecutor, id: string): Promise<Usuario | null> {
  const { rows } = await pool.query<FilaUsuario>(`SELECT ${CAMPOS} FROM core.usuarios WHERE id = $1::uuid`, [id]);
  return rows[0] ?? null;
}

/** Todas las personas, ordenadas por nombre. */
export async function listarUsuarios(pool: Ejecutor): Promise<Usuario[]> {
  const { rows } = await pool.query<FilaUsuario>(`SELECT ${CAMPOS} FROM core.usuarios ORDER BY nombre, correo`);
  return rows;
}

// ---- Piezas compartidas por `actualizarUsuario` y `desactivarUsuario` (R6) ----

/**
 * R6, sin sesgo de escritura: censo de administradoras activas **bloqueado**
 * dentro de la transacción, para que dos bajas simultáneas no cuenten las
 * mismas filas y ambas se crean acompañadas. Se bloquea siempre en el mismo
 * orden (`id`) y antes que la persona objetivo, así dos bajas a la vez se
 * ponen en fila en lugar de abrazarse.
 *
 * A `puedeQuitarAdmin` le basta este censo: quien no sea administradora activa
 * no aparece, y para esa persona la respuesta ya es «sí» (`src/nucleo`).
 */
async function censoAdminsBloqueado(cliente: Ejecutor): Promise<Usuario[]> {
  const { rows } = await cliente.query<FilaUsuario>(
    `SELECT ${CAMPOS} FROM core.usuarios WHERE es_admin AND activo ORDER BY id FOR UPDATE`,
  );
  return rows;
}

/** Toma la fila de la persona y la bloquea hasta el fin de la transacción. */
async function bloquearPersona(cliente: Ejecutor, id: string): Promise<Usuario | null> {
  const { rows } = await cliente.query<FilaUsuario>(
    `SELECT ${CAMPOS} FROM core.usuarios WHERE id = $1::uuid FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

/** Escribe los campos pedidos (sin decidir nada). `null` si la fila ya no está. */
async function aplicarCambios(cliente: Ejecutor, id: string, cambios: CambiosUsuario): Promise<Usuario | null> {
  const asignaciones: string[] = [];
  const valores: unknown[] = [id];
  // Los nombres de columna salen de esta lista cerrada; los valores siempre van parametrizados.
  if (cambios.nombre !== undefined) {
    valores.push(cambios.nombre);
    asignaciones.push(`nombre = $${valores.length}`);
  }
  if (cambios.correo !== undefined) {
    valores.push(cambios.correo);
    asignaciones.push(`correo = lower($${valores.length})`);
  }
  if (cambios.es_admin !== undefined) {
    valores.push(cambios.es_admin);
    asignaciones.push(`es_admin = $${valores.length}`);
  }
  if (cambios.activo !== undefined) {
    valores.push(cambios.activo);
    asignaciones.push(`activo = $${valores.length}`);
  }
  if (asignaciones.length === 0) return await obtenerPorId(cliente, id);

  const { rows } = await cliente.query<FilaUsuario>(
    `UPDATE core.usuarios SET ${asignaciones.join(', ')}, actualizado = now()
      WHERE id = $1::uuid RETURNING ${CAMPOS}`,
    valores,
  );
  return rows[0] ?? null;
}

/**
 * R6, camino único de la baja, con la transacción ya abierta y la persona ya
 * bloqueada: `activo = false`, se revocan sus sesiones, se queman sus boletos
 * sin canjear y se deja constancia. Lo usan `desactivarUsuario` y también
 * `actualizarUsuario` cuando el cambio es una baja.
 */
async function aplicarBaja(
  cliente: Ejecutor,
  id: string,
  antes: Usuario,
  actor?: string | null,
): Promise<{ usuario: Usuario; sesiones_revocadas: number; boletos_quemados: number }> {
  const usuario = await aplicarCambios(cliente, id, { activo: false });
  if (!usuario) throw new Error('la persona desapareció durante su baja');

  const sesiones_revocadas = await revocarSesionesDeEnServidor(cliente, id);
  const boletos_quemados = await quemarPendientesDe(cliente, id);

  // La bitácora va con el mismo cliente: o queda todo, o no queda nada (R6).
  await anotar(cliente, {
    quien: actor ?? null,
    accion: ACCIONES.usuarioDesactivado,
    entidad: ENTIDADES.usuario,
    entidad_id: id,
    antes,
    despues: { ...usuario, sesiones_revocadas, boletos_quemados },
  });
  return { usuario, sesiones_revocadas, boletos_quemados };
}

/** R6: ¿este cambio le quitaría al portal una administradora activa? */
function tocaAlUltimoAdmin(cambios: CambiosUsuario): boolean {
  return cambios.activo === false || cambios.es_admin === false;
}

/**
 * Cambia los campos indicados (y anota el antes/después). `null` si no existe.
 *
 * R6: bajar a alguien —o quitarle `es_admin`— pasa por la misma puerta que
 * `desactivarUsuario`: se rechaza con `{ok:false, motivo:'ultimo_admin'}` si
 * dejaría al portal sin administradoras, y una baja revoca sus sesiones y
 * quema sus boletos pendientes en la misma transacción.
 */
export async function actualizarUsuario(
  pool: Ejecutor,
  id: string,
  cambios: CambiosUsuario,
  actor?: string | null,
): Promise<ResultadoActualizacion | null> {
  return await enTransaccion(pool, async (cliente): Promise<ResultadoActualizacion | null> => {
    const revisarAdmin = tocaAlUltimoAdmin(cambios);
    const censo = revisarAdmin ? await censoAdminsBloqueado(cliente) : [];

    const antes = await bloquearPersona(cliente, id);
    if (!antes) return null;

    if (revisarAdmin) {
      const permiso = puedeQuitarAdmin(id, censo);
      if (!permiso.ok) return { ok: false, motivo: permiso.motivo };
    }

    // R6: una baja es más que cambiar una columna; va por el camino compartido.
    let despues: Usuario | null;
    if (cambios.activo === false) {
      const { activo: _baja, ...resto } = cambios;
      if (Object.keys(resto).length > 0) await aplicarCambios(cliente, id, resto);
      ({ usuario: despues } = await aplicarBaja(cliente, id, antes, actor));
    } else {
      despues = await aplicarCambios(cliente, id, cambios);
    }
    if (!despues) return null;

    await anotar(cliente, {
      quien: actor ?? null,
      accion: ACCIONES.usuarioActualizado,
      entidad: ENTIDADES.usuario,
      entidad_id: id,
      antes,
      despues,
    });
    return despues;
  });
}

/**
 * R6, todo en **una sola transacción**: `activo = false`, revoca sus sesiones,
 * quema sus boletos sin canjear y escribe la bitácora. Si algo falla, nada queda.
 */
export async function desactivarUsuario(
  pool: Ejecutor,
  id: string,
  actor?: string | null,
): Promise<ResultadoDesactivacion> {
  return await enTransaccion(pool, async (cliente): Promise<ResultadoDesactivacion> => {
    // R6: la decisión es del núcleo, con el censo bloqueado de este instante.
    const censo = await censoAdminsBloqueado(cliente);
    const antes = await bloquearPersona(cliente, id);
    if (!antes) return { ok: false, motivo: 'desconocido' };

    const permiso = puedeQuitarAdmin(id, censo);
    if (!permiso.ok) return { ok: false, motivo: permiso.motivo };

    const { usuario, sesiones_revocadas, boletos_quemados } = await aplicarBaja(cliente, id, antes, actor);
    return { ok: true, usuario, sesiones_revocadas, boletos_quemados };
  });
}
