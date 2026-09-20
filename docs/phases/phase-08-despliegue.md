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

## Decisión de arquitectura (20 sep 2026)

Juan: **máquina pública con dominio**, como describe el PRD §5, y el CDH todavía
**no está en uso real**, así que no hay que migrar a nadie. Eso zanja lo que la
sección heredada de la fase 06 dejaba abierto.

Decisión de diseño que se deriva: el origen se construye para **funcionar solo**,
con su propio dominio y su propio HTTPS. Las reescrituras de Vercel pasan a ser
un añadido opcional en vez de un requisito, y sus límites de tamaño y espera se
pueden medir después, contra un despliegue real, sin bloquear la fase.

## Criterios de aceptación

Verificados aquí:

- [x] El Caddyfile enruta como debe. Comprobado con un Caddy de verdad, no sólo
      validando la sintaxis: `/portal` y `/portal/` → shell; `/cdh` y `/cdh/` →
      CDH; `/portal/api/sso/*` → 404; `/` y cualquier otra ruta → 404.
- [x] El `docker compose config` resuelve, exige las variables que no pueden
      faltar, y el `${...}` del healthcheck sobrevive sin interpolarse.
- [x] El barrido de secretos no da falsos positivos sobre este repo **y sí
      detecta** un JWT, una cadena con contraseña y un `.env` plantados.
- [x] Migraciones al arrancar, bajo `pg_advisory_lock`. Sin el lock, dos
      migradores simultáneos fallan 5 de 5 veces.

**No verificados aquí, y hay que decirlo**: este contenedor tiene el CLI de
Docker pero **no el demonio**, así que no se pudo construir la imagen ni correr
`deploy/verificar.sh` de punta a punta. Quedan para el CI y para la máquina:

- [ ] `deploy/verificar.sh` con `CQ_ORIGEN=localhost`: levanta todo, `GET https://localhost/portal/api/salud` → `{ok:true}`, `GET https://localhost/cdh/api/health` → `{ok:true}`, `GET https://localhost/portal/api/sso/canjear` → 404, `GET https://localhost/` → 404.
- [ ] El contenedor del shell corre como uid 1000 y no contiene `.env`. *(El job `imagen` del CI lo comprueba en cuanto corra.)*
- [ ] Volumen del CDH intacto tras `docker compose down && up` (conteo de `movements` igual).
- [ ] CI verde en un PR de prueba.
- [ ] Con Vercel (preview del repo del CRM): `/portal/` y `/cdh/` cargan, y las tres mediciones quedan anotadas en `docs/DESPLIEGUE.md`. *(Ya no bloquea: el origen funciona sin Vercel. Se mide si se quiere el dominio único.)*

## Verificación
```bash
bash deploy/verificar.sh
```

## Heredado de la fase 06 (revisión del 18 sep 2026)

Al llegar al `vercel.json` salió que **el despliegue real no es el que describe el PRD §5**, y eso
cambia de qué va esta fase. Los hechos, confirmados con Juan y con el README del CDH:

- El **CDH** corre en Docker con **Tailscale**: queda accesible con HTTPS «sólo para los
  dispositivos de esa red, nunca desde internet».
- El **shell** todavía no corre en ningún lado.
- El **CRM** sí está en Vercel, en `core-quartz.vercel.app`, y ahí no cambia nada.

Lo que hay que resolver aquí, antes de escribir un solo `rewrite`:

1. **Las reescrituras de Vercel pueden no tener sentido.** Su edge no alcanza un host de una
   tailnet, así que `/cdh/*` no puede reenviarse a él. Si el shell también acaba en la red
   privada, `/portal/*` tampoco, y entonces **no hace falta tocar `vercel.json`**: el CRM se
   queda solo en Vercel y el portal y el CDH viven en la red privada. Menos piezas, no más.

2. ~~**Los dos enlaces del portal son relativos, y con dominios distintos están rotos.**~~
   **Resuelto.** `enlaceCrm` y `enlaceCdh` aceptan la `url_base` del módulo, con la regla
   *absoluta manda, relativa como antes*. Se hizo antes de decidir la arquitectura porque no
   dependía de ella: el CRM está en Vercel en todos los escenarios. Lo que sigue es el
   planteamiento original.
   `enlaceCrm` devuelve `/#nube=…&cq=…` y `enlaceCdh` devuelve `<prefijo>/api/auth/sso?codigo=…`
   (`src/nucleo/enlaces.ts`). Dan por hecho el mismo dominio. Si el portal no vive en
   `core-quartz.vercel.app`, el enlace al CRM redirige dentro del propio host del portal y **la
   entrada al CRM no funciona**. La pieza para arreglarlo ya existe y nadie la usa:
   `core.modulos.url_base`, que la migración siembra desde `CQ_URL_CRM` y `CQ_URL_CDH`. La
   propuesta es que los constructores usen esa URL cuando sea absoluta y conserven lo relativo
   cuando no, con lo que sirve para las dos arquitecturas. Cuesta tocar la prueba de la fase 01
   que hoy exige que empiecen con `/` y nunca con `http`.

3. **El PRD §5 y §10.2 quedan desactualizados.** El diseño «un solo dominio» —y con él las
   decisiones #31, #32 y #34, y la separación de cookies por `Path`— se apoya en que las tres
   aplicaciones compartan origen. Con el CDH en una tailnet eso deja de valer, y conviene
   corregir el PRD antes que el código.

4. **Qué se mide contra Vercel** (arriba, en el alcance) depende de todo lo anterior: si no hay
   reescritura, no hay límite de tamaño ni de espera que medir, y la IP del cliente la pone
   Tailscale o Caddy, no Vercel.
