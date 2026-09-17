# Decisiones · Core Quartz

Una línea por decisión: **lo elegido** — *lo descartado* — por qué.

| # | Fecha | Decisión | Descartado | Por qué |
|---|---|---|---|---|
| 1 | 2026-09-16 | «PMS» = sistema central del hotel (Property Management System) que reúne módulos | PMS como gestión de proyectos | Lo definió Juan |
| 2 | 2026-09-16 | Giro: hotel (Quartz Hotel & Spa) | Rentas vacacionales / largo plazo | Lo definió Juan |
| 3 | 2026-09-16 | v1 = portal + ambos módulos con entrada única | Portal con datos compartidos; sólo portal | Lo definió Juan; lo más pequeño con valor real |
| 4 | 2026-09-16 | Fuera de v1: channel managers/OTAs y apps nativas; sí web adaptable al celular | App en tiendas | Lo definió Juan |
| 5 | 2026-09-16 | Portal + módulos (envolver, no reescribir) | Reescribir el CRM (~390 KB) en TS | Ambos módulos ya operan; reescribir es el mayor riesgo |
| 6 | 2026-09-16 | Shell en Node 22 + TypeScript + Express 5 | Otro framework | Lo eligió Juan; Express 5 ya lo usa el CDH |
| 7 | 2026-09-16 | TS con *type stripping* nativo de Node + `tsc --noEmit` | Compilar a `dist/` o usar un bundler | Los dos módulos ya evitan pasos de compilación |
| 8 | 2026-09-16 | Postgres = el mismo proyecto Supabase del CRM, esquema `core` | Postgres nuevo aparte | Lo eligió Juan; conserva cuentas y datos del CRM |
| 9 | 2026-09-16 | Cuentas del portal = Supabase Auth | Tabla de usuarios propia del portal | Los de ventas ya tienen ahí correo y contraseña |
| 10 | 2026-09-16 | Todo en español (docs e interfaz) | Docs en inglés | Lo eligió Juan; igual que los dos repos |
| 11 | 2026-09-16 | El CDH se queda en SQLite en v1 | Migrarlo a Postgres | Su inmutabilidad vive en disparadores de SQLite; migrarlo no es v1 |
| 12 | 2026-09-16 | Entrada al CDH con código opaco de un uso + canje por red interna | JWT firmado que el CDH verifica solo | El uso único se decide en un solo lugar y sin tabla nueva en el CDH |
| 13 | 2026-09-16 | Un intento de canje fallido también quema el código | Quemarlo sólo al tener éxito | Más seguro; reintentar es volver a pulsar la tarjeta |
| 14 | 2026-09-16 | Caducidad del código: 60 s, límite inclusivo | 5 min | Basta para una redirección; menos ventana de abuso |
| 15 | 2026-09-16 | Entrada al CRM con enlace mágico de Supabase generado en servidor (`generate_link`, `#cq=`) | Pasar el token de refresco del portal al CRM | Supabase rota y revoca tokens reutilizados; cada app necesita su sesión propia |
| 16 | 2026-09-16 | La URL del CRM no cambia (`core-quartz.vercel.app`) | Servir el CRM desde el dominio del portal | Los enlaces de firma enviados a clientes llevan esa URL |
| 17 | 2026-09-16 | ~~Portal y CDH en subdominios distintos~~ **Reemplazada por #31** | CDH bajo una ruta `/cdh/` | — |
| 18 | 2026-09-16 | Ser admin del portal no da acceso a módulos | Admin ve todo automáticamente | Administrar gente no es operar habitaciones ni ver cartera |
| 19 | 2026-09-16 | El portal decide *si entras*; cada módulo decide *qué ves* | Centralizar los papeles del CRM y roles del CDH en v1 | Menor cambio; ambos módulos ya tienen permisos probados |
| 20 | 2026-09-16 | Identidad CDH uno a uno por `username` | Varias personas en una cuenta de departamento | La bitácora inmutable del CDH debe nombrar a la persona |
| 21 | 2026-09-16 | Para el CRM la identidad es el correo, y debe estar en su lista de usuarios | Guardar un `usuario_modulo` aparte | El CRM ya liga por correo (`crm_yo()`) |
| 22 | 2026-09-16 | `crm_rol()` → `ninguno` para correos fuera de la lista (fase 03) | Dejar `ejecutivo` por omisión | Con personal de operación en Supabase Auth, el valor actual expone registros sin dueño |
| 23 | 2026-09-16 | Desactivar = bloquear en portal + `ban_duration` en Supabase + revocar sesiones del CDH | Sólo bloquear el portal | Si no, siguen entrando directo a cada módulo |
| 24 | 2026-09-16 | Si el CDH no responde al desactivar: se guarda, se avisa y se reintenta | Revertir la desactivación | Quitar acceso nunca debe depender de que otro sistema esté arriba |
| 25 | 2026-09-16 | Siempre al menos un admin activo | Permitir quedarse sin admin | Evita quedarse fuera del sistema |
| 26 | 2026-09-16 | El login propio de CRM y CDH sigue funcionando en v1 | Apagarlo | Transición sin cortar la operación |
| 27 | 2026-09-16 | Supabase Auth por `fetch` nativo | `@supabase/supabase-js` | Cuatro llamadas; una dependencia menos |
| 28 | 2026-09-16 | Pruebas con Postgres 16 local y simuladores HTTP; e2e contra Supabase de staging | Probar contra producción | Datos confidenciales de clientes |
| 29 | 2026-09-16 | Pruebas del CRM viven en el repo del shell | Añadir `package.json` al CRM | El CRM es un archivo sin herramientas por diseño |
| 30 | 2026-09-16 | Sesión del portal: cookie `HttpOnly` + tabla `core.sesiones` (12 h) | JWT en `localStorage` | Mismo patrón probado del CDH; revocable al instante |
| 31 | 2026-09-16 | Todo bajo `core-quartz.vercel.app`: `/` CRM, `/portal` shell, `/cdh` CDH, con reescrituras de Vercel hacia la VM | Subdominios propios (dominio comprado); mover el CDH a Vercel | Lo pidió Juan: el CDH usa el dominio de ventas; `vercel.app` no permite subdominios |
| 32 | 2026-09-16 | El CRM se queda en la raíz; el portal en `/portal` | Portal en la raíz y CRM en `/crm` | Los enlaces de firma enviados apuntan a la raíz |
| 33 | 2026-09-16 | El CDH gana `CDH_BASE_PATH` (vacío = como hoy) y rutas relativas en su interfaz | Proxy que reescriba HTML/JS al vuelo | Cambio explícito y probado; su enrutador ya es por `#/` |
| 34 | 2026-09-16 | Cookies separadas por `Path` (`/portal`, `/cdh`) | Un solo `Path=/` | Mismo dominio: evita que una app reciba la sesión de otra |
| 35 | 2026-09-16 | El origen de la VM usa `sslip.io` + Let's Encrypt si no hay dominio | Origen por HTTP sin cifrar | Vercel reenviaría contraseñas en claro |
| 36 | 2026-09-16 | Repo del shell: `AmezolaCD/Core-Quartz` (público) | Repo privado | Lo creó Juan |
| 37 | 2026-09-16 | Conector Supabase (MCP) en **solo lectura** y fuera de git (`.mcp.json` en `.gitignore`) | Lectura y escritura, versionado | Es la base de producción; el repo es público y el CRM oculta a propósito la dirección del proyecto |
| 38 | 2026-09-16 | Las pruebas nunca usan el conector ni la base de producción | Probar consultas contra producción | Invariante del PRD §9 |
