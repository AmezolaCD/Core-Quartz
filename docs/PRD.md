# Core Quartz · PRD (v1)

> Estado: **aprobado** (16 sep 2026), con la revisión «un solo dominio» (§5).
> Fecha: 16 sep 2026 · Autor: Juan Arango (con Claude)

## 1. Problema

Quartz Hotel & Spa ya opera dos sistemas propios que funcionan bien por separado:

| | **CRM de Ventas** (`AmezolaCD/CRM-VENTAS-`) | **CDH · Control de Detalles por Habitación** (`AmezolaCD/CDHQuartz`) |
|---|---|---|
| Qué hace | Cartera, bitácora, convenios, contratos, prospección, confirmaciones | Expediente auditable por habitación, limpieza, reportes, incidencias |
| Forma | Un solo `index.html`, sin compilación | Node 22 + Express 5, SPA sin compilación |
| Datos | Supabase (Postgres) · tabla `crm_datos` en JSON, RLS | SQLite (`better-sqlite3`), historial inmutable por disparadores |
| Cuentas | Supabase Auth (correo + contraseña) · 4 papeles | Tabla `users` propia (usuario + bcrypt) · roles y permisos |
| Dónde vive | Vercel · `https://core-quartz.vercel.app` | Docker + Caddy en una VM propia |

Hoy son **dos direcciones, dos contraseñas y dos altas y bajas de personal**. Quien trabaja en los dos
tiene que recordar ambas cuentas, y dar de baja a alguien exige acordarse de hacerlo en dos lugares:
si se olvida uno, esa persona conserva acceso a datos del hotel.

**Core Quartz** es el sistema central (PMS) del hotel: un solo punto de entrada que reúne los
módulos que ya existen y a los que se sumen después.

## 2. Objetivos (v1)

1. **Una sola entrada**: correo y contraseña una vez; desde ahí se abre el CRM o el CDH sin volver a
   escribir credenciales.
2. **Un solo lugar para dar acceso y quitarlo**: el administrador decide qué módulos alcanza cada
   persona, y al **desactivar** a alguien pierde la entrada a todo.
3. **Usable desde el navegador del celular** (360 px de ancho en adelante).
4. **Sin reescribir** los módulos: cambios mínimos, acotados y con sus propias pruebas.

> **v1 en una línea:** un portal con inicio de sesión único que abre el CRM y el CDH según los
> permisos de cada persona, y que corta el acceso a ambos en un solo paso.

## 3. No-objetivos (fuera de v1)

- **Channel managers / OTAs** (Booking.com, Expedia, Airbnb…).
- **Apps nativas** en tiendas. v1 es web adaptable al celular.
- **Reescribir** el CRM o el CDH en TypeScript, o **migrar el CDH de SQLite a Postgres**.
- **Datos compartidos entre módulos** (p. ej. que una salida del PMS cree una solicitud de limpieza).
  Queda para v2; la integración `pms` del CDH ya está reservada y responde 501.
- Enlace con **Arpón Enterprise**.
- **Apagar** el inicio de sesión propio del CDH o del CRM: siguen funcionando igual que hoy.
- Cambiar los permisos **dentro** de cada módulo: el portal decide *si entras*; el módulo decide
  *qué ves* (papeles del CRM, roles del CDH).
- Recuperación de contraseña por correo, 2FA, SSO con Google/Microsoft.
- Pagos, facturación, reservaciones.

## 4. Usuarios

| Persona | Qué hace en Core Quartz |
|---|---|
| **Administrador** (Sistemas) | Da de alta personas, les asigna módulos, las desactiva. Ve la bitácora del portal. |
| **Ventas** (ejecutivos, gerencia, Banquetes) | Entra y abre el CRM. Algunos también el CDH (consulta). |
| **Operación** (Ama de Llaves, Mantenimiento, Sistemas, Recepción, Supervisión) | Entra y abre el CDH, muchas veces desde el celular. |
| **Gerencia general** | Entra a ambos. |

## 5. Arquitectura v1

Todo vive bajo **un solo dominio, el del CRM: `https://core-quartz.vercel.app`**.

| Ruta pública | Qué sirve | Dónde corre |
|---|---|---|
| `/` (y `#firmar=`, `#nube=`) | **CRM**, sin cambios de dirección | Vercel (estático) |
| `/portal/…` | **Shell** de Core Quartz | VM, reenviado por Vercel |
| `/cdh/…` | **CDH** | VM, reenviado por Vercel |

```
 navegador ──► core-quartz.vercel.app ──┬─ /            → index.html del CRM (Vercel)
 (PC o celular)        (Vercel)          ├─ /portal/*   ─┐  reescritura externa
                                         └─ /cdh/*      ─┤  (vercel.json del repo del CRM)
                                                         ▼
                      ┌──────────── VM · origen HTTPS (Caddy) ────────────┐
                      │  /portal/* → shell (Node 22 + TS + Express 5)      │
                      │                 ▲ canje de boleto: red interna     │
                      │  /cdh/*    → cdh (CDH_BASE_PATH=/cdh)              │
                      └─────────────────┼──────────────────────────────────┘
                                        │ pg (esquema `core`) + Supabase Auth (admin)
                                        ▼
                               Supabase (mismo proyecto del CRM)
```

- **Shell**: Node 22, TypeScript ejecutado con el *type stripping* nativo de Node (sin paso de
  compilación; `tsc --noEmit` sólo verifica tipos), Express 5, `pg`, montado bajo `/portal`.
  Interfaz en HTML/CSS/JS sin compilación, como los otros dos. Todo en **español**, con la identidad
  del CRM (morado `#39104e`, oro `#b2aa6d`).
- **CDH**: gana soporte de **prefijo de ruta** (`CDH_BASE_PATH`, vacío por omisión = como hoy). Su
  enrutador ya usa `#/…`, así que basta con que sus rutas a `/api`, `/css`, `/js` y fotos respeten el
  prefijo.
- **Vercel** sólo reenvía (`rewrites` hacia el origen de la VM). La VM necesita un nombre con HTTPS
  propio para ser origen: un dominio cualquiera o, sin comprar nada, `<ip-con-guiones>.sslip.io` con
  certificado de Let's Encrypt vía Caddy.
- **Cookies separadas por ruta** en el mismo dominio: `cq_sesion` con `Path=/portal`,
  `cdh_session` con `Path=/cdh`.
- **Base de datos**: el **mismo Postgres de Supabase** que usa el CRM, en un esquema propio `core`
  (no toca `public.crm_*` salvo la fase 03).
- **Cuentas**: **Supabase Auth**. Los usuarios del CRM conservan su correo y contraseña.
- **El CRM no cambia de dirección.** Sus enlaces de firma ya enviados a clientes llevan
  `core-quartz.vercel.app/` dentro.
- **El CDH conserva su base, su bitácora y su puerta única de escritura** (`recordMovement`).

**Riesgos de compartir dominio** (se verifican en la fase 08):

1. **Mismo origen para las tres aplicaciones**: comparten `localStorage` y un fallo de XSS en una
   alcanza a las otras. Mitigación: las tres escapan todo HTML dinámico (ya es la norma en CRM y CDH),
   cabecera `Content-Security-Policy` en `/portal`, y el shell no guarda nada en `localStorage`.
2. **Límites de Vercel en reescrituras externas** (tamaño de petición y tiempo de espera): las fotos
   del CDH (hasta 8 por envío) podrían superarlos. Fase 08 lo mide; si falla, el CDH reduce las fotos
   en el navegador antes de subirlas o el límite por envío baja.
3. **IP del cliente**: el límite de intentos de entrada usa la IP que Vercel reenvía; si no es
   confiable, se limita además por correo.
4. **Origen expuesto**: la VM también responde directo (sin Vercel). No abre nada nuevo —mismas
   cuentas—, pero Caddy rechaza `/portal/api/sso/*` desde fuera.

### Cómo se entra a cada módulo

| Módulo | Mecanismo | Resumen |
|---|---|---|
| **CDH** | **Boleto de un solo uso + canje por canal interno** | El shell emite un código aleatorio (60 s). El navegador va a `/cdh/api/auth/sso?codigo=…`. El CDH lo canjea contra el shell por la red interna con un secreto compartido, recibe el usuario del CDH y crea **su propia sesión** con `createSession()`. |
| **CRM** | **Enlace mágico de Supabase generado en el servidor** | El shell pide a Supabase Auth (API admin, `generate_link`, que **no envía correo**) un `token_hash` para el correo de la persona y redirige a `/#nube=…&cq=<token_hash>` (mismo dominio). El CRM lo verifica (`POST /auth/v1/verify`) y obtiene **su propia sesión**. |

Ninguno comparte tokens de refresco entre aplicaciones: cada módulo termina con su sesión propia.

## 6. Modelo de datos (esquema `core` en Postgres)

```sql
core.usuarios   (id uuid PK = auth.users.id, correo text UNIQUE (minúsculas), nombre text,
                 es_admin bool, activo bool, creado timestamptz, actualizado timestamptz)

core.modulos    (codigo text PK  -- 'crm' | 'cdh'
                 nombre text, url_base text, entrada text  -- 'enlace_supabase' | 'boleto'
                 activo bool, orden int)

core.accesos    (usuario_id uuid → usuarios, modulo text → modulos,
                 usuario_modulo text NULL,   -- CDH: su `username`; CRM: siempre NULL (se usa el correo)
                 activo bool, creado, actualizado,
                 PK (usuario_id, modulo),
                 UNIQUE (modulo, lower(usuario_modulo)) WHERE usuario_modulo IS NOT NULL)

core.sesiones   (id uuid PK, usuario_id, token_hash text UNIQUE, ip, agente,
                 creada, expira, revocada NULL)

core.boletos    (id uuid PK, codigo_hash text UNIQUE, usuario_id, modulo, usuario_modulo,
                 emitido, expira, canjeado NULL, resultado text NULL, ip)

core.bitacora   (n bigserial PK, cuando timestamptz DEFAULT now(), quien uuid NULL,
                 accion text, entidad text, entidad_id text, antes jsonb, despues jsonb)
                 -- sólo INSERT: un disparador rechaza UPDATE y DELETE
```

Reglas de forma:

- Tokens y códigos se guardan **sólo como SHA-256**; el valor en claro nunca toca la base.
- Todas las horas se sellan en el **servidor** (`now()` de Postgres); el huso del hotel es
  `America/Tijuana` y sólo importa al mostrar.
- Nada se borra: usuarios y accesos se **desactivan**.

## 7. Reglas del dominio, con ejemplos

Datos de ejemplo usados abajo (todos inventados):

| usuario | correo | activo | es_admin | acceso `crm` | acceso `cdh` (usuario_modulo) |
|---|---|---|---|---|---|
| Ana | ana@quartz.example | sí | sí | activo | activo (`sistemas`) |
| Beto | beto@quartz.example | sí | no | activo | — |
| Carla | carla@quartz.example | sí | no | — | activo (`carla.ama`) |
| Dani | dani@quartz.example | **no** | no | activo | activo (`dani.mtto`) |
| Eva | eva@quartz.example | sí | no | **inactivo** | activo (`eva.rec`) |

### R1 · Qué módulos ve una persona

Un módulo aparece y se puede abrir **sólo si** `usuario.activo` **y** `modulo.activo` **y**
`acceso.activo`; para el CDH además `usuario_modulo` no es nulo. **Ser administrador del portal no
da acceso a módulos** (administrar gente no es lo mismo que operar habitaciones).

| Persona | Resultado | Por qué |
|---|---|---|
| Ana | `[crm, cdh]` + panel de administración | activa, ambos accesos activos |
| Beto | `[crm]` | no tiene fila de `cdh` |
| Carla | `[cdh]` | no tiene fila de `crm` |
| Dani | **no entra al portal** | usuario inactivo (ver R6) |
| Eva | `[cdh]` | su acceso `crm` está inactivo |
| Ana, con `modulos.cdh.activo = false` | `[crm]` | el módulo está apagado para todos |

Orden: por `modulos.orden`, no alfabético.

### R2 · Inicio de sesión en el portal

1. El servidor valida correo y contraseña contra Supabase Auth (`grant_type=password`).
2. Además exige una fila en `core.usuarios` con `activo = true`.
3. Crea `core.sesiones` (12 h) y una cookie `cq_sesion` `HttpOnly`, `SameSite=Lax`, `Path=/portal`, `Secure` detrás de HTTPS.

| Entrada | Resultado |
|---|---|
| `ANA@Quartz.example` + contraseña correcta | Entra (correo se compara en minúsculas) |
| Beto con contraseña errónea | 401 «Correo o contraseña incorrectos» (mismo texto que si el correo no existiera) |
| Usuario válido en Supabase (un ejecutivo del CRM) pero **sin** fila en `core.usuarios` | 403 «Tu cuenta aún no tiene acceso a Core Quartz. Pídeselo a Sistemas.» |
| Dani (inactivo) | 403 «Tu cuenta está desactivada.» |

### R3 · Emisión del boleto (CDH)

Se emite sólo si R1 permite el módulo **en ese instante**. Código: 32 bytes aleatorios en base64url;
se guarda su hash; `expira = emitido + 60 s`. Emitir no invalida boletos anteriores (dos pestañas son
válidas), pero cada uno se usa una vez.

| Caso | Resultado |
|---|---|
| Carla pide `cdh` | 302 → `/cdh/api/auth/sso?codigo=<43 caracteres>` |
| Beto pide `cdh` | 403 «No tienes acceso a este módulo.» — **no** se crea boleto |
| Carla pide `xyz` | 404 «Módulo desconocido.» |

### R4 · Canje del boleto (lo hace el CDH, contra el shell)

`POST /portal/api/sso/canjear` en el shell, sólo por red interna, con cabecera `X-CQ-Secreto`.
Es **válido** si, todo a la vez: el código existe, `canjeado IS NULL`, `now() <= expira`,
el módulo del boleto es el del que canjea, y **al momento del canje** el usuario y su acceso siguen
activos. Se decide con **un solo `UPDATE … WHERE canjeado IS NULL … RETURNING`**, así dos canjes
simultáneos no pueden ganar ambos. **Cualquier intento lo quema**, salga bien o mal
(`resultado` guarda el motivo).

Boleto de Carla emitido a las `10:00:00.000`, `expira = 10:01:00.000`:

| Canje | Respuesta al CDH | Por qué |
|---|---|---|
| `10:00:05`, módulo `cdh` | `200 {usuario_modulo: "carla.ama", nombre: "Carla"}` | todo válido |
| el mismo código otra vez a `10:00:06` | `410 usado` | un solo uso |
| `10:01:00.000` exactos | `200` | el límite es inclusivo (`<=`) |
| `10:01:00.001` | `410 vencido` | pasó el límite |
| el código presentado por el módulo `crm` | `409 modulo` — y el boleto queda quemado | no es suyo |
| Sistemas desactiva a Carla a las `10:00:03`; canje a `10:00:05` | `403 inactivo` | se revisa al canjear, no sólo al emitir |
| sin cabecera `X-CQ-Secreto` o incorrecta | `401`, **no** consulta ni quema nada | no es el CDH |
| código inventado | `410 desconocido` | no existe |

El CDH, al recibir `200`: busca `users.username = usuario_modulo` (sin distinguir mayúsculas).
Si no existe o `active = 0` → página de error «Tu usuario del CDH no existe o está inactivo; avisa a
Sistemas» y **no** crea sesión. Si existe → `createSession()`, cookie `cdh_session` (`Path=/cdh`), redirige a `/cdh/`
**sin** el código en la URL. Si el usuario debe cambiar contraseña (`must_change_password`), se
respeta el flujo actual del CDH.

### R5 · Entrada al CRM

1. R1 debe permitir `crm`.
2. El correo de la persona **debe existir en la lista de usuarios del CRM**
   (`public.crm_datos` con `tipo = 'usuarios'`, `borrado = false`, `datos->>'correo'` igual sin
   mayúsculas). Si no, 409 «Primero dalo de alta en CRM → Ajustes → Usuarios y permisos».
   Esta misma regla se valida **al asignar** el acceso (R7).
3. El shell pide `generate_link(type: magiclink, email)` y redirige a
   `/#nube=<b64url({u,k})>&cq=<hashed_token>` (la raíz del mismo dominio, donde vive el CRM).
   Se registra en `core.boletos` (con `modulo = 'crm'`) sólo como constancia; el uso único y la
   caducidad los impone Supabase.
4. El CRM, **antes que nada**, lee `cq` y `nube` y limpia la barra de direcciones (ya lo hace con
   `nube`), aplica la configuración y llama a `POST /auth/v1/verify {type:"magiclink", token_hash}`.

| Caso | Resultado |
|---|---|
| Beto (en la lista del CRM) | Abre el CRM ya con su sesión |
| Ana es admin del portal pero su correo no está en la lista del CRM | 409 del paso 2 |
| El enlace se abre dos veces | la segunda, el CRM muestra su pantalla de entrada normal con «El enlace ya se usó; entra desde Core Quartz otra vez» |
| En ese navegador el CRM ya tenía abierta la sesión de **Beto** y llega el enlace de **Ana** | el CRM **sube lo pendiente de Beto, borra la copia local** (mismo camino que *Cerrar sesión*) y sólo entonces abre la de Ana. Si no logra subir lo pendiente, pregunta, igual que hoy. |
| Llega `cq` sin `nube` y ese navegador no tiene nube configurada | pantalla de entrada con «Abre el CRM desde Core Quartz» |

### R6 · Desactivar a una persona

En una transacción del shell: `usuarios.activo = false`, se revocan sus `core.sesiones`, se queman sus
boletos sin canjear y se escribe la bitácora. Después, fuera de la transacción:

- **Supabase Auth**: se le pone `ban_duration` (queda sin poder entrar **también directo** al CRM) y
  se cierran sus sesiones.
- **CDH**: `POST <cdh-interno>/cdh/api/auth/sso/revocar {usuario_modulo}` con el secreto → `revokeAllSessions()`.

| Caso | Resultado |
|---|---|
| Ana desactiva a Beto | Beto sale del portal en su siguiente petición; no puede entrar al CRM ni directo |
| Ana desactiva a Carla y el CDH no responde | La desactivación **se guarda igual**; la pantalla avisa «El CDH no respondió: sus sesiones abiertas ahí pueden durar hasta 12 h. Reintentar.» y la bitácora lo registra como pendiente |
| Ana reactiva a Beto | `activo = true` y se quita el `ban_duration`. **No** reactiva sesiones viejas: tiene que entrar de nuevo |
| Ana intenta desactivarse a sí misma siendo la **única** admin activa | 409 «Debe quedar al menos un administrador activo.» |
| Ana quita `es_admin` al único otro admin mientras ella está inactiva | imposible: ella no puede estar en sesión (R2) |

### R7 · Asignar accesos (identidad por módulo)

- **Uno a uno por módulo**: un `username` del CDH sólo puede estar ligado a **una** persona del portal
  (sin distinguir mayúsculas), para que la bitácora inmutable del CDH siga diciendo quién hizo qué.
- CDH: `usuario_modulo` obligatorio, 3–40 caracteres `[a-z0-9._-]`, y debe existir **activo** en el
  CDH (el shell lo consulta con `GET <cdh-interno>/cdh/api/auth/sso/usuario/:username` y el secreto).
- CRM: `usuario_modulo` siempre nulo; se valida R5.2.

| Caso | Resultado |
|---|---|
| Asignar `cdh` a Carla con `Carla.Ama` | Se guarda como `carla.ama` |
| Asignar `cdh` a Eva con `carla.ama` | 409 «Ese usuario del CDH ya está ligado a Carla.» |
| Asignar `cdh` con `amadellaves` (cuenta del departamento) a Carla y luego a Eva | la segunda falla: la cuenta compartida sólo puede ligarse a una persona. Se recomienda crear usuarios individuales en el CDH |
| Asignar `cdh` con `juan perez` | 422 «Sólo minúsculas, números, punto, guion y guion bajo.» |
| Asignar `cdh` con `fantasma` (no existe en el CDH) | 422 «No existe en el CDH o está inactivo.» |
| Desactivar el acceso `crm` de Eva | Eva deja de ver el CRM en el portal; **su cuenta de Supabase no se bloquea** (sólo R6 bloquea) |

### R8 · Blindaje del CRM ante cuentas que no son de ventas

Hoy, en `roles.sql`, `crm_rol()` devuelve **`ejecutivo` por omisión** a cualquier cuenta de Supabase
que no esté en la lista del CRM; con eso vería todos los registros **sin dueño**, y si `roles.sql` no
está aplicado, **toda la cartera**. Como v1 dará de alta en Supabase Auth a personal de operación, la
fase 03 cambia la omisión a **`ninguno`**, que no lee ni escribe nada.

| Cuenta autenticada | Antes | Después |
|---|---|---|
| Correo en la lista con rol `ejecutivo`, nombre «Beto» | ve lo suyo + sin dueño | igual |
| Correo en la lista con rol `admin` | todo | igual |
| Correo en la lista con rol `captura` | sus prospectos + ajustes/usuarios | igual |
| **Carla** (sólo CDH, no está en la lista) | **sin dueño + catálogo + usuarios** | **nada** (0 filas; insertar/editar rechazado) |
| Firma anónima de cliente (`firmas.sql`, rol `anon`) | su convenio con clave válida | igual (no se toca) |

**Condición previa**: la fase 03 no se aplica en producción hasta confirmar que `nube.sql` y
`roles.sql` están corridos y que todo el equipo de ventas está en la lista; si no, alguien de ventas
se quedaría sin ver nada.

## 8. Invariantes (no negociables)

1. **Historial del CDH intocable**: el shell nunca escribe en la base del CDH; toda escritura operativa
   sigue pasando por `recordMovement()`. La fase 05 sólo agrega rutas de sesión.
2. **Nadie entra a un módulo que el portal no le permite** en el momento del canje (R1, R4, R5).
3. **Un boleto sirve una vez y a lo más 60 s**, y un canje concurrente no puede ganar dos veces.
4. **Una desactivación corta todo**: portal, Supabase (CRM) y CDH; si una parte falla, se avisa y
   queda registrado, nunca se reporta como hecho.
5. **Secretos sólo en el servidor** (y la dirección del proyecto Supabase fuera de los repos públicos, igual que hoy en el CRM): `service_role`, `DATABASE_URL` y `CQ_SSO_SECRETO` nunca viajan al
   navegador ni al repositorio (el del CRM es **público**). En el navegador sólo la llave `anon`.
6. **La dirección del CRM no cambia** (`core-quartz.vercel.app`).
7. **Lo firmado no se altera**: convenios y contratos del CRM no se tocan.
8. **Bitácora del portal sólo de inserción**, reforzada por disparador.

## 9. Restricciones de ejecución

- **Debe**: Node ≥ 22.18, TypeScript sin paso de compilación, Express 5, `pg`, Postgres de Supabase,
  Docker en la misma VM que el CDH detrás de Caddy, **todo expuesto bajo `core-quartz.vercel.app`**
  (`/`, `/portal`, `/cdh`), HTTPS obligatorio también en el origen, español en toda la interfaz,
  usable a 360 px.
- **Nunca**: bundlers ni *frameworks* de interfaz; la llave `service_role` en el cliente; tocar el
  historial del CDH; cambiar la URL del CRM; correr pruebas contra el Supabase de **producción**
  (se usa Postgres local para pruebas y un proyecto Supabase de *staging* para la e2e).
- Dependencias nuevas mínimas: `express`, `cookie-parser`, `pg` (+ `typescript`, `@types/*`,
  `playwright` de desarrollo). Supabase Auth se llama con `fetch` nativo, sin `supabase-js`.

## 10. Preguntas abiertas (no bloquean la revisión)

1. ~~Repositorio~~ → **`AmezolaCD/Core-Quartz`** (público). Falta darle a la sesión permiso de
   escritura; mientras, el código se entrega en zip.
2. ~~Dominio~~ → **`core-quartz.vercel.app`** con `/portal` y `/cdh`. Falta: ¿qué VM y qué nombre HTTPS
   usa el origen? (`sslip.io` sirve si no hay dominio.)
3. ¿`nube.sql`, `roles.sql` y `firmas.sql` están corridos en producción? (condiciona la fase 03).
4. **Proyecto Supabase de staging** para la prueba e2e (gratuito): ¿lo crean ustedes?
5. En Supabase: bajar *Email OTP expiration* a 300 s para que el enlace del CRM caduque pronto
   (no afecta el acceso con contraseña que usa el CRM hoy).

## 11. Criterios de aceptación

- [ ] Una persona con acceso a ambos entra una vez y abre **CRM** y **CDH** sin volver a escribir contraseña.
- [ ] El portal sólo muestra los módulos que R1 permite; abrir uno no permitido por URL devuelve 403.
- [ ] Todos los casos de R2–R8 de este documento existen como pruebas automáticas y pasan.
- [ ] Un boleto no se puede canjear dos veces ni después de 60 s, incluso con dos canjes simultáneos.
- [ ] Desactivar a alguien lo saca del portal, lo bloquea en Supabase y revoca sus sesiones del CDH; si el CDH no responde, se ve el aviso y queda en la bitácora.
- [ ] No se puede dejar el portal sin administrador activo.
- [ ] Un `username` del CDH no puede ligarse a dos personas.
- [ ] Una cuenta de Supabase que no está en la lista del CRM lee 0 filas de `crm_datos` (fase 03).
- [ ] La suite existente del CDH (`npm test`, `npm run test:ui`) sigue pasando sin cambios en sus pruebas.
- [ ] Ninguna escritura del shell llega a la base del CDH (verificado por prueba).
- [ ] La URL del CRM sigue siendo `https://core-quartz.vercel.app` y sus enlaces de firma siguen abriendo.
- [ ] El portal abre en `https://core-quartz.vercel.app/portal/` y el CDH en `https://core-quartz.vercel.app/cdh/`.
- [ ] El CDH sin `CDH_BASE_PATH` se comporta exactamente como hoy.
- [ ] El portal es usable a 360 × 740 y a 1280 × 800 (Playwright, sin desbordes horizontales).
- [ ] Ningún secreto aparece en el HTML/JS servido ni en los repositorios (`git grep` en CI).
- [ ] `docker compose up` levanta shell + CDH + Caddy y `GET /portal/api/salud` responde `{ok:true}`.
- [ ] Una subida de fotos del CDH a través de Vercel funciona con el tamaño máximo permitido.
- [ ] La prueba e2e (fase 09) pasa contra staging.
