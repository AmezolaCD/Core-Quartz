/**
 * `npm run admin:crear -- --correo … --nombre …`
 *
 * Crea la primera administradora del portal. La cuenta debe existir ya en
 * Supabase Auth: este comando no inventa contraseñas.
 */

export interface ArgumentosCrearAdmin {
  correo: string;
  nombre: string;
}

/** Lee `--correo` y `--nombre` de `argv`; lanza si falta alguno. */
export function leerArgumentos(_argv: string[]): ArgumentosCrearAdmin {
  throw new Error('no implementado: leerArgumentos');
}

export async function crearAdmin(_argv: string[]): Promise<void> {
  throw new Error('no implementado: crearAdmin');
}
