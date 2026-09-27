# Cómo preparar staging para la prueba e2e

La fase 09 corre los seis recorridos contra un entorno **de mentira pero completo**: un Supabase
propio, el portal y el CDH levantados, y el CRM apuntando a ese Supabase.

**Nunca contra producción.** Hay un guardia que lo impide, y está probado; más abajo se explica qué
bloquea y por qué se niega a correr si no está configurado.

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

Como en `docs/DESPLIEGUE.md`, con un `.env` de staging:

- `DATABASE_URL` y `SUPABASE_*` del proyecto de staging.
- `CQ_URL_CRM` **absoluta**, apuntando al origen del CRM de staging. Con dominios distintos es lo
  único que hace que la entrada al CRM funcione, y el recorrido 1 lo ejercita de punta a punta.
- Un `CQ_ORIGEN` propio.

### 4. El `.env.e2e`

Fuera de git. Lo que la prueba lee:

```bash
SUPABASE_URL=https://<staging>.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=postgres://…   # el Postgres de staging
CQ_ORIGEN=…                 # donde responden el portal y el CDH
CQ_URL_CRM=https://…        # el CRM de staging, absoluta

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

Sólo las personas con correo `…@e2e.example`. `limpiarE2E` las borra en el orden que manda la llave
ajena —accesos, sesiones y boletos antes que la persona— y es idempotente.

**La bitácora no se toca**: es sólo de inserción por disparador (invariante 8), y el rastro de una
corrida anterior no le molesta a la siguiente.
