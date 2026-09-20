/**
 * Lo único que habla con el servidor.
 *
 * Todas las direcciones son **relativas a `document.baseURI`**, que es
 * `/portal/`: el portal no sabe en qué dominio ni bajo qué prefijo lo montaron,
 * y así sigue funcionando si mañana cambia (fase 08).
 */

/** Error con el texto que mandó el servidor, que es el que fija el PRD. */
export class ErrorApi extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
  }
}

function url(ruta) {
  return new URL(ruta, document.baseURI).toString();
}

async function pedir(metodo, ruta, cuerpo) {
  const respuesta = await fetch(url(ruta), {
    method: metodo,
    credentials: 'same-origin',
    headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  const texto = await respuesta.text();
  let datos = null;
  try {
    datos = texto === '' ? null : JSON.parse(texto);
  } catch {
    datos = null;
  }

  if (!respuesta.ok) {
    // Si el servidor no explicó nada, no nos inventamos un motivo.
    const mensaje = datos && typeof datos.error === 'string' ? datos.error : 'No se pudo completar la operación.';
    throw new ErrorApi(respuesta.status, mensaje);
  }
  return datos;
}

/** Dirección absoluta de una ruta del portal, para navegar de verdad. */
export function haciaModulo(codigo) {
  return url(`api/modulos/${encodeURIComponent(codigo)}/abrir`);
}

export const api = {
  yo: () => pedir('GET', 'api/auth/yo'),
  entrar: (correo, contrasena) => pedir('POST', 'api/auth/entrar', { correo, contrasena }),
  salir: () => pedir('POST', 'api/auth/salir'),

  usuarios: () => pedir('GET', 'api/admin/usuarios'),
  crearUsuario: (datos) => pedir('POST', 'api/admin/usuarios', datos),
  cambiarUsuario: (id, cambios) => pedir('PATCH', `api/admin/usuarios/${encodeURIComponent(id)}`, cambios),
  reintentarRevocacion: (id) =>
    pedir('POST', `api/admin/usuarios/${encodeURIComponent(id)}/reintentar-revocacion`),
  guardarAcceso: (id, modulo, usuarioModulo) =>
    pedir('PUT', `api/admin/usuarios/${encodeURIComponent(id)}/accesos/${encodeURIComponent(modulo)}`, {
      usuario_modulo: usuarioModulo,
    }),
  quitarAcceso: (id, modulo) =>
    pedir('DELETE', `api/admin/usuarios/${encodeURIComponent(id)}/accesos/${encodeURIComponent(modulo)}`),
  bitacora: () => pedir('GET', 'api/admin/bitacora'),
};
