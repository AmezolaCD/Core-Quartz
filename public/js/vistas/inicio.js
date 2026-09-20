/** R1: una tarjeta grande por módulo visible, en el orden que manda el servidor. */

export function vistaInicio(ctx) {
  const { el } = ctx;
  const { usuario, modulos } = ctx.sesion();

  if (modulos.length === 0) {
    return el('section', {}, [
      el('h1', { texto: `Hola, ${usuario.nombre}` }),
      el('p', { clase: 'vacio', texto: 'Aún no tienes módulos asignados. Pídeselo a Sistemas.' }),
    ]);
  }

  return el('section', {}, [
    el('h1', { texto: `Hola, ${usuario.nombre}` }),
    el('p', { clase: 'sub', texto: modulos.length === 1 ? 'Tu módulo:' : 'Tus módulos:' }),
    el(
      'ul',
      { clase: 'modulos' },
      modulos.map((modulo) =>
        el('li', {}, [
          // Un enlace de verdad: se abre en otra pestaña, se copia, funciona
          // sin JS. El servidor responde 302 hacia el módulo.
          el('a', { clase: 'modulo', href: ctx.haciaModulo(modulo.codigo), texto: modulo.nombre }),
        ]),
      ),
    ),
  ]);
}
