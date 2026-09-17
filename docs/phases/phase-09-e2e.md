# Fase 09 · Recorrido completo (e2e)

## Alcance
Playwright contra un entorno real de **staging**: proyecto Supabase de staging (con `nube.sql`,
`roles.sql` de la fase 03 y `firmas.sql`), shell + CDH del `docker compose` de la fase 08, y el CRM
de la fase 06 desplegado como **preview de Vercel** (con las reescrituras a `/portal` y `/cdh`) apuntando a ese Supabase: así se prueba el mismo dominio compartido que usará producción. **Nunca** contra producción: la prueba
aborta si `SUPABASE_URL` coincide con `CQ_SUPABASE_PRODUCCION`.

Recorridos:
1. Ana entra en `/portal/` → abre CDH (ya con sesión, registra un comentario en una habitación) → vuelve → abre CRM (ya con sesión, ve el tablero).
2. Beto sólo ve CRM; forzar `/api/modulos/cdh/abrir` → 403.
3. Carla (sólo CDH) entra directo a Supabase con su contraseña y consulta `crm_datos` → 0 filas (R8).
4. Ana desactiva a Carla → la sesión de Carla en el CDH deja de servir en su siguiente petición; Carla no puede entrar al portal.
5. Reusar un enlace `?codigo=` ya canjeado → página de error del CDH.
6. Los recorridos 1 y 2 repetidos a 360 × 740.

## Archivos
- `test/e2e/recorrido.test.ts`, `test/e2e/preparar-staging.ts` (siembra y limpia usuarios `*@e2e.example`)
- `package.json` (script `test:e2e`)
- `docs/E2E.md` (cómo preparar staging)

## Criterios de aceptación
- [ ] Los seis recorridos pasan dos veces seguidas (la preparación es idempotente).
- [ ] El comentario del recorrido 1 aparece en el historial del CDH **a nombre del usuario ligado a Ana**.
- [ ] Al terminar no quedan usuarios `*@e2e.example` activos.
- [ ] Todas las casillas de «Criterios de aceptación» del PRD quedan marcadas con evidencia (enlace a la corrida).

## Verificación
```bash
bash deploy/verificar.sh            # levanta el entorno
npm run test:e2e                    # con .env.e2e apuntando a staging
```
