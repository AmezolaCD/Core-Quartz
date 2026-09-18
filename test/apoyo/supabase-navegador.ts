/**
 * Apoyo de las pruebas de la fase 06: el `index.html` **real** del CRM servido
 * en un puerto local, con Supabase simulado dentro del navegador.
 *
 * El CRM es un solo archivo sin herramientas (decisión #29), así que sus
 * pruebas viven aquí. Se sirve tal cual está en el clon —nada de copias
 * recortadas— y las llamadas a Supabase se interceptan con `page.route()`,
 * que es lo más cerca del navegador de verdad sin tocar la red.
 */
import { after } from 'node:test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page, type Route } from 'playwright';

/** Clon del CRM; la fase lo pide como `CRM_REPO`. */
export const CRM_REPO: string = process.env.CRM_REPO ?? '../CRM-VENTAS-';

/** Dirección y llave del Supabase inventado que ven las pruebas. */
export const NUBE = {
  url: 'https://proyecto-de-prueba.supabase.co',
  anon: 'anon-de-prueba',
} as const;

/** Las llaves de `localStorage` que usa el CRM, tal como las declara su código. */
export const CLAVES = {
  estado: 'crm-hotel-v3',
  nube: 'crm-hotel-nube',
  sesion: 'crm-hotel-sesion',
  firma: 'crm-hotel-firma',
} as const;

/** Lo que devuelve `/auth/v1/verify` cuando el enlace es bueno. */
export interface SesionFalsa {
  correo: string;
  accessToken?: string;
}

export interface LlamadaSupabase {
  metodo: string;
  url: string;
  cuerpo: unknown;
}

export interface Navegador {
  page: Page;
  /** Todo lo que la página intentó mandarle a Supabase. */
  llamadas: LlamadaSupabase[];
  /** Errores de consola y excepciones de la página. */
  errores: string[];
  /** Los `confirm`/`alert` que mostró la página, en orden. */
  dialogos: string[];
  /** Lo que queda en `localStorage` ahora mismo. */
  almacen(): Promise<Record<string, string | null>>;
  cerrar(): Promise<void>;
}

export interface OpcionesNavegador {
  /** Fragmento de la dirección, sin `#` (p. ej. `nube=…&cq=…`). */
  fragmento?: string;
  /** Lo que `localStorage` ya trae antes de cargar la página. */
  almacen?: Record<string, string>;
  /** Respuesta de `/auth/v1/verify`: sesión válida, o el error a devolver. */
  verify?: { ok: true; sesion: SesionFalsa } | { ok: false; estado: number; mensaje: string };
  /** Filas que devuelve `crm_datos` al sincronizar. */
  filas?: unknown[];
  /** Qué hacer con los `confirm`: aceptarlos (por omisión) o rechazarlos. */
  aceptarDialogos?: boolean;
}

let servidor: Server | null = null;
let raiz: string | null = null;
let navegadorCompartido: Browser | null = null;
const abiertos: Navegador[] = [];

after(async () => {
  for (const uno of abiertos.splice(0)) await uno.cerrar().catch(() => undefined);
  if (navegadorCompartido) await navegadorCompartido.close().catch(() => undefined);
  navegadorCompartido = null;
  if (servidor) await new Promise<void>((listo) => { servidor?.closeAllConnections(); servidor?.close(() => listo()); });
  servidor = null;
});

/** Sirve el `index.html` del clon del CRM, tal cual, en un puerto libre. */
async function servirCrm(): Promise<string> {
  if (raiz) return raiz;
  const html = await readFile(join(CRM_REPO, 'index.html'), 'utf8');
  servidor = createServer((peticion, respuesta) => {
    // La página es una sola; cualquier ruta devuelve el mismo archivo, como
    // haría un alojamiento estático.
    if ((peticion.url ?? '/').startsWith('/manifest')) {
      respuesta.writeHead(200, { 'content-type': 'application/manifest+json' });
      respuesta.end('{}');
      return;
    }
    respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    respuesta.end(html);
  });
  await new Promise<void>((listo) => servidor?.listen(0, '127.0.0.1', listo));
  raiz = `http://127.0.0.1:${(servidor?.address() as AddressInfo).port}`;
  return raiz;
}

async function navegadorDePruebas(): Promise<Browser> {
  navegadorCompartido ??= await chromium.launch({
    // Permite apuntar al Chromium ya presente en la imagen de desarrollo.
    executablePath: process.env.CQ_CHROMIUM_PATH || undefined,
  });
  return navegadorCompartido;
}

/** Fragmento `#nube=…` con la configuración de prueba, como lo arma el shell. */
export function fragmentoNube(): string {
  const datos = Buffer.from(JSON.stringify({ u: NUBE.url, k: NUBE.anon }), 'utf8').toString('base64url');
  return `nube=${datos}`;
}

/** Una sesión de Supabase con la forma que guarda el CRM. */
export function sesionDe(correo: string, accessToken = 'token-de-prueba'): Record<string, unknown> {
  return {
    access_token: accessToken,
    refresh_token: 'refresh-de-prueba',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: '00000000-0000-4000-8000-00000000cafe', email: correo },
  };
}

/**
 * Abre el CRM con la configuración pedida y Supabase interceptado.
 * Nada sale a la red: todo lo que apunte al proyecto falso se contesta aquí.
 */
export async function abrirCrm(opciones: OpcionesNavegador = {}): Promise<Navegador> {
  const base = await servirCrm();
  const navegador = await navegadorDePruebas();
  const contexto = await navegador.newContext();
  const page = await contexto.newPage();

  const llamadas: LlamadaSupabase[] = [];
  const errores: string[] = [];
  const dialogos: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  // Sin esto, un `confirm` deja la página colgada hasta que la prueba expire.
  page.on('dialog', (d) => {
    dialogos.push(d.message());
    void (opciones.aceptarDialogos === false ? d.dismiss() : d.accept());
  });

  // La copia local se siembra antes de que corra una sola línea de la página.
  if (opciones.almacen) {
    await page.addInitScript((datos: Record<string, string>) => {
      for (const [k, v] of Object.entries(datos)) window.localStorage.setItem(k, v);
    }, opciones.almacen);
  }

  const responder = (ruta: Route, estado: number, cuerpo: unknown) =>
    ruta.fulfill({ status: estado, contentType: 'application/json', body: JSON.stringify(cuerpo) });

  await page.route(`${NUBE.url}/**`, async (ruta) => {
    const peticion = ruta.request();
    const url = peticion.url();
    let cuerpo: unknown = null;
    try { cuerpo = peticion.postDataJSON(); } catch { /* sin cuerpo */ }
    llamadas.push({ metodo: peticion.method(), url, cuerpo });

    if (url.includes('/auth/v1/verify')) {
      const v = opciones.verify;
      if (!v) return responder(ruta, 500, { error: 'la prueba no dijo qué contestar a verify' });
      if (!v.ok) return responder(ruta, v.estado, { error: 'invalid_token', error_description: v.mensaje, msg: v.mensaje });
      return responder(ruta, 200, sesionDe(v.sesion.correo, v.sesion.accessToken));
    }
    if (url.includes('/auth/v1/token')) {
      return responder(ruta, 400, { error: 'invalid_grant', error_description: 'no se usa en estas pruebas' });
    }
    if (url.includes('/rest/v1/')) {
      // Sincronización: se devuelve lo que pida la prueba.
      return responder(ruta, 200, opciones.filas ?? []);
    }
    return responder(ruta, 200, {});
  });

  const fragmento = opciones.fragmento ? `#${opciones.fragmento}` : '';
  await page.goto(`${base}/${fragmento}`, { waitUntil: 'load' });

  const uno: Navegador = {
    page,
    llamadas,
    errores,
    dialogos,
    async almacen() {
      return await page.evaluate((claves: string[]) => {
        const salida: Record<string, string | null> = {};
        for (const clave of claves) salida[clave] = window.localStorage.getItem(clave);
        return salida;
      }, Object.values(CLAVES) as string[]);
    },
    async cerrar() {
      await contexto.close().catch(() => undefined);
    },
  };
  abiertos.push(uno);
  return uno;
}

/** Espera a que la página llame a una ruta de Supabase, o se rinde. */
export async function esperarLlamada(nav: Navegador, fragmentoUrl: string, msMax = 8_000): Promise<LlamadaSupabase> {
  const limite = Date.now() + msMax;
  while (Date.now() < limite) {
    const hallada = nav.llamadas.find((l) => l.url.includes(fragmentoUrl));
    if (hallada) return hallada;
    await nav.page.waitForTimeout(100);
  }
  throw new Error(`nunca se llamó a ${fragmentoUrl}; hubo: ${nav.llamadas.map((l) => l.url).join(', ') || 'nada'}`);
}
