# Fases de construcción · Core Quartz v1

Orden obligatorio. Una fase no empieza hasta que la anterior se verificó **con una corrida fresca
mostrada en el mismo mensaje**.

| # | Archivo | Qué entrega | Repo | Verificación |
|---|---|---|---|---|
| 01 | [phase-01-nucleo.md](phase-01-nucleo.md) | Reglas puras R1–R7 | shell | `npm run test:nucleo` |
| 02 | [phase-02-base-de-datos.md](phase-02-base-de-datos.md) | Esquema `core` y repositorios | shell | `npm run test:db` |
| 03 | [phase-03-blindaje-crm.md](phase-03-blindaje-crm.md) | R8: `crm_rol()` → `ninguno` | CRM (+ pruebas en shell) | `npm run test:crm-rls` |
| 04 | [phase-04-api-shell.md](phase-04-api-shell.md) | Entrada, módulos, admin, boletos, canje | shell | `npm run test:api` |
| 05 | [phase-05-cdh-sso.md](phase-05-cdh-sso.md) | Prefijo `/cdh` y `/api/auth/sso*` en el CDH | CDH | `npm test && npm run test:ui` (en CDH) |
| 06 | [phase-06-crm-sso.md](phase-06-crm-sso.md) | `#cq=` y reescrituras de Vercel en el CRM | CRM (+ pruebas en shell) | `npm run test:crm-sso` |
| 07 | [phase-07-interfaz.md](phase-07-interfaz.md) | Portal y administración, adaptable | shell | `npm run test:ui` |
| 08 | [phase-08-despliegue.md](phase-08-despliegue.md) | Docker + Caddy junto al CDH | shell | `bash deploy/verificar.sh` |
| 09 | [phase-09-e2e.md](phase-09-e2e.md) | Recorrido completo contra staging | shell | `npm run test:e2e` |

## Cómo se trabaja cada fase (equipo de agentes)

1. **Test-writer** escribe las pruebas de la fase a partir de este archivo y del PRD, y muestra la
   corrida **en rojo** (fallan por falta de implementación, no por errores de sintaxis).
2. **Implementer** escribe lo mínimo para ponerlas en verde, sin tocar archivos fuera de la lista.
3. **Reviewer** compara el diff contra el archivo de la fase y el PRD y reporta **sólo huecos de
   corrección** (no estilo).
4. Se corre la verificación de la fase desde cero y se muestra la salida.
5. Si la ejecución exige salirse del archivo de la fase (otro archivo, otra dependencia, otra regla),
   **se detiene y se pregunta**.

Repositorio del shell: **`AmezolaCD/Core-Quartz`** (público). Dominio público único:
`core-quartz.vercel.app` → `/` CRM · `/portal/` shell · `/cdh/` CDH.

Estructura del repo del shell (referencia para todas las fases):

```
core-quartz/
  package.json  tsconfig.json  .env.example
  src/nucleo/        reglas puras (sin E/S)
  src/db/            pool, migrador, migraciones SQL, repositorios
  src/servicios/     supabase-auth.ts, cdh-cliente.ts
  src/rutas/         auth, modulos, admin, sso, salud
  src/app.ts  src/index.ts  src/cli/crear-admin.ts
  public/            index.html, css/, js/  (sin compilación)
  test/              nucleo/ db/ crm-rls/ api/ crm-sso/ ui/ e2e/  apoyo/
  deploy/            Dockerfile, docker-compose.yml, Caddyfile, verificar.sh
  .mcp.json          (sólo local, en .gitignore: conector Supabase de solo lectura)
  docker-compose.test.yml   (Postgres 16 local para pruebas)
```
