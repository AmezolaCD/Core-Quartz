# Fase 07 · Interfaz del portal

## Alcance
HTML/CSS/JS sin compilación, servido en `/portal/` (rutas relativas, enrutador por `#/`), en español, con la identidad del CRM (morado `#39104e`, oro `#b2aa6d`,
tema claro y oscuro).

- **Entrar**: correo, contraseña, mensajes de R2.
- **Inicio**: una tarjeta grande por módulo visible (R1), que lleva a `api/modulos/:codigo/abrir` (relativo a `/portal/`).
  Sin módulos → «Aún no tienes módulos asignados. Pídeselo a Sistemas.» Chip con el nombre y *Salir*.
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

## Criterios de aceptación
- [ ] Recorridos de Ana, Beto, Carla, Dani y Eva del PRD: cada uno ve exactamente lo que dice R1/R2.
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
