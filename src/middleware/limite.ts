/**
 * Límite de intentos de entrada (fase 04): 10 por ventana de 15 minutos, por
 * IP **y** por correo. El 11.º responde 429.
 *
 * Vive en memoria del proceso a propósito: es una defensa contra fuerza bruta
 * ocasional, no un contador exacto entre instancias. La hora entra como
 * parámetro, igual que en el núcleo: nada aquí lee el reloj.
 */

/** Intentos permitidos por ventana. */
export const MAXIMO_INTENTOS = 10;

/** Ventana del límite: 15 minutos. */
export const VENTANA_MS = 900_000;

export interface Limite {
  /** Cuenta un intento con esa llave; `false` cuando ya pasó del máximo. */
  admite(clave: string, ahora: number): boolean;
  /** Olvida la llave (una entrada correcta no debe gastar el cupo del siguiente). */
  olvidar(clave: string): void;
}

export interface OpcionesLimite {
  maximo?: number;
  ventanaMs?: number;
}

export function crearLimite(opciones: OpcionesLimite = {}): Limite {
  const maximo = opciones.maximo ?? MAXIMO_INTENTOS;
  const ventanaMs = opciones.ventanaMs ?? VENTANA_MS;
  const cuentas = new Map<string, { desde: number; intentos: number }>();

  /** Tira las ventanas ya vencidas para que el mapa no crezca sin fin. */
  const limpiar = (ahora: number): void => {
    if (cuentas.size < 1000) return;
    for (const [clave, cuenta] of cuentas) {
      if (ahora - cuenta.desde >= ventanaMs) cuentas.delete(clave);
    }
  };

  return {
    admite(clave, ahora) {
      limpiar(ahora);
      const cuenta = cuentas.get(clave);
      if (!cuenta || ahora - cuenta.desde >= ventanaMs) {
        cuentas.set(clave, { desde: ahora, intentos: 1 });
        return true;
      }
      cuenta.intentos += 1;
      return cuenta.intentos <= maximo;
    },
    olvidar(clave) {
      cuentas.delete(clave);
    },
  };
}
