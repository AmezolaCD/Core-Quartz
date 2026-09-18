/** R6 y R7: alta, edición, baja, accesos y bitácora. Todo queda anotado. */
import { Router } from 'express';
import type { Dependencias } from '../app.ts';
import { normalizarUsuarioCdh } from '../nucleo/identidades.ts';
import type { Acceso, CodigoModulo, Usuario } from '../nucleo/tipos.ts';
import {
  desactivarAcceso,
  guardarAcceso,
  listarAccesosDe,
  listarModulos,
} from '../db/repos/accesos.ts';
import { ACCIONES, ENTIDADES, anotar, listarBitacora } from '../db/repos/bitacora.ts';
import {
  actualizarUsuario,
  crearUsuario,
  desactivarUsuario,
  listarUsuarios,
  obtenerPorId,
} from '../db/repos/usuarios.ts';
import { correoEnListaCrm } from '../servicios/supabase-auth.ts';
import { exigirAdmin } from '../middleware/admin.ts';

/** Textos exactos de R6 y R7. */
export const MENSAJES = {
  ultimoAdmin: 'Debe quedar al menos un administrador activo.',
  formatoUsuarioCdh: 'Sólo minúsculas, números, punto, guion y guion bajo.',
  noExisteEnCdh: 'No existe en el CDH o está inactivo.',
  faltaEnCrm: 'Primero dalo de alta en CRM → Ajustes → Usuarios y permisos',
  desconocido: 'No encontramos a esa persona.',
  moduloDesconocido: 'Módulo desconocido.',
  faltaContrasena: 'Falta la contraseña temporal: esa cuenta todavía no existe en Supabase.',
  datosIncompletos: 'Faltan el correo y el nombre.',
  crmSinUsuario: 'En el CRM la identidad es el correo: no lleva usuario del módulo.',
} as const;

/** R7: el duplicado nombra a quien ya tiene ligado ese usuario del CDH. */
export function mensajeDuplicado(dueno: string): string {
  return `Ese usuario del CDH ya está ligado a ${dueno}.`;
}

/** Cómo se nombra en `core.bitacora` una revocación del CDH que quedó pendiente (R6). */
export const ACCION_REVOCACION_PENDIENTE = 'revocacion_pendiente';

/** Y cómo se nombra cuando el reintento por fin la resolvió. */
export const ACCION_REVOCACION_RESUELTA = 'revocacion_resuelta';

function comoPublico(usuario: Usuario) {
  return {
    id: usuario.id,
    correo: usuario.correo,
    nombre: usuario.nombre,
    es_admin: usuario.es_admin,
    activo: usuario.activo,
  };
}

export function rutasAdmin(deps: Dependencias): Router {
  const rutas = Router();
  rutas.use(exigirAdmin());

  /** El usuario del CDH ligado a esa persona, si lo tiene (R6, R7). */
  async function usuarioCdhDe(usuarioId: string): Promise<string | null> {
    const accesos: Acceso[] = await listarAccesosDe(deps.pool, usuarioId);
    return accesos.find((a) => a.modulo === 'cdh')?.usuario_modulo ?? null;
  }

  /**
   * R6, lo que va **fuera** de la transacción: bloquear en Supabase y revocar
   * en el CDH. Si algo falla, la baja no se deshace (decisión #24): se avisa y
   * queda en la bitácora, nunca se reporta como hecho (invariante 4).
   */
  async function cortarAfuera(usuario: Usuario, actor: string): Promise<string[]> {
    const avisos: string[] = [];

    try {
      await deps.supabase.bloquear(usuario.id);
      await deps.supabase.cerrarSesiones(usuario.id);
    } catch (error) {
      avisos.push('supabase');
      await anotar(deps.pool, {
        quien: actor,
        accion: ACCION_REVOCACION_PENDIENTE,
        entidad: ENTIDADES.usuario,
        entidad_id: usuario.id,
        despues: { donde: 'supabase', error: error instanceof Error ? error.message : String(error) },
      });
    }

    const usuarioModulo = await usuarioCdhDe(usuario.id);
    if (usuarioModulo) {
      const revocacion = await deps.cdh.revocar(usuarioModulo);
      if (!revocacion.ok) {
        avisos.push('cdh');
        await anotar(deps.pool, {
          quien: actor,
          accion: ACCION_REVOCACION_PENDIENTE,
          entidad: ENTIDADES.usuario,
          entidad_id: usuario.id,
          despues: { donde: 'cdh', usuario_modulo: usuarioModulo, error: revocacion.error },
        });
      }
    }
    return avisos;
  }

  // ---- Personas ----

  rutas.get('/usuarios', async (_peticion, respuesta) => {
    const usuarios = await listarUsuarios(deps.pool);
    const conAccesos = await Promise.all(
      usuarios.map(async (u) => ({ ...comoPublico(u), accesos: await listarAccesosDe(deps.pool, u.id) })),
    );
    respuesta.json({ usuarios: conAccesos });
  });

  rutas.post('/usuarios', async (peticion, respuesta) => {
    const datos = peticion.body as {
      correo?: unknown;
      nombre?: unknown;
      es_admin?: unknown;
      contrasena_temporal?: unknown;
    };
    if (typeof datos?.correo !== 'string' || typeof datos?.nombre !== 'string') {
      respuesta.status(422).json({ error: MENSAJES.datosIncompletos });
      return;
    }
    const correo = datos.correo.trim().toLowerCase();

    // Si ya tiene cuenta de Supabase se reutiliza; si no, se crea con la
    // contraseña temporal que capturó el administrador.
    let cuenta = await deps.supabase.buscarPorCorreo(correo);
    if (!cuenta) {
      if (typeof datos.contrasena_temporal !== 'string' || datos.contrasena_temporal === '') {
        respuesta.status(422).json({ error: MENSAJES.faltaContrasena });
        return;
      }
      cuenta = await deps.supabase.crearUsuario(correo, datos.contrasena_temporal);
    }

    const usuario = await crearUsuario(
      deps.pool,
      { id: cuenta.id, correo: cuenta.correo, nombre: datos.nombre, es_admin: datos.es_admin === true },
      peticion.cq!.usuario.id,
    );
    respuesta.status(201).json({ usuario: comoPublico(usuario) });
  });

  rutas.patch('/usuarios/:id', async (peticion, respuesta) => {
    const id = String(peticion.params.id ?? '');
    const actor = peticion.cq!.usuario.id;
    const datos = peticion.body as {
      nombre?: unknown;
      correo?: unknown;
      es_admin?: unknown;
      activo?: unknown;
    };

    // R6: la baja es su propio camino, con transacción y cortes afuera.
    if (datos?.activo === false) {
      const baja = await desactivarUsuario(deps.pool, id, actor);
      if (!baja.ok) {
        if (baja.motivo === 'ultimo_admin') {
          respuesta.status(409).json({ error: MENSAJES.ultimoAdmin });
          return;
        }
        respuesta.status(404).json({ error: MENSAJES.desconocido });
        return;
      }
      const avisos = await cortarAfuera(baja.usuario, actor);
      respuesta.json({ usuario: comoPublico(baja.usuario), avisos });
      return;
    }

    const cambios: { nombre?: string; correo?: string; es_admin?: boolean; activo?: boolean } = {};
    if (typeof datos?.nombre === 'string') cambios.nombre = datos.nombre;
    if (typeof datos?.correo === 'string') cambios.correo = datos.correo.trim().toLowerCase();
    if (typeof datos?.es_admin === 'boolean') cambios.es_admin = datos.es_admin;
    if (datos?.activo === true) cambios.activo = true;

    const resultado = await actualizarUsuario(deps.pool, id, cambios, actor);
    if (resultado === null) {
      respuesta.status(404).json({ error: MENSAJES.desconocido });
      return;
    }
    if (resultado.ok === false) {
      respuesta.status(409).json({ error: MENSAJES.ultimoAdmin });
      return;
    }

    const avisos: string[] = [];
    if (cambios.activo === true) {
      // R6 al revés: se le quita el `ban_duration`. Las sesiones viejas no vuelven.
      try {
        await deps.supabase.desbloquear(resultado.id);
      } catch {
        avisos.push('supabase');
      }
    }
    respuesta.json({ usuario: comoPublico(resultado as Usuario), avisos });
  });

  rutas.post('/usuarios/:id/reintentar-revocacion', async (peticion, respuesta) => {
    const id = String(peticion.params.id ?? '');
    const actor = peticion.cq!.usuario.id;
    const usuario = await obtenerPorId(deps.pool, id);
    if (!usuario) {
      respuesta.status(404).json({ error: MENSAJES.desconocido });
      return;
    }

    const avisos: string[] = [];
    const usuarioModulo = await usuarioCdhDe(id);
    if (usuarioModulo) {
      const revocacion = await deps.cdh.revocar(usuarioModulo);
      await anotar(deps.pool, {
        quien: actor,
        accion: revocacion.ok ? ACCION_REVOCACION_RESUELTA : ACCION_REVOCACION_PENDIENTE,
        entidad: ENTIDADES.usuario,
        entidad_id: id,
        despues: revocacion.ok
          ? { donde: 'cdh', usuario_modulo: usuarioModulo, revocadas: revocacion.revocadas }
          : { donde: 'cdh', usuario_modulo: usuarioModulo, error: revocacion.error },
      });
      if (!revocacion.ok) avisos.push('cdh');
    }
    respuesta.json({ usuario: comoPublico(usuario), avisos });
  });

  // ---- R7: accesos ----

  rutas.put('/usuarios/:id/accesos/:modulo', async (peticion, respuesta) => {
    const id = String(peticion.params.id ?? '');
    const codigo = String(peticion.params.modulo ?? '');
    const actor = peticion.cq!.usuario.id;

    const usuario = await obtenerPorId(deps.pool, id);
    if (!usuario) {
      respuesta.status(404).json({ error: MENSAJES.desconocido });
      return;
    }
    const catalogo = await listarModulos(deps.pool);
    const modulo = catalogo.find((m) => m.codigo === codigo) ?? null;
    if (!modulo) {
      respuesta.status(404).json({ error: MENSAJES.moduloDesconocido });
      return;
    }

    const datos = peticion.body as { usuario_modulo?: unknown };
    const capturado = typeof datos?.usuario_modulo === 'string' ? datos.usuario_modulo : null;

    if (modulo.codigo === 'crm') {
      // R7: en el CRM la identidad es el correo.
      if (capturado !== null && capturado !== '') {
        respuesta.status(422).json({ error: MENSAJES.crmSinUsuario });
        return;
      }
      // R5.2 se valida también al asignar.
      if (!(await correoEnListaCrm(deps.pool, usuario.correo))) {
        respuesta.status(409).json({ error: MENSAJES.faltaEnCrm });
        return;
      }
    } else {
      // R7: formato primero —no vale molestar al CDH con basura— y luego
      // que exista **y esté activo** allá.
      const normal = normalizarUsuarioCdh(capturado ?? '');
      if (!normal.ok) {
        respuesta.status(422).json({ error: MENSAJES.formatoUsuarioCdh });
        return;
      }
      const enCdh = await deps.cdh.usuario(normal.valor);
      if (!enCdh || !enCdh.activo) {
        respuesta.status(422).json({ error: MENSAJES.noExisteEnCdh });
        return;
      }
    }

    const guardado = await guardarAcceso(
      deps.pool,
      { usuario_id: id, modulo: modulo.codigo as CodigoModulo, usuario_modulo: capturado },
      actor,
    );
    if (guardado.ok) {
      respuesta.json({ acceso: guardado.acceso });
      return;
    }
    if (guardado.motivo === 'duplicado') {
      respuesta.status(409).json({ error: mensajeDuplicado(guardado.dueno) });
      return;
    }
    if (guardado.motivo === 'formato') {
      respuesta.status(422).json({ error: MENSAJES.formatoUsuarioCdh });
      return;
    }
    if (guardado.motivo === 'crm_con_usuario') {
      respuesta.status(422).json({ error: MENSAJES.crmSinUsuario });
      return;
    }
    respuesta.status(404).json({
      error: guardado.motivo === 'modulo_desconocido' ? MENSAJES.moduloDesconocido : MENSAJES.desconocido,
    });
  });

  rutas.delete('/usuarios/:id/accesos/:modulo', async (peticion, respuesta) => {
    const id = String(peticion.params.id ?? '');
    const codigo = String(peticion.params.modulo ?? '');
    const catalogo = await listarModulos(deps.pool);
    if (!catalogo.some((m) => m.codigo === codigo)) {
      respuesta.status(404).json({ error: MENSAJES.moduloDesconocido });
      return;
    }
    // R7: apagar el acceso **no** bloquea su cuenta de Supabase; sólo R6 lo hace.
    const acceso = await desactivarAcceso(deps.pool, id, codigo as CodigoModulo, peticion.cq!.usuario.id);
    if (!acceso) {
      respuesta.status(404).json({ error: MENSAJES.desconocido });
      return;
    }
    respuesta.json({ acceso });
  });

  // ---- Bitácora ----

  rutas.get('/bitacora', async (peticion, respuesta) => {
    const pedido = Number(peticion.query.limite ?? 200);
    const limite = Number.isFinite(pedido) ? Math.min(Math.max(1, Math.trunc(pedido)), 200) : 200;
    respuesta.json({ bitacora: await listarBitacora(deps.pool, { limite }) });
  });

  return rutas;
}

export { ACCIONES };
