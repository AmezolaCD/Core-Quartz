/**
 * Fase 09: **dónde** corren los seis recorridos.
 *
 * El mismo cuerpo de prueba tiene que servir en dos sitios muy distintos, y
 * este archivo es lo único que sabe en cuál está:
 *
 * · **`staging`** — lo de verdad. Un proyecto de Supabase aparte, el portal y
 *   el CDH levantados con el `docker compose` de la fase 08, y el CRM en su
 *   propio origen. Sale todo de `.env.e2e`, que no está en git.
 *
 * · **`ensayo`** — el arnés que ya existe: `levantarEntorno()` monta la
 *   aplicación **de verdad** con un Supabase y un CDH simulados que son
 *   servidores HTTP reales, y aquí se le suma el `index.html` **real** del CRM
 *   servido en un puerto local. Es lo que corre en el CI.
 *
 * Lo que el ensayo no puede fingir —la interfaz del CDH, las reglas de fila de
 * Supabase— no se finge: se declara faltante con `motivoSiFalta` y el recorrido
 * que lo necesita **se salta diciendo qué le falta**. Un recorrido que pasa
 * porque midió un simulador es peor que uno que no corre: el verde dice que el
 * login único funciona cuando nadie lo ha visto funcionar.
 *
 * Y por eso `anunciar()` imprime el modo en la primera línea de la corrida. Un
 * adaptador que no se anuncia deja creer que se midió lo que no se midió.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import type { Pool } from 'pg';
import { SECRETOS_DE_PRUEBA, levantarEntorno, sembrarListaCrm, type Entorno } from '../apoyo/app.ts';
import { CRM_REPO } from '../apoyo/supabase-navegador.ts';
import { leerEntornoE2E, revisarStaging } from './preparar-staging.ts';

/** Piezas que un recorrido puede necesitar y que no están en los dos entornos. */
export type Pieza = 'cdh-real' | 'crm-real' | 'supabase-real' | 'sso-alcanzable';

const PORQUE: Record<Pieza, string> = {
  'cdh-real': 'el CDH de verdad (aquí sólo está el simulador de sesiones, sin interfaz)',
  'crm-real': 'el CRM en su propio origen',
  'supabase-real': 'Supabase de verdad (sus reglas de fila no se pueden simular)',
  // Y que falte en staging es la buena noticia: significa que Caddy está
  // haciendo su trabajo. La fase 08 exige que `/portal/api/sso/*` NO se
  // alcance desde fuera, y `deploy/verificar.sh` lo comprueba.
  'sso-alcanzable': 'poder llamar `/api/sso/canjear` desde fuera, que detrás de Caddy está cerrado a propósito',
};

/** Las piezas que tiene cada entorno. Lo que no esté aquí, se salta. */
const PIEZAS: Record<'ensayo' | 'staging', readonly Pieza[]> = {
  ensayo: ['crm-real', 'sso-alcanzable'],
  staging: ['cdh-real', 'crm-real', 'supabase-real'],
};

function faltantes(modo: 'ensayo' | 'staging', piezas: Pieza[]): string | null {
  const faltan = piezas.filter((p) => !PIEZAS[modo].includes(p));
  if (faltan.length === 0) return null;
  const cola = modo === 'ensayo' ? '; se mide al desplegar (docs/E2E.md)' : '';
  return `falta ${faltan.map((p) => PORQUE[p]).join(' y ')}${cola}`;
}

/** Las personas del PRD §7, con la contraseña que se usa para entrar. */
export type Persona = 'ana' | 'beto' | 'carla' | 'dani' | 'eva';
export interface Quien {
  correo: string;
  contrasena: string;
}

export const TAMANO = {
  escritorio: { width: 1280, height: 800 },
  telefono: { width: 360, height: 740 },
} as const;

/** Lo que una página nos deja ver de sí misma mientras corre el recorrido. */
export interface Vista {
  page: Page;
  /** Errores de consola y excepciones no atrapadas. */
  errores: string[];
}

export interface Recorridos {
  modo: 'ensayo' | 'staging';
  /** Raíz del portal, ya con su prefijo: `…/portal`. */
  portal: string;
  /** Raíz del CRM, o `null` si este entorno no tiene uno. */
  crm: string | null;
  /** Raíz del CDH, o `null`. */
  cdh: string | null;
  /** Postgres del entorno, para mirar lo que quedó escrito. */
  pool: Pool | null;
  /** El arnés completo, sólo en `ensayo`. */
  arnes: Entorno | null;
  /** Secreto de la puerta interna con el CDH (R4). */
  ssoSecreto: string;
  quien: Record<Persona, Quien>;
  tiene(pieza: Pieza): boolean;
  /** Motivo para saltar el recorrido, o `null` si están todas las piezas. */
  motivoSiFalta(...piezas: Pieza[]): string | null;
  /** Pestaña limpia, sin cookies heredadas. */
  abrir(ruta?: string, tamano?: { width: number; height: number }): Promise<Vista>;
  cerrar(): Promise<void>;
}

// ---------------------------------------------------------------------------
// `.env.e2e`
// ---------------------------------------------------------------------------

/**
 * Lee `.env.e2e` si está, **sin pisar** lo que ya venga del entorno.
 *
 * Se parsea aquí en vez de con `--env-file` porque su mera presencia es lo que
 * decide el modo: sin archivo, ensayo; con archivo, staging. Un `--env-file`
 * en el script de npm fallaría la corrida en toda máquina que no lo tenga.
 */
export function leerEnvE2E(ruta = '.env.e2e'): Record<string, string> {
  if (!existsSync(ruta)) return {};
  const leido: Record<string, string> = {};
  for (const renglon of readFileSync(ruta, 'utf8').split('\n')) {
    const limpio = renglon.trim();
    if (limpio === '' || limpio.startsWith('#')) continue;
    const igual = limpio.indexOf('=');
    if (igual <= 0) continue;
    const clave = limpio.slice(0, igual).trim();
    let valor = limpio.slice(igual + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    leido[clave] = valor;
  }
  return leido;
}

// ---------------------------------------------------------------------------
// El `index.html` del CRM, servido en un puerto local (sólo en ensayo)
// ---------------------------------------------------------------------------

/**
 * Sirve el CRM tal cual está en el clon, como haría un alojamiento estático.
 *
 * No se intercepta Supabase: el enlace que trae el fragmento apunta al Supabase
 * simulado, que es un servidor HTTP de verdad en este mismo equipo. Así el
 * canje del enlace mágico lo hace el CRM **real** contra el mismo servidor que
 * lo emitió, que es justo la costura que esta fase viene a medir.
 */
async function servirCrm(): Promise<{ base: string; cerrar: () => Promise<void> }> {
  const html = await readFile(join(CRM_REPO, 'index.html'), 'utf8');
  const servidor: Server = createServer((peticion, respuesta) => {
    if ((peticion.url ?? '/').startsWith('/manifest')) {
      respuesta.writeHead(200, { 'content-type': 'application/manifest+json' });
      respuesta.end('{}');
      return;
    }
    respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    respuesta.end(html);
  });
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const puerto = (servidor.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${puerto}`,
    cerrar: () =>
      new Promise<void>((listo) => {
        servidor.closeAllConnections();
        servidor.close(() => listo());
      }),
  };
}

// ---------------------------------------------------------------------------

const CONTRASENA_ENSAYO = 'contraseña-de-prueba';

/** Las cinco personas del PRD, con el sufijo que toque según el modo. */
function gente(sufijo: string, contrasena: string): Record<Persona, Quien> {
  const una = (nombre: Persona): Quien => ({ correo: `${nombre}${sufijo}`, contrasena });
  return { ana: una('ana'), beto: una('beto'), carla: una('carla'), dani: una('dani'), eva: una('eva') };
}

/**
 * Abre el entorno que haya: `staging` si `.env.e2e` lo configura, `ensayo` si no.
 *
 * Si hay `.env.e2e` pero está mal puesto, **no se cae de vuelta al ensayo**: se
 * lanza con el motivo. Caerse de vuelta en silencio sería lo peor de los dos
 * mundos —alguien que montó staging creería estar midiéndolo—.
 */
export async function abrirRecorridos(): Promise<Recorridos> {
  const archivo = leerEnvE2E();
  const hayArchivo = Object.keys(archivo).length > 0;
  const mezcla = { ...archivo, ...process.env } as NodeJS.ProcessEnv;

  if (hayArchivo) {
    const impedimento = revisarStaging(leerEntornoE2E(mezcla));
    if (impedimento) throw new Error(`Hay .env.e2e pero no se puede correr contra él: ${impedimento.motivo}`);
    return await staging(mezcla);
  }
  return await ensayo();
}

/** Entorno real, descrito por `.env.e2e`. */
async function staging(env: NodeJS.ProcessEnv): Promise<Recorridos> {
  const origen = String(env.CQ_ORIGEN ?? '').trim();
  if (origen === '') throw new Error('Falta CQ_ORIGEN en .env.e2e: no se sabe dónde responden el portal y el CDH.');
  const crm = String(env.CQ_URL_CRM ?? '').trim();
  if (!/^https?:\/\//.test(crm)) {
    throw new Error('CQ_URL_CRM tiene que ser absoluta: con dos orígenes es lo único que hace que la entrada al CRM funcione.');
  }
  const raiz = /^https?:\/\//.test(origen) ? origen.replace(/\/+$/, '') : `https://${origen}`;

  const navegador = await chromium.launch({ executablePath: process.env.CQ_CHROMIUM_PATH || undefined });
  const contextos: Array<{ close: () => Promise<void> }> = [];

  return {
    modo: 'staging',
    portal: `${raiz}/portal`,
    crm,
    cdh: `${raiz}/cdh`,
    pool: null,
    arnes: null,
    quien: gente('@e2e.example', String(env.CQ_E2E_CONTRASENA ?? '')),
    ssoSecreto: String(env.CQ_SSO_SECRETO ?? ''),
    tiene: (pieza) => PIEZAS.staging.includes(pieza),
    motivoSiFalta: (...piezas) => faltantes('staging', piezas),
    abrir: (ruta = '/', tamano = TAMANO.escritorio) =>
      abrirPagina(navegador, contextos, `${raiz}/portal`, ruta, tamano),
    cerrar: () => cerrarTodo(navegador, contextos, null),
  };
}

/** El arnés local: aplicación real, Supabase y CDH simulados, CRM real servido aparte. */
async function ensayo(): Promise<Recorridos> {
  const e = await levantarEntorno();
  const quien = gente('@quartz.example', CONTRASENA_ENSAYO);

  for (const persona of ['ana', 'beto', 'carla', 'dani', 'eva'] as const) {
    e.supabase.agregar(quien[persona].correo, CONTRASENA_ENSAYO, ID_DE[persona]);
  }
  e.cdh.agregar('sistemas', true);
  e.cdh.agregar('carla.ama', true);
  e.cdh.agregar('dani.mtto', true);
  e.cdh.agregar('eva.rec', true);
  await sembrarListaCrm(e.pool, [quien.ana.correo, quien.beto.correo, quien.eva.correo]);

  // El CRM vive en otro origen, como en producción: se le apunta la `url_base`
  // del módulo al servidor local que acaba de levantarse. Con la `/` de la
  // semilla el 302 caería dentro del propio portal y el recorrido 1 mediría
  // una arquitectura que no existe (decisiones #39 y #40).
  const crm = await servirCrm();
  await e.pool.query(`UPDATE core.modulos SET url_base = $1 WHERE codigo = 'crm'`, [crm.base]);

  const navegador = await chromium.launch({ executablePath: process.env.CQ_CHROMIUM_PATH || undefined });
  const contextos: Array<{ close: () => Promise<void> }> = [];

  return {
    modo: 'ensayo',
    portal: e.base,
    crm: crm.base,
    cdh: null,
    pool: e.pool,
    arnes: e,
    quien,
    ssoSecreto: SECRETOS_DE_PRUEBA.sso,
    tiene: (pieza) => PIEZAS.ensayo.includes(pieza),
    motivoSiFalta: (...piezas) => faltantes('ensayo', piezas),
    abrir: (ruta = '/', tamano = TAMANO.escritorio) => abrirPagina(navegador, contextos, e.base, ruta, tamano),
    // El arnés **no** se cierra aquí: lo cierra el gancho que `test/apoyo/pg.ts`
    // registró al importarse, junto con la base desechable. Cerrarlo dos veces
    // deja al segundo esperando un servidor que ya no está.
    cerrar: () => cerrarTodo(navegador, contextos, crm.cerrar),
  };
}

/** Los ids del PRD, para que el ensayo y `test/nucleo/datos.ts` hablen de la misma gente. */
const ID_DE: Record<Persona, string> = {
  ana: '00000000-0000-4000-8000-00000000000a',
  beto: '00000000-0000-4000-8000-00000000000b',
  carla: '00000000-0000-4000-8000-00000000000c',
  dani: '00000000-0000-4000-8000-00000000000d',
  eva: '00000000-0000-4000-8000-00000000000e',
};

/** Cierre tolerante: se llama al terminar y también si algo ya se cayó antes. */
async function cerrarTodo(
  navegador: Browser,
  contextos: Array<{ close: () => Promise<void> }>,
  extra: (() => Promise<void>) | null,
): Promise<void> {
  for (const c of contextos.splice(0)) await c.close().catch(() => undefined);
  await navegador.close().catch(() => undefined);
  if (extra) await extra().catch(() => undefined);
}

async function abrirPagina(
  navegador: Browser,
  contextos: Array<{ close: () => Promise<void> }>,
  base: string,
  ruta: string,
  tamano: { width: number; height: number },
): Promise<Vista> {
  // `ignoreHTTPSErrors` es por staging con `localhost`: ahí Caddy firma con su
  // CA interna, igual que en `deploy/verificar.sh`.
  const contexto = await navegador.newContext({ viewport: tamano, ignoreHTTPSErrors: true });
  contextos.push(contexto);
  const page = await contexto.newPage();
  const errores: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });
  page.on('pageerror', (error) => errores.push(String(error)));
  await page.goto(`${base}${ruta}`, { waitUntil: 'load' });
  return { page, errores };
}

/** Lo imprime la prueba al arrancar: qué se está midiendo de verdad. */
export function anunciar(r: Recorridos): void {
  const detalle =
    r.modo === 'staging'
      ? `portal ${r.portal} · CDH ${r.cdh} · CRM ${r.crm}`
      : `aplicación real + CRM real; CDH y Supabase simulados`;
  console.log(`\n  fase 09 · entorno «${r.modo}» — ${detalle}\n`);
}
