# Fase 08 · Despliegue junto al CDH

## Alcance
Imagen Docker del shell (`node:22-alpine`, usuario `node`, `tini`, `HEALTHCHECK` a `/api/salud`) y un
`docker-compose.yml` que levanta **shell + CDH + Caddy** en una red interna, con **un solo sitio de
origen** `{$CQ_ORIGEN}` (dominio propio o `<ip>.sslip.io`): `/portal/*` → shell, `/cdh/*` → CDH
(`CDH_BASE_PATH=/cdh`), cualquier otra ruta → 404. El canje (`/portal/api/sso/*`) sólo se alcanza
por la red interna: Caddy responde 404 desde fuera. Migraciones al arrancar.

El público entra por `core-quartz.vercel.app`, que reenvía a ese origen (fase 06). En esta fase se
mide y documenta, contra Vercel real:
- tamaño máximo de petición que pasa la reescritura (subida de 8 fotos al tamaño límite del CDH);
- tiempo de espera de la reescritura (un reporte PDF/Excel grande del CDH);
- qué cabecera trae la IP real del cliente (para el límite de intentos).
Si algo no cabe, **se detiene y se pregunta** antes de cambiar límites.

Variables: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`CQ_SSO_SECRETO`, `CQ_BASE_PATH=/portal`, `CQ_CDH_INTERNO=http://cdh:3000/cdh`, `CQ_ORIGEN`,
`CDH_BASE_PATH=/cdh`, más las del CDH. Todas en `.env` (fuera de git).

## Archivos
- `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/verificar.sh`
- `.dockerignore`, `.env.example`
- `docs/DESPLIEGUE.md` (paso a paso en español, incluye respaldo previo del CDH y cómo revertir)
- `.github/workflows/pruebas.yml` (todas las suites + `git grep` de secretos + construir imagen)

## Criterios de aceptación
- [ ] `deploy/verificar.sh` con `CQ_ORIGEN=localhost`: levanta todo, `GET https://localhost/portal/api/salud` → `{ok:true}`, `GET https://localhost/cdh/api/health` → `{ok:true}`, `GET https://localhost/portal/api/sso/canjear` → 404, `GET https://localhost/` → 404.
- [ ] Con Vercel (preview del repo del CRM): `/portal/` y `/cdh/` cargan, y las tres mediciones quedan anotadas en `docs/DESPLIEGUE.md`.
- [ ] El contenedor del shell corre como uid 1000 y no contiene `.env`.
- [ ] Volumen del CDH intacto tras `docker compose down && up` (conteo de `movements` igual).
- [ ] CI verde en un PR de prueba.

## Verificación
```bash
bash deploy/verificar.sh
```
