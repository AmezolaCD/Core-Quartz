/** R3 y R5.3: rutas relativas (mismo dominio) hacia cada módulo. */
import type { DatosEnlaceCdh, DatosEnlaceCrm, ResultadoNormalizacion } from './tipos.ts';

/** R5.3: `/#nube=<b64url({u,k})>&cq=<tokenHash>`. */
export function enlaceCrm(datos: DatosEnlaceCrm): string {
  // Mismo formato que b64url() del CRM: base64url sin relleno.
  const nube = Buffer.from(JSON.stringify({ u: datos.supabaseUrl, k: datos.anon }), 'utf8').toString('base64url');
  return `/#nube=${nube}&cq=${encodeURIComponent(datos.tokenHash)}`;
}

/** R3: `<basePathCdh>/api/auth/sso?codigo=<codigo>`. */
export function enlaceCdh(datos: DatosEnlaceCdh): string {
  // Se revalida para que una base maliciosa nunca produzca `//host` (redirección abierta).
  const base = normalizarBasePath(datos.basePathCdh);
  if (!base.ok) throw new Error(`basePathCdh inválida: ${JSON.stringify(datos.basePathCdh)}`);
  return `${base.valor}/api/auth/sso?codigo=${encodeURIComponent(datos.codigo)}`;
}

/**
 * `''` o `'/algo'` sin barra final; `'/'` → `''`.
 * Rechaza (`formato`) lo que no empiece con `/`, `..`, `//` y espacios.
 */
export function normalizarBasePath(texto: string): ResultadoNormalizacion {
  // Sólo segmentos `/[A-Za-z0-9._~-]+`, con una barra final opcional: excluye `//`, espacios y `\`.
  if (!/^(\/[A-Za-z0-9._~-]+)*\/?$/.test(texto)) return { ok: false, motivo: 'formato' };
  const segmentos = texto.split('/').filter(Boolean);
  if (segmentos.some((s) => s === '.' || s === '..')) return { ok: false, motivo: 'formato' };
  return { ok: true, valor: segmentos.map((s) => `/${s}`).join('') };
}
