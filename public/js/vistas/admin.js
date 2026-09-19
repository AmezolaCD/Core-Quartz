/**
 * R6 y R7 desde la interfaz: alta, accesos, baja y bitácora.
 *
 * Los textos de error no se escriben aquí: se muestra el que manda el
 * servidor, que es el que fija el PRD.
 */

export function vistaAdmin(ctx) {
  const { el } = ctx;

  /** Personas que dejaron una revocación a medias en el CDH (R6). */
  const pendientes = new Map();

  const avisos = el('div', {});
  const panel = el('div', {});
  const raiz = el('section', {}, [el('h1', { texto: 'Administración' }), avisos, panel]);

  let datos = { usuarios: [], modulos: [] };
  let filtro = '';
  let abierta = null;
  let pestana = 'personas';
  let mostrandoAlta = false;

  function pintarAvisos() {
    avisos.replaceChildren(
      ...[...pendientes.values()].map((persona) =>
        el('div', { clase: 'pendiente', role: 'alert' }, [
          el('span', { texto: `Revocación pendiente en el CDH para ${persona.nombre}.` }),
          el('button', {
            type: 'button',
            texto: 'Reintentar',
            onclick: async (evento) => {
              const boton = evento.currentTarget;
              boton.disabled = true;
              try {
                const r = await ctx.api.reintentarRevocacion(persona.id);
                if (r.avisos.length === 0) pendientes.delete(persona.id);
              } finally {
                boton.disabled = false;
                pintarAvisos();
              }
            },
          }),
        ]),
      ),
    );
  }

  /** Apunta una baja que el CDH no alcanzó a aplicar, o la da por resuelta. */
  function anotarPendiente(persona, lista) {
    if (lista.includes('cdh')) pendientes.set(persona.id, persona);
    else pendientes.delete(persona.id);
    pintarAvisos();
  }

  async function recargar() {
    datos = await ctx.api.usuarios();
    if (abierta) abierta = datos.usuarios.find((u) => u.id === abierta.id) ?? null;
    pintar();
  }

  // ---- Alta ----

  function formularioAlta() {
    const error = el('p', { clase: 'error', role: 'alert', hidden: true });
    const correo = el('input', { id: 'alta-correo', type: 'email', required: true });
    const nombre = el('input', { id: 'alta-nombre', type: 'text', required: true });
    const clave = el('input', { id: 'alta-clave', type: 'password', autocomplete: 'new-password' });
    const admin = el('input', { id: 'alta-admin', type: 'checkbox' });

    return el('form', {
      clase: 'ficha',
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        error.hidden = true;
        try {
          await ctx.api.crearUsuario({
            correo: correo.value,
            nombre: nombre.value,
            es_admin: admin.checked,
            contrasena_temporal: clave.value,
          });
          abierta = null;
          mostrandoAlta = false;
          await recargar();
        } catch (fallo) {
          error.textContent = fallo.message;
          error.hidden = false;
        }
      },
    }, [
      el('h2', { texto: 'Persona nueva' }),
      error,
      el('div', { clase: 'campo' }, [el('label', { for: 'alta-correo', texto: 'Correo' }), correo]),
      el('div', { clase: 'campo' }, [el('label', { for: 'alta-nombre', texto: 'Nombre' }), nombre]),
      el('div', { clase: 'campo' }, [
        el('label', { for: 'alta-clave', texto: 'Contraseña temporal' }),
        clave,
        el('p', { clase: 'sub', texto: 'Sólo hace falta si todavía no tiene cuenta.' }),
      ]),
      el('label', { clase: 'casilla' }, [admin, el('span', { texto: 'Puede administrar' })]),
      el('div', { clase: 'acciones' }, [
        el('button', { type: 'submit', texto: 'Guardar' }),
        el('button', {
          type: 'button',
          clase: 'secundario',
          texto: 'Cancelar',
          onclick: () => {
            mostrandoAlta = false;
            pintar();
          },
        }),
      ]),
    ]);
  }

  // ---- Ficha de una persona ----

  function filaModulo(persona, modulo) {
    const acceso = persona.accesos.find((a) => a.modulo === modulo.codigo) ?? null;
    const activo = acceso?.activo === true;
    const error = el('p', { clase: 'error', role: 'alert', hidden: true });

    function mostrarFallo(fallo) {
      error.textContent = fallo.message;
      error.hidden = false;
    }

    const controles = [];

    if (modulo.codigo === 'cdh') {
      // R7: en el CDH la identidad es su `username`, y hay que capturarlo.
      const id = `cdh-${persona.id}`;
      const usuario = el('input', { id, type: 'text', value: acceso?.usuario_modulo ?? '' });
      controles.push(
        el('div', { clase: 'campo' }, [el('label', { for: id, texto: 'Usuario del CDH' }), usuario]),
        el('div', { clase: 'acciones' }, [
          el('button', {
            type: 'button',
            texto: 'Guardar',
            onclick: async (evento) => {
              const boton = evento.currentTarget;
              boton.disabled = true;
              error.hidden = true;
              try {
                await ctx.api.guardarAcceso(persona.id, modulo.codigo, usuario.value);
                await recargar();
              } catch (fallo) {
                mostrarFallo(fallo);
                boton.disabled = false;
              }
            },
          }),
          activo
            ? el('button', {
                type: 'button',
                clase: 'secundario',
                texto: 'Quitar acceso',
                onclick: async () => {
                  error.hidden = true;
                  try {
                    await ctx.api.quitarAcceso(persona.id, modulo.codigo);
                    await recargar();
                  } catch (fallo) {
                    mostrarFallo(fallo);
                  }
                },
              })
            : null,
        ]),
      );
    } else {
      // R7: en el CRM la identidad es el correo; no lleva usuario del módulo.
      controles.push(
        el('div', { clase: 'acciones' }, [
          el('button', {
            type: 'button',
            clase: activo ? 'secundario' : '',
            texto: activo ? 'Quitar acceso' : 'Dar acceso',
            onclick: async () => {
              error.hidden = true;
              try {
                if (activo) await ctx.api.quitarAcceso(persona.id, modulo.codigo);
                else await ctx.api.guardarAcceso(persona.id, modulo.codigo, null);
                await recargar();
              } catch (fallo) {
                mostrarFallo(fallo);
              }
            },
          }),
        ]),
      );
    }

    return el('div', { clase: 'modulo-fila' }, [
      el('h3', { texto: `${modulo.nombre} · ${activo ? 'con acceso' : 'sin acceso'}` }),
      error,
      ...controles,
    ]);
  }

  function ficha(persona) {
    const error = el('p', { clase: 'error', role: 'alert', hidden: true });
    const admin = el('input', { id: `admin-${persona.id}`, type: 'checkbox', checked: persona.es_admin });

    async function cambiar(cambios) {
      error.hidden = true;
      try {
        const r = await ctx.api.cambiarUsuario(persona.id, cambios);
        if (Array.isArray(r.avisos)) anotarPendiente(persona, r.avisos);
        await recargar();
      } catch (fallo) {
        error.textContent = fallo.message;
        error.hidden = false;
        admin.checked = persona.es_admin;
      }
    }

    return el('div', { clase: 'ficha' }, [
      el('h2', { texto: persona.nombre }),
      el('p', { clase: 'dato sub', texto: persona.correo }),
      error,
      el('label', { clase: 'casilla' }, [
        admin,
        el('span', { texto: 'Puede administrar' }),
      ]),
      el('div', { clase: 'acciones' }, [
        el('button', {
          type: 'button',
          clase: 'secundario',
          texto: 'Guardar permisos',
          onclick: () => cambiar({ es_admin: admin.checked }),
        }),
        persona.activo
          ? el('button', { type: 'button', clase: 'peligro', texto: 'Desactivar', onclick: () => cambiar({ activo: false }) })
          : el('button', { type: 'button', texto: 'Reactivar', onclick: () => cambiar({ activo: true }) }),
      ]),
      ...datos.modulos.map((modulo) => filaModulo(persona, modulo)),
    ]);
  }

  // ---- Listas ----

  function listaPersonas() {
    const buscar = el('input', {
      id: 'buscar',
      type: 'search',
      value: filtro,
      oninput: (evento) => {
        filtro = evento.currentTarget.value;
        pintar({ conservarFoco: true });
      },
    });

    const texto = filtro.trim().toLowerCase();
    const visibles = datos.usuarios.filter(
      (u) => texto === '' || u.nombre.toLowerCase().includes(texto) || u.correo.toLowerCase().includes(texto),
    );

    return el('div', {}, [
      el('div', { clase: 'campo' }, [el('label', { for: 'buscar', texto: 'Buscar' }), buscar]),
      el('div', { clase: 'acciones' }, [
        el('button', {
          type: 'button',
          texto: 'Agregar persona',
          onclick: () => {
            mostrandoAlta = true;
            abierta = null;
            pintar();
          },
        }),
      ]),
      el(
        'ul',
        { clase: 'personas' },
        visibles.map((persona) =>
          el('li', {}, [
            el('button', {
              type: 'button',
              clase: 'persona',
              // El nombre accesible lleva el correo, que es lo único que no se
              // repite: dos personas pueden llamarse igual.
              'aria-label': `${persona.nombre} (${persona.correo})${persona.activo ? '' : ' · inactiva'}`,
              onclick: () => {
                mostrandoAlta = false;
                abierta = persona;
                pintar();
              },
            }, [
              el('span', { texto: persona.nombre }),
              el('span', { clase: 'correo', texto: persona.correo }),
              persona.activo ? null : el('span', { clase: 'etiqueta baja', texto: 'Inactiva' }),
            ]),
          ]),
        ),
      ),
      mostrandoAlta ? formularioAlta() : null,
      abierta ? ficha(abierta) : null,
    ]);
  }

  function listaBitacora() {
    const cuerpo = el('tbody', {});
    const tabla = el('div', { clase: 'tabla-envoltura' }, [
      el('table', {}, [
        el('caption', { texto: 'Últimos movimientos' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', texto: 'Cuándo' }),
            el('th', { scope: 'col', texto: 'Acción' }),
            el('th', { scope: 'col', texto: 'Entidad' }),
          ]),
        ]),
        cuerpo,
      ]),
    ]);

    ctx.api
      .bitacora()
      .then(({ bitacora }) => {
        cuerpo.replaceChildren(
          ...bitacora.map((fila) =>
            el('tr', {}, [
              el('td', { texto: new Date(fila.cuando).toLocaleString('es-MX') }),
              el('td', { texto: fila.accion }),
              el('td', { texto: `${fila.entidad} ${fila.entidad_id ?? ''}`.trim() }),
            ]),
          ),
        );
      })
      .catch(() => {
        cuerpo.replaceChildren(el('tr', {}, [el('td', { colspan: 3, texto: 'No se pudo leer la bitácora.' })]));
      });

    return tabla;
  }


  function pestanas() {
    return el(
      'div',
      { clase: 'pestanas', role: 'tablist', 'aria-label': 'Secciones de administración' },
      ['personas', 'bitacora'].map((cual) =>
        el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': String(pestana === cual),
          texto: cual === 'personas' ? 'Personas' : 'Bitácora',
          onclick: () => {
            pestana = cual;
            pintar();
          },
        }),
      ),
    );
  }

  function pintar(opciones = {}) {
    panel.replaceChildren(
      pestanas(),
      el('div', { role: 'tabpanel' }, [pestana === 'personas' ? listaPersonas() : listaBitacora()]),
    );
    // Escribir en el buscador repinta la lista; sin esto se perdería el cursor.
    if (opciones.conservarFoco) {
      const buscar = panel.querySelector('#buscar');
      if (buscar) {
        buscar.focus();
        buscar.setSelectionRange(buscar.value.length, buscar.value.length);
      }
    }
  }

  pintar();
  recargar().catch((fallo) => {
    panel.replaceChildren(el('p', { clase: 'error', role: 'alert', texto: fallo.message }));
  });

  return raiz;
}
