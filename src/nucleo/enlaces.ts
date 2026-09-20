/**
 * R3 y R5.3: a dónde manda el portal para entrar a cada módulo.
 *
 * Nacieron devolviendo **sólo rutas relativas**, porque el PRD §5 daba por
 * hecho un dominio único para las tres aplicaciones. No lo hay: el CRM vive en
 * Vercel y el portal no, así que un `/#nube=…` redirigía dentro del propio host
 * del portal y la entrada al CRM quedaba rota.
 *
 * Así que ahora aceptan la `url_base` del módulo (`core.modulos`, sembrada
 * desde `CQ_URL_CRM` y `CQ_URL_CDH`): **absoluta manda, relativa se comporta
 * como antes**. Sirve para las dos arquitecturas sin elegir ninguna.
 */
import type { DatosEnlaceCdh, DatosEnlaceCrm, ResultadoNormalizacion } from './tipos.ts';

/**
 * Una `url_base` es o una dirección absoluta `http(s)`, o una ruta relativa.
 * Cualquier otra cosa se rechaza, y ése es el punto: `//host` y `javascript:`
 * son redirección abierta, y aquí se decide a dónde se manda a alguien que
 * acaba de entrar.
 *
 * `//host` no sobrevive porque `new URL` sin base lo rechaza, y `javascript:`
 * porque se exige el protocolo. Devuelve la raíz **sin** barra final, para que
 * quien la use pegue su propia ruta sin producir `//`.
 */
function raizAbsoluta(urlBase: string | null | undefined): string | null {
  if (urlBase === null || urlBase === undefined || urlBase.trim() === '') return null;

  const texto = urlBase.trim();
  // Lo que parece una ruta se trata como ruta: lo valida `normalizarBasePath`.
  if (texto.startsWith('/')) {
    const base = normalizarBasePath(texto);
    if (!base.ok) throw new Error(`url_base inválida: ${JSON.stringify(urlBase)}`);
    return null;
  }

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new Error(`url_base inválida: ${JSON.stringify(urlBase)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`url_base inválida: ${JSON.stringify(urlBase)}`);
  }
  // Ni la búsqueda ni el fragmento de la base tienen sentido aquí, y el
  // fragmento chocaría con el `#nube=…` del CRM.
  if (url.search !== '' || url.hash !== '') {
    throw new Error(`url_base inválida: ${JSON.stringify(urlBase)}`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** R5.3: `<url_base>/#nube=<b64url({u,k})>&cq=<tokenHash>`. */
export function enlaceCrm(datos: DatosEnlaceCrm): string {
  // Mismo formato que b64url() del CRM: base64url sin relleno.
  const nube = Buffer.from(JSON.stringify({ u: datos.supabaseUrl, k: datos.anon }), 'utf8').toString('base64url');
  const raiz = raizAbsoluta(datos.urlBase);
  const fragmento = `#nube=${nube}&cq=${encodeURIComponent(datos.tokenHash)}`;
  // El CRM lee el fragmento en su raíz, así que la barra va siempre.
  return raiz === null ? `/${fragmento}` : `${raiz}/${fragmento}`;
}

/** R3: `<url_base | basePathCdh>/api/auth/sso?codigo=<codigo>`. */
export function enlaceCdh(datos: DatosEnlaceCdh): string {
  const cola = `/api/auth/sso?codigo=${encodeURIComponent(datos.codigo)}`;

  // Con dirección propia manda ella: `basePathCdh` describe dónde está montado
  // el CDH dentro de **su** origen, que es justo lo que la url_base ya trae.
  const raiz = raizAbsoluta(datos.urlBase);
  if (raiz !== null) return `${raiz}${cola}`;

  // Se revalida para que una base maliciosa nunca produzca `//host` (redirección abierta).
  const base = normalizarBasePath(datos.basePathCdh);
  if (!base.ok) throw new Error(`basePathCdh inválida: ${JSON.stringify(datos.basePathCdh)}`);
  return `${base.valor}${cola}`;
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
