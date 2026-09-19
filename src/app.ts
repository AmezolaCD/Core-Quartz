/**
 * Armado de la aplicación Express 5 del shell, montada bajo `CQ_BASE_PATH`
 * (por omisión `/portal`).
 *
 * Todo lo que toca el mundo exterior entra por `Dependencias`: el pool, la
 * configuración, los clientes de Supabase y del CDH, y el reloj. Las pruebas
 * pasan servidores HTTP locales de verdad en lugar de sustituir módulos, así
 * que también se prueban los códigos de estado.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import type { Pool } from 'pg';
import type { Config } from './config.ts';
import type { ClienteSupabase } from './servicios/supabase-auth.ts';
import type { ClienteCdh } from './servicios/cdh-cliente.ts';
import { conSesion } from './middleware/sesion.ts';
import { rutasSalud } from './rutas/salud.ts';
import { rutasAuth } from './rutas/auth.ts';
import { rutasModulos } from './rutas/modulos.ts';
import { rutasAdmin } from './rutas/admin.ts';
import { rutasSso } from './rutas/sso.ts';

/** Carpeta del portal, resuelta desde este archivo y no desde el cwd. */
const RAIZ_PUBLICA = fileURLToPath(new URL('../public/', import.meta.url));

export interface Dependencias {
  pool: Pool;
  config: Config;
  supabase: ClienteSupabase;
  cdh: ClienteCdh;
  /** Reloj inyectable: el código nunca llama a `Date.now()` directamente. */
  ahora?: () => number;
}

/**
 * PRD §5, riesgo 1: las tres aplicaciones comparten origen, así que un XSS en
 * una alcanzaría a las otras. El shell no sirve scripts en línea.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Arma la aplicación con el prefijo de `config.basePath` ya aplicado. */
export function crearApp(deps: Dependencias): Express {
  const app = express();
  const base = deps.config.basePath;

  // PRD §5, riesgo 3: la IP del cliente llega reenviada por Vercel.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  // `GET /portal` sin barra final: 301 a `/portal/`.
  //
  // El `endsWith('/')` no sobra. Express enruta laxo: `app.get('/portal')`
  // casa también `/portal/`, así que sin esta guarda la página se redirigía a
  // sí misma y el navegador cortaba con ERR_TOO_MANY_REDIRECTS. Nunca se notó
  // porque hasta la fase 07 ninguna prueba pedía la página, sólo `/portal/api/…`.
  // Es el mismo fallo que el del CDH en la fase 05.
  if (base !== '') {
    app.get(base, (peticion, respuesta, siguiente) => {
      if ((peticion.originalUrl.split('?')[0] ?? '').endsWith('/')) {
        siguiente();
        return;
      }
      respuesta.redirect(301, `${base}/`);
    });
  }

  const rutas = express.Router();
  rutas.use((_peticion, respuesta, siguiente) => {
    respuesta.setHeader('content-security-policy', CSP);
    respuesta.setHeader('x-content-type-options', 'nosniff');
    respuesta.setHeader('referrer-policy', 'same-origin');
    siguiente();
  });
  // El portal es HTML, CSS y JS sin compilación (fase 07).
  //
  // Va **antes** de la cookie y de la sesión a propósito: `conSesion` hace dos
  // consultas a la base en cuanto hay cookie, y una hoja de estilo no necesita
  // saber quién la pide. Si no, cada carga de la página costaba catorce
  // consultas de más. Sólo sirve `public/`; lo demás sigue cayendo en el 404.
  rutas.use(
    express.static(RAIZ_PUBLICA, {
      index: 'index.html',
      dotfiles: 'ignore',
      redirect: false,
    }),
  );

  rutas.use(express.json({ limit: '100kb' }));
  rutas.use(cookieParser());
  rutas.use(conSesion({ pool: deps.pool, ahora: deps.ahora ?? Date.now }));

  rutas.use('/api', rutasSalud(deps));
  rutas.use('/api/auth', rutasAuth(deps));
  rutas.use('/api/modulos', rutasModulos(deps));
  rutas.use('/api/admin', rutasAdmin(deps));
  // R4: sin secreto configurado, la puerta interna no existe.
  if (deps.config.ssoSecreto !== '') rutas.use('/api/sso', rutasSso(deps));

  rutas.use((_peticion, respuesta) => {
    respuesta.status(404).json({ error: 'No encontrado.' });
  });

  app.use(base === '' ? '/' : base, rutas);

  app.use((_peticion, respuesta) => {
    respuesta.status(404).json({ error: 'No encontrado.' });
  });

  // Invariante 5: un error inesperado no devuelve la pila ni rutas del
  // servidor, que es justo donde se asoman los secretos.
  app.use((error: unknown, _peticion: Request, respuesta: Response, siguiente: NextFunction) => {
    if (respuesta.headersSent) {
      siguiente(error);
      return;
    }
    // Un JSON mal formado es culpa de quien pide, no del servidor.
    const estado = (error as { status?: number } | null)?.status;
    if (estado === 400) {
      respuesta.status(400).json({ error: 'Petición inválida.' });
      return;
    }
    console.error('[core-quartz] error no controlado:', error);
    respuesta.status(500).json({ error: 'Error interno.' });
  });

  return app;
}
