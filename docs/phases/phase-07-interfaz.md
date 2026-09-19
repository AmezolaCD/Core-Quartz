# Fase 07 · Interfaz del portal

## Alcance
HTML/CSS/JS sin compilación, servido en `/portal/` (rutas relativas, enrutador por `#/`), en español, con la identidad del CRM (morado `#39104e`, oro `#b2aa6d`,
tema claro y oscuro).

- **Entrar**: correo, contraseña, mensajes de R2.
- **Inicio**: una tarjeta grande por módulo visible (R1), que lleva a `api/modulos/:codigo/abrir` (relativo a `/portal/`).
  Sin módulos → «Aún no tienes módulos asignados. Pídeselo a Sistemas.» Chip con el nombre y *Salir*.
- **Entrada directa** cuando sólo hay un módulo: ver abajo.
- **Administración** (sólo admin): lista de personas con búsqueda y estado; ficha con nombre,
  correo, admin, activo, y un interruptor por módulo (CDH pide su usuario). Errores de R6/R7 en línea.
  Aviso persistente de revocación pendiente con botón *Reintentar*. Pestaña *Bitácora*.
- Adaptable: una columna en celular, sin desplazamiento horizontal, objetivos táctiles ≥ 44 px.

## Archivos
- `public/index.html`, `public/css/app.css`
- `public/js/app.js`, `public/js/api.js`, `public/js/vistas/entrar.js`, `inicio.js`, `admin.js`
- `public/favicon.svg`
- `test/ui/portal.test.ts` (Playwright contra la app de pruebas de la fase 04)
- `package.json` (script `test:ui`)

## Entrada directa al único módulo

Decisión de producto de Juan (19 sep 2026). La mayoría del personal va a tener
**un solo módulo**: intendencia, mantenimiento y recepción sólo usan el CDH, y
buena parte de ventas sólo el CRM. Para esa gente el portal es un clic de más
en cada entrada, todos los días.

**Regla**: al entrar —y al abrir `/portal/` con sesión viva— si la persona
**no es administradora** y R1 le deja ver **exactamente un** módulo, el portal
la manda directo a `api/modulos/<codigo>/abrir` en lugar de pintar el inicio.

Se deriva de R1, **no se guarda en ninguna parte**: no hace falta columna nueva
ni migración, y el día que alguien gane o pierda un módulo el comportamiento se
ajusta solo. Si más adelante se quiere que cada quien lo decida, se agrega
entonces; empezar por la regla evita una columna que quizá nadie toque.

Los casos que hay que respetar, y por qué:

| Situación | Qué hace el portal |
|---|---|
| Un módulo, no admin | Directo a ese módulo |
| **Administradora**, tenga los módulos que tenga | **Siempre el inicio**: si se le manda a un módulo no tiene por dónde llegar a administración |
| Dos módulos | El inicio, con sus dos tarjetas: no hay a dónde mandarla |
| Cero módulos | El inicio, con el mensaje de «pídeselo a Sistemas» |

**El bucle es el riesgo real.** Si al entrar se dispara al CDH y desde el CDH se
vuelve al portal, el portal vuelve a dispararla. Se rompe con un parámetro
explícito: `/portal/?inicio=1` (y el enlace de «volver al portal» que ponga cada
módulo lo lleva) salta la entrada directa **esa vez**, sin recordar nada.

Y hay que dejar salida: quien entra directo nunca ve el portal, así que
*Cerrar sesión* tiene que poder alcanzarse volviendo con ese parámetro. La
vuelta se documenta para que las fases 05 y 06 —o quien toque los módulos
después— sepan qué enlace poner.

## Criterios de aceptación
- [ ] Recorridos de Ana, Beto, Carla, Dani y Eva del PRD: cada uno ve exactamente lo que dice R1/R2.
- [ ] Carla (sólo CDH, no admin) entra y termina en el CDH sin pulsar nada; Beto (sólo CRM) igual.
- [ ] Ana (admin con dos módulos) ve el inicio, y **también lo vería con un solo módulo**.
- [ ] Eva con un solo módulo entra directo; al quitarle ese acceso ve el mensaje de «sin módulos», sin redirección.
- [ ] `/portal/?inicio=1` muestra el inicio aunque la regla aplicara, y no deja el estado pegado: la siguiente entrada vuelve a ser directa.
- [ ] Desde la entrada directa se puede volver al portal y cerrar sesión (recorrido completo, sin quedar atrapado).
- [ ] Admin: alta, asignar CDH con usuario duplicado (ve el error), desactivar con CDH caído (ve el aviso), reintentar.
- [ ] A 360 × 740 y 1280 × 800: `document.documentElement.scrollWidth <= innerWidth` en todas las vistas.
- [ ] Un usuario no admin no recibe el JS de administración con datos (la API responde 403) y no ve el enlace.
- [ ] Sin errores de consola; todos los controles tienen nombre accesible.
- [ ] El portal no usa `localStorage` ni `sessionStorage` (comparte origen con el CRM).
- [ ] El HTML y JS servidos no contienen `service_role`, `DATABASE_URL` ni el secreto.

## Verificación
```bash
docker compose -f docker-compose.test.yml up -d pg
npm run test:ui
```
