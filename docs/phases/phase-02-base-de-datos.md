# Fase 02 · Base de datos (esquema `core`)

## Alcance
Migración SQL del modelo de datos del PRD §6, un migrador idempotente y repositorios delgados que
usan el núcleo. Pruebas contra **Postgres 16 local** (nunca Supabase).

- Migrador: aplica `src/db/migraciones/*.sql` en orden, registra cada una en `core.migraciones`, dentro de transacción; correrlo dos veces no cambia nada.
- Disparador que rechaza `UPDATE`/`DELETE` en `core.bitacora`.
- Índice único parcial `(modulo, lower(usuario_modulo)) WHERE usuario_modulo IS NOT NULL`.
- Semilla de `core.modulos` (`crm`, `cdh`) con `url_base` desde variables de entorno.
- `canjearBoleto(hash, modulo, ahora)` implementado como **un solo `UPDATE … RETURNING`** que marca `canjeado` y `resultado`, más la verificación de usuario/acceso activos.
- La migración **no** toca el esquema `public` ni `auth`.

## Archivos
- `docker-compose.test.yml` (servicio `pg`, Postgres 16, puerto 54329)
- `src/db/pool.ts`, `src/db/migrar.ts`, `src/db/migraciones/001_core.sql`
- `src/db/repos/usuarios.ts`, `accesos.ts`, `sesiones.ts`, `boletos.ts`, `bitacora.ts`
- `test/apoyo/pg.ts` (crea una base desechable por archivo de prueba)
- `test/db/migrar.test.ts`, `usuarios.test.ts`, `accesos.test.ts`, `boletos.test.ts`, `bitacora.test.ts`
- `package.json` (script `test:db`, dependencia `pg`)

## Criterios de aceptación
- [ ] Migrar dos veces seguidas: la segunda no aplica nada.
- [ ] `UPDATE`/`DELETE` sobre `core.bitacora` fallan.
- [ ] Insertar dos accesos `cdh` con `Carla.Ama` y `carla.ama` para personas distintas → violación única.
- [ ] **Concurrencia**: 20 canjes en paralelo del mismo código → exactamente 1 éxito y 19 `usado`.
- [ ] Canje con usuario desactivado entre emisión y canje → `inactivo`, y el boleto queda quemado.
- [ ] Sólo hashes en `sesiones.token_hash` y `boletos.codigo_hash` (la prueba busca el valor en claro en toda la tabla y no lo encuentra).
- [ ] Desactivar a una persona (repo) revoca sus sesiones y quema sus boletos pendientes en la misma transacción.
- [ ] Ningún objeto creado fuera del esquema `core` (consulta a `information_schema`).

## Verificación
```bash
docker compose -f docker-compose.test.yml up -d pg
npm run test:db
```
