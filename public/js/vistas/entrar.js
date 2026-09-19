/** R2: correo, contraseña y los mensajes exactos que devuelve el servidor. */

export function vistaEntrar(ctx) {
  const { el } = ctx;

  const error = el('p', { clase: 'error', role: 'alert', hidden: true });
  const correo = el('input', {
    id: 'correo',
    name: 'correo',
    type: 'email',
    autocomplete: 'username',
    required: true,
  });
  const contrasena = el('input', {
    id: 'contrasena',
    name: 'contrasena',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
  });
  const boton = el('button', { type: 'submit', texto: 'Entrar' });

  function mostrarError(mensaje) {
    error.textContent = mensaje;
    error.hidden = false;
  }

  const formulario = el(
    'form',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        // Se envía por `fetch`: así la contraseña nunca acaba en la dirección
        // ni en el historial, pase lo que pase con el formulario.
        evento.preventDefault();
        error.hidden = true;
        boton.disabled = true;
        try {
          ctx.entro(await ctx.api.entrar(correo.value, contrasena.value));
        } catch (fallo) {
          // El texto lo fija el PRD y lo manda el servidor; no se traduce aquí.
          mostrarError(fallo instanceof ctx.ErrorApi ? fallo.message : 'No se pudo conectar. Inténtalo otra vez.');
          contrasena.value = '';
          boton.disabled = false;
        }
      },
    },
    [
      error,
      el('div', { clase: 'campo' }, [el('label', { for: 'correo', texto: 'Correo' }), correo]),
      el('div', { clase: 'campo' }, [el('label', { for: 'contrasena', texto: 'Contraseña' }), contrasena]),
      boton,
    ],
  );

  return el('section', { clase: 'tarjeta-entrar' }, [
    el('h1', { texto: 'Core Quartz' }),
    el('p', { clase: 'sub', texto: 'Entra con tu correo del hotel.' }),
    formulario,
  ]);
}
