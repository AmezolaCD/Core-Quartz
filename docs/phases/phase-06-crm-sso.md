# Fase 06 · Entrada única en el CRM

## Alcance
En `index.html` del repo **CRM-VENTAS-**, el menor cambio posible:

1. Junto a `leerInvitacion()`, leer también `cq=<token_hash>` **antes** de limpiar la barra de
   direcciones (hoy `leerInvitacion` borra todo el fragmento).
2. Después de aplicar la configuración de nube: si hay `cq`,
   - si hay sesión abierta de **otro correo** → el mismo camino que *Cerrar sesión* (subir lo pendiente, borrar copia local; si no se puede subir, preguntar);
   - `POST {url}/auth/v1/verify` con `{type:"magiclink", token_hash}` y la llave `anon`;
   - guardar la sesión igual que hoy lo hace el acceso con contraseña (mismo formato, mismo lugar);
   - error → pantalla de entrada con el mensaje de R5.
3. ~~**`vercel.json`**: añadir `rewrites` de `/portal/:ruta*` y `/cdh/:ruta*`…~~
   **Movido a la fase 08** (18 sep 2026). Requiere un origen público, y no lo hay: el CDH corre
   en Docker con Tailscale —accesible sólo desde esa red privada, nunca desde internet— y el
   shell todavía no corre en ningún lado. Vercel no puede reenviar a un host de una tailnet.
   El detalle y lo que arrastra quedan anotados en `phase-08-despliegue.md`.
4. Nada más: sin librerías nuevas, sigue siendo un solo archivo, y `#firmar=` (enlace de cliente) no cambia.

Las pruebas viven en el shell: sirven el `index.html` del clon del CRM en un puerto local y simulan
Supabase con `page.route()` de Playwright.

## Archivos
- CRM: `index.html` (sólo las funciones de invitación y arranque de sesión)
- ~~CRM: `vercel.json`~~ (fase 08)
- CRM: `README.md` / `NUBE.md` (párrafo «Entrar desde Core Quartz»)
- shell: `test/crm-sso/entrada.test.ts`, `test/apoyo/supabase-navegador.ts`
- shell: `package.json` (script `test:crm-sso`, `playwright` en dev)

## Criterios de aceptación
- [ ] `#nube=…&cq=ok` en navegador limpio → se llama a `/auth/v1/verify` una vez, el CRM muestra el tablero con el nombre del usuario y la barra de direcciones ya no tiene fragmento.
- [ ] `cq` rechazado por Supabase → pantalla de entrada con «El enlace ya se usó; entra desde Core Quartz otra vez».
- [ ] Sesión previa de otro correo con cambios pendientes → primero se suben (se observa la petición), luego se borra la copia local, luego se verifica el nuevo token.
- [ ] Sesión previa del **mismo** correo → no se borra nada.
- [ ] `cq` sin `nube` en navegador sin configuración → mensaje «Abre el CRM desde Core Quartz».
- [ ] `#firmar=…` se sigue abriendo como documento del cliente (prueba de regresión).
- [ ] Sin errores de consola en los recorridos.
- [x] ~~`vercel.json` es JSON válido, conserva el bloque `headers` y sus reescrituras no capturan `/` ni `/index.html`~~ → fase 08, junto con la decisión de si esas reescrituras existen.
- [ ] El diff de `index.html` se limita a las funciones de invitación/sesión (revisor lo confirma).

## Verificación
```bash
CRM_REPO=../CRM-VENTAS- npm run test:crm-sso
```
