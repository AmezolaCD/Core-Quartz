# Fase 05 · Entrada única en el CDH

## Alcance
En el repo **CDHQuartz**, dos cambios:

**A. Prefijo de ruta (`CDH_BASE_PATH`)** para poder servirse en `core-quartz.vercel.app/cdh/`.
Vacío por omisión: **sin la variable, el CDH es idéntico al de hoy**.
- Servidor: toda la app (API, estáticos, fotos, *fallback* de la SPA) se monta bajo el prefijo con un
  `express.Router()`; `GET /cdh` → 301 a `/cdh/`. `/api/health` también queda en `/cdh/api/health`.
- Cookie `cdh_session` con `Path` = prefijo (o `/` sin prefijo).
- Interfaz: las 53 rutas absolutas (`/api`, `/css`, `/js`, `/assets`, fotos) pasan a relativas
  (`api/…`, `css/…`). El enrutador ya es por `#/`, así que la página siempre está en `<prefijo>/` y
  lo relativo resuelve bien. `index.html` agrega `<base href="<prefijo>/">`, que el servidor escribe
  al servirlo.

**B. Entrada única**: una ruta nueva `server/routes/sso.js` montada en `<prefijo>/api/auth/sso`.

| Ruta | Qué |
|---|---|
| `GET /api/auth/sso?codigo=…` | Canjea contra `CQ_URL_INTERNA/portal/api/sso/canjear` con `X-CQ-Secreto`; aplica R4 (lado CDH): usuario existe y activo → `createSession()` + cookie como en `routes/auth.js` → 302 a `<prefijo>/`. Si no, página HTML de error en español, **sin** sesión. Audita `sso_login` / `sso_rechazo`. |
| `GET /api/auth/sso/usuario/:username` | Con secreto: `{existe, activo}`. Sin secreto: 404. |
| `POST /api/auth/sso/revocar` | Con secreto: `revokeAllSessions(usuario, 'Desactivado en Core Quartz')`. Sin secreto: 404. |

Si `CQ_URL_INTERNA` o `CQ_SSO_SECRETO` no están definidas, las tres rutas responden 404 y el CDH se
comporta exactamente como hoy.

**Prohibido** en esta fase: tocar `lib/movements.js`, `db/schema.sql`, `db/upgrade.js`, la lógica
del login actual (sólo cambia el `path` de su cookie) o cualquier prueba existente.

## Archivos (repo CDHQuartz)
- `server/routes/sso.js` (nuevo)
- `server/index.js` (montaje bajo el prefijo; ruta SSO **antes** de `/api/auth`; `index.html` con `<base>`)
- `server/routes/auth.js` (sólo el `path` de la cookie)
- `public/index.html`, `public/js/**/*.js` (rutas absolutas → relativas; ningún otro cambio)
- `test/base-path.test.js` (nuevo) y un caso en `test/ui/interfaz.test.js` **añadido** (no se modifican los existentes) que corre el recorrido con `CDH_BASE_PATH=/cdh`
- `.env.example`, `docker-compose.yml` (dos variables nuevas, opcionales)
- `test/sso.test.js` (nuevo; levanta un shell simulado en un puerto local)
- `README.md` (sección «Entrada desde Core Quartz»)

## Criterios de aceptación
- [ ] Con `CDH_BASE_PATH=/cdh`: `/cdh/` carga sin errores de consola ni peticiones 404; `/api/health` (sin prefijo) → 404; `/cdh/api/health` → ok.
- [ ] Sin `CDH_BASE_PATH`: todas las rutas como hoy (la suite existente lo demuestra).
- [ ] `grep -rnE "['\"\`]/(api|css|js|assets)/" public` → sin resultados.
- [ ] Canje válido → cookie `cdh_session` (`Path=/cdh`) válida, 302 a `/cdh/`, y `Location` no contiene el código.
- [ ] Shell responde `410`/`403`/`409` → página de error, sin cookie, con entrada de auditoría.
- [ ] `usuario_modulo` inexistente o `active = 0` en el CDH → sin sesión.
- [ ] `must_change_password = 1` → la sesión se crea y la interfaz exige el cambio como hoy.
- [ ] Shell inalcanzable → página «No se pudo verificar la entrada; intenta de nuevo», sin sesión, en < 5 s (tiempo de espera).
- [ ] `revocar` deja 0 sesiones activas del usuario; sin secreto → 404 y nada cambia.
- [ ] Sin variables configuradas → las tres rutas 404.
- [ ] Prueba que cuenta filas de `movements` antes y después de todo el archivo de pruebas: sin cambios.
- [ ] `npm test` y `npm run test:ui` del CDH: todas las pruebas previas pasan sin modificarse.

## Verificación (en el clon de CDHQuartz)
```bash
npm ci --ignore-scripts
npm test && npm run test:ui
```
