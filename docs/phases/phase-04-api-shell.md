# Fase 04 · API del shell

## Alcance
Servidor Express 5 que expone el núcleo, **montado bajo `CQ_BASE_PATH` (por omisión `/portal`)**: todas las rutas de la tabla van con ese prefijo (`/portal/api/salud`…). `GET /portal` → 301 a `/portal/`. Supabase Auth y el CDH se llaman por clientes delgados
(`fetch` nativo) que en pruebas se sustituyen por **servidores simulados locales** (no por *mocks* de
módulo), para probar también los códigos HTTP.

| Método y ruta | Quién | Qué |
|---|---|---|
| `GET /api/salud` | cualquiera | `{ok:true, app:"Core Quartz"}` |
| `POST /api/auth/entrar` | cualquiera | R2 |
| `POST /api/auth/salir` | sesión | revoca la sesión |
| `GET /api/auth/yo` | sesión | usuario + `modulos` (R1) |
| `GET /api/modulos/:codigo/abrir` | sesión | R3 (CDH) o R5 (CRM) → 302 |
| `GET/POST/PATCH /api/admin/usuarios[/:id]` | admin | alta (si el correo no existe en Supabase Auth, lo crea con una contraseña temporal que captura el admin), editar nombre/es_admin, activar/desactivar (R6) |
| `PUT/PATCH /api/admin/usuarios/:id/accesos/:modulo` | admin | R7 |
| `POST /api/admin/usuarios/:id/reintentar-revocacion` | admin | reintenta R6 en CDH |
| `GET /api/admin/bitacora` | admin | últimas 200, paginada |
| `POST /api/sso/canjear` | CDH (secreto) | R4 |
| `npm run admin:crear -- --correo … --nombre …` | CLI | primer admin (el usuario debe existir ya en Supabase Auth) |

Reglas transversales: toda acción de admin escribe `core.bitacora`; errores en español con
`{error}`; límite de 10 intentos de entrada por IP cada 15 min; `X-CQ-Secreto` comparado en tiempo
constante; `/api/sso/*` responde 404 si la petición no trae el secreto configurado.

## Archivos
- `src/app.ts`, `src/index.ts`, `src/config.ts`
- `src/middleware/sesion.ts`, `src/middleware/admin.ts`, `src/middleware/limite.ts`
- `src/rutas/salud.ts`, `auth.ts`, `modulos.ts`, `admin.ts`, `sso.ts`
- `src/servicios/supabase-auth.ts` (password grant, admin: crear usuario, `generate_link`, `ban_duration`, cerrar sesiones; leer lista de usuarios del CRM con `pg`)
- `src/servicios/cdh-cliente.ts` (consultar usuario, revocar)
- `src/cli/crear-admin.ts`
- `test/apoyo/supabase-falso.ts`, `test/apoyo/cdh-falso.ts`, `test/apoyo/app.ts`
- `test/api/auth.test.ts`, `modulos.test.ts`, `admin.test.ts`, `sso.test.ts`, `seguridad.test.ts`
- `package.json` (dependencias `express`, `cookie-parser`; script `test:api`)

## Criterios de aceptación
- [ ] Cada fila de las tablas R2–R7 tiene su prueba HTTP con el código y el texto del PRD.
- [ ] Canje sin secreto: 401/404 y el boleto **no** se quema.
- [ ] Desactivación con CDH simulado caído: 200 con `avisos: ["cdh"]` y bitácora `revocacion_pendiente`; el reintento con CDH arriba la limpia.
- [ ] `GET /api/modulos/cdh/abrir` para Beto → 403 y cero filas nuevas en `core.boletos`.
- [ ] Cookie `cq_sesion` con `HttpOnly`, `SameSite=Lax` y `Path=/portal`; con `X-Forwarded-Proto: https`, también `Secure`.
- [ ] La respuesta de `/api/auth/yo` y cualquier error nunca incluyen `service_role`, `DATABASE_URL` ni el secreto (prueba que busca los valores de prueba en todas las respuestas).
- [ ] El 11.º intento de entrada desde la misma IP en 15 min → 429; también el 11.º para el mismo correo desde IPs distintas.
- [ ] `abrir cdh` → `Location: /cdh/api/auth/sso?codigo=…`; `abrir crm` → `Location: /#nube=…&cq=…`.
- [ ] Respuestas bajo `/portal` llevan `Content-Security-Policy` sin `unsafe-inline` para scripts.

## Verificación
```bash
docker compose -f docker-compose.test.yml up -d pg
npm run typecheck && npm run test:api
```

## Heredado de la fase 02 (revisión)

Puntos que la fase 02 dejó anotados y que se resuelven aquí, porque es donde se
vuelven alcanzables:

1. **`enTransaccion` con un cliente que no trae transacción abierta corre sin atomicidad**
   (`src/db/pool.ts`). Un `desactivarUsuario` fallido deja media R6 aplicada. O se abre
   `BEGIN`/`COMMIT` en esa rama, o la regla de la API es «pasa el pool, o un cliente que ya
   hayas puesto en transacción» y se hace cumplir. **Con prueba.**
2. **`lock_timeout` (y `statement_timeout`) en el pool**: el canje y la baja de la misma
   persona pueden esperarse (bloqueo de llave foránea contra `FOR UPDATE`); sin límite, esa
   espera queda colgada detrás de una petición HTTP.
3. El perdedor de una carrera entre R6 y un canje responde `usado` en vez de `inactivo`: el
   acceso se niega igual, pero el mensaje del CDH es menos exacto.
4. `revocarSesionesDe` cuenta también sesiones ya vencidas, así que el número de «sesiones
   revocadas» que ve el administrador sobra.
5. `emitirBoleto` responde `usuario_inactivo` ante un id desconocido; si los motivos se
   mapean directo a los dos textos 403 de R2, saldría el mensaje equivocado.
6. Dos comportamientos correctos pero sin prueba en la rama del *savepoint*: soltarlo al
   terminar bien, y que la sonda sólo se trague `25P01`.
