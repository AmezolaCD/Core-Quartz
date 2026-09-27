# Fase 09 · Recorrido completo (e2e)

## Alcance

> **Corregido el 27 sep 2026, al empezar la fase.** Este alcance daba por hecho el **dominio único**
> con reescrituras de Vercel, y la decisión **#39** lo dejó atrás: producción son **dos orígenes**.
> Montar staging con reescrituras probaría una arquitectura que no vamos a usar. Lo que sigue es el
> alcance corregido; el original está al final, en «Lo que decía antes».

Playwright contra un entorno real de **staging**, con la misma forma que producción:

- **Proyecto Supabase de staging**, con `nube.sql`, `roles.sql` y `firmas.sql` corridos.
- **Shell + CDH** del `docker compose` de la fase 08, bajo un `CQ_ORIGEN` propio.
- **El CRM** apuntando a ese mismo Supabase, en su propio origen (una preview de Vercel sirve, **sin
  reescrituras**: son dos orígenes, como en producción).
- `CQ_URL_CRM` **absoluta**, apuntando a esa preview. Es lo que hace que la entrada al CRM funcione
  con dominios distintos, y el recorrido 1 la ejercita de punta a punta.

**Nunca contra producción.** La prueba aborta si `SUPABASE_URL` coincide con
`CQ_SUPABASE_PRODUCCION`. Y como los dos repositorios son **públicos**, la dirección del proyecto de
producción no puede vivir en el código (invariante §5): sale del entorno. De ahí una regla que no es
obvia y que la fase implementa: **si `CQ_SUPABASE_PRODUCCION` no está puesta, la prueba no corre.**
Un guardia que se desactiva cuando no está configurado no es un guardia.

## Antes de escribir un solo recorrido: la lista de usuarios de staging

El recorrido 3 dice que Carla consulta `crm_datos` y ve **0 filas**. Eso **sólo es cierto si la lista
de usuarios del CRM está sembrada en staging**.

El CRM añadió `crm_sin_lista()` en sep 2026: con la lista de usuarios **vacía**, quien entra cuenta
como `admin` y ve todo. Está medido en `test/crm-rls/roles.test.ts`. Así que en un staging recién
creado, sin esa lista, el recorrido 3 **falla** — y falla de la peor manera, porque invita a relajar
la aserción en lugar de sembrar la lista.

`preparar-staging.ts` tiene que sembrar la lista de usuarios, y el recorrido 3 tiene que **comprobar
esa precondición antes de medir R8**, para que un fallo diga «falta la lista» y no «R8 está roto».

Recorridos:
1. Ana entra en `/portal/` → abre CDH (ya con sesión, registra un comentario en una habitación) → vuelve → abre CRM (ya con sesión, ve el tablero).
2. Beto sólo ve CRM; forzar `/api/modulos/cdh/abrir` → 403.
3. Carla (sólo CDH) entra directo a Supabase con su contraseña y consulta `crm_datos` → 0 filas (R8),
   **después** de comprobar que la lista de usuarios está sembrada (ver arriba).
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

## Lo que decía antes

El alcance original, para que se vea qué cambió:

> Playwright contra un entorno real de **staging**: proyecto Supabase de staging (con `nube.sql`,
> `roles.sql` de la fase 03 y `firmas.sql`), shell + CDH del `docker compose` de la fase 08, y el CRM
> de la fase 06 desplegado como **preview de Vercel** (con las reescrituras a `/portal` y `/cdh`)
> apuntando a ese Supabase: así se prueba el mismo dominio compartido que usará producción.

Cayó la parte del dominio compartido y de las reescrituras. Todo lo demás sigue igual.
