# Cómo preparar staging para la prueba e2e

La fase 09 corre los seis recorridos contra un entorno **de mentira pero completo**: un Supabase
propio, el portal y el CDH levantados, y el CRM apuntando a ese Supabase.

**Nunca contra producción.** Hay un guardia que lo impide, y está probado; más abajo se explica qué
bloquea y por qué se niega a correr si no está configurado.

## Lo primero: sin staging también corre

`npm run test:e2e` **no espera a nadie**. Si no hay `.env.e2e`, se monta el *ensayo*: la aplicación
de verdad, el `index.html` real del CRM servido aparte, y el CDH y Supabase simulados —servidores
HTTP de verdad, no módulos sustituidos—. Es lo que el CI mide en cada PR.

Lo que el ensayo no puede fingir **no se finge**: ese recorrido se salta diciendo qué pieza le
falta. Un verde que salió de medir un simulador diría que el login único funciona cuando nadie lo
ha visto funcionar.

| Recorrido | Sin staging | Por qué |
|---|---|---|
| 1a · Ana entra al portal y de ahí al CRM, con sesión | **corre** | Es la costura entre el portal y el CRM, y las dos mitades son reales |
| 1b · …y de ahí al CDH, que guarda su comentario | se salta | Hace falta la interfaz del CDH |
| 2 · Beto sólo ve el CRM; forzar el CDH da 403 | **corre** | |
| 3 · Carla consulta `crm_datos` y ve 0 filas (R8) | se salta | Las reglas de fila piden Supabase de verdad. R8 ya está medido contra Postgres en `test/crm-rls/roles.test.ts` |
| 4 · Ana da de baja a Carla y se le corta todo | **corre** | |
| 5a · el mismo código no se canjea dos veces | **corre** | En staging se salta, y es buena señal: detrás de Caddy `/portal/api/sso/*` no se alcanza desde fuera |
| 5b · …y el CDH lo explica en español | se salta | Hace falta su página de error |
| 6 · los recorridos 1 y 2 a 360 × 740 | **corre** | |

Para correr el ensayo hace falta un Postgres (`DATABASE_URL_TEST`, el `docker-compose.test.yml`
sirve), el clon del CRM (`CRM_REPO`) y Chromium (`CQ_CHROMIUM_PATH` si Playwright no trae el suyo).

## Qué forma tiene staging

La misma que producción, que desde la decisión **#39** son **dos orígenes**:

| Pieza | Dónde |
|---|---|
| Portal y CDH | Una máquina con el `docker compose` de la fase 08, bajo su propio `CQ_ORIGEN` |
| CRM | Su propio origen — una preview de Vercel sirve— **sin reescrituras** |
| Supabase | Un proyecto **aparte** del de producción, con `nube.sql`, `roles.sql` y `firmas.sql` |

No se montan reescrituras de Vercel a propósito: producción no las usa, y probar una arquitectura
que no vamos a usar no prueba nada.

## Los pasos

### 1. El proyecto de Supabase

Uno nuevo, gratuito, **distinto del de producción**. En su SQL Editor, en este orden:

```
nube.sql  →  firmas.sql  →  roles.sql
```

Los tres del repositorio del CRM. Es el mismo orden del documento de puesta en marcha.

### 2. La lista de usuarios del CRM — no te saltes esto

> Con la lista de usuarios **vacía**, `crm_sin_lista()` del CRM deja a quien entre como `admin` y le
> entrega todo. En un staging recién creado eso hace que **el recorrido 3 falle** — y falla de la
> peor manera, porque invita a relajar la aserción en lugar de sembrar la lista.

`preparar-staging.ts` la siembra con `sembrarListaCrmE2E`. Si escribes recorridos nuevos que midan
permisos, comprueba primero que la lista está.

### 3. El portal y el CDH

Van en **la misma máquina donde ya corre el CDH**, como en `docs/DESPLIEGUE.md`, con un `.env` de
staging:

- `DATABASE_URL` y `SUPABASE_*` del proyecto de staging.
- `CQ_URL_CRM` **absoluta**, apuntando al origen del CRM de staging. Con dominios distintos es lo
  único que hace que la entrada al CRM funcione, y el recorrido 1 lo ejercita de punta a punta.
- Un `CQ_ORIGEN` propio.

> **El historial del CDH no se toca.** Staging levanta su propio volumen; el del CDH que está
> trabajando (`cdh-data`) se queda donde está y **no** se marca `external` en el `docker-compose.yml`
> de staging. Y antes de nada, el respaldo de `docs/DESPLIEGUE.md`.

> **Si esa máquina no tiene dominio público** —el piloto con Tailscale que describe el README del
> CDH—, Caddy no puede pedir certificado a Let's Encrypt: necesita los puertos 80 y 443 abiertos
> desde Internet. Ahí el HTTPS lo pone `tailscale serve` y `deploy/` necesita una variante sin
> Caddy. Es lo primero que hay que mirar, antes de montar nada. La decisión **#39** descartó la
> tailnet para el portal justamente por esto.

### 4. El `.env.e2e`

Fuera de git. Lo que la prueba lee:

```bash
SUPABASE_URL=https://<staging>.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=postgres://…   # el Postgres de staging
CQ_ORIGEN=…                 # donde responden el portal y el CDH
CQ_URL_CRM=https://…        # el CRM de staging, absoluta
CQ_E2E_CONTRASENA=…         # la que se les pone a ana/beto/carla @e2e.example
CQ_SSO_SECRETO=…            # el mismo del despliegue (sólo lo usa el recorrido 5a)

# La dirección del proyecto de PRODUCCIÓN, para reconocerlo y negarse.
CQ_SUPABASE_PRODUCCION=https://<produccion>.supabase.co
```

### 5. Correr

```bash
bash deploy/verificar.sh     # levanta y comprueba el entorno
npm run test:e2e             # con .env.e2e cargado
```

## El guardia contra producción

Estas pruebas **crean y borran usuarios**. Equivocarse de proyecto sería tocar la cartera de un hotel
que está trabajando, así que el guardia se niega en más casos de los que parecen necesarios:

| Situación | Qué hace |
|---|---|
| `SUPABASE_URL` es el mismo proyecto que `CQ_SUPABASE_PRODUCCION` | **No corre** |
| …disfrazado con barra final, MAYÚSCULAS, una ruta o espacios | **No corre** — se compara el *host*, no el texto |
| Falta `SUPABASE_URL` o `DATABASE_URL` | No corre |
| **Falta `CQ_SUPABASE_PRODUCCION`** | **No corre** |
| Alguna de las dos direcciones no se entiende | **No corre** — ante la duda, no se corre |

La cuarta fila es la que importa y la menos obvia: **si no está configurada, no corre.** Un guardia
que se apaga cuando nadie lo configuró no es un guardia, y la máquina donde nadie lo configuró es
justo donde hace falta. Como los dos repositorios son **públicos**, la dirección de producción no
puede vivir en el código (invariante §5): tiene que venir del entorno, y por eso su ausencia tiene
que impedir la corrida en lugar de permitirla.

Las seis filas están probadas en `test/e2e/recorrido.test.ts`, y esas pruebas **corren sin staging**:
no necesitan red ni entorno, así que el CI las cubre en cada PR.

## Qué se crea y qué se borra

`sembrarGenteE2E` da de alta a **Ana** (administradora, CRM + CDH), **Beto** (sólo CRM) y **Carla**
(sólo CDH): su cuenta de Supabase, su fila en `core.usuarios`, sus accesos y —para quien entra al
CRM— su renglón en la lista de usuarios. Que Carla **no** esté en esa lista es parte de lo que mide
el recorrido 3, no un olvido.

Los `usuario_modulo` de Ana y Carla (`e2e.ana`, `e2e.carla`) **tienen que existir y estar activos en
el CDH de staging**, o el canje se rechaza del lado del CDH y el recorrido 1b falla donde no es.

Sólo las personas con correo `…@e2e.example`. `limpiarE2E` las borra en el orden que manda la llave
ajena —accesos, sesiones y boletos antes que la persona— y es idempotente.

**La bitácora no se toca**: es sólo de inserción por disparador (invariante 8), y el rastro de una
corrida anterior no le molesta a la siguiente.
