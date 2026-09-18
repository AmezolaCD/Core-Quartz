# Fase 03 · Blindaje del CRM (R8)

## Alcance
Un cambio de **una función** en el repo del CRM: `crm_rol()` devuelve `'ninguno'` cuando el correo no
está en la lista de usuarios, y las políticas de `roles.sql` tratan `ninguno` como «nada». Se
documenta en `ROLES.md`. Las pruebas viven en el repo del shell y cargan los `.sql` reales del CRM
en el Postgres local, con un esquema `auth` simulado (`auth.jwt()` lee una variable de sesión) y los
roles `anon` / `authenticated`.

**Ampliación aprobada el 18 sep 2026** (revisión de la fase): el blindaje no queda completo con
`roles.sql` solo, así que la fase incluye además:

- **`firmas.sql`**: las políticas de `public.crm_firmas` son hoy `to authenticated using (true)`, sin
  mirar el papel. Se comprobó que una cuenta en `ninguno` (la de intendencia, por ejemplo) lee el
  buzón completo —nombre, puesto, celular, imagen de la firma y la **clave del convenio**—, alcanza
  con esa clave el convenio entero como `anon`, **sustituye la firma** (el CRM graba la falsificada
  al cerrar el convenio, lo que rompe la invariante §8.7) y puede marcar como atendida una firma
  legítima para que se pierda. Se agrega la guarda de papel a `select` y `update`; la inserción
  anónima del cliente (que va por la clave) no se toca.
- **`index.html`**, sólo la pantalla «¿Por qué no veo algo?» (`revisarPermisos` / `pantallaPermisos`):
  con `ninguno` llegan cero filas de usuarios, así que hoy dice «la nube no tiene la lista de
  usuarios … trata a todos como ejecutivos sin nombre» —falso desde este cambio— en vez de «tu
  correo no está en la lista». Se distinguen los dos casos y se corrige esa frase.

**No** se toca `nube.sql` ni nada más de `index.html`. **No** se aplica en producción en esta fase:
se entrega el SQL y una nota con la condición previa del PRD §7-R8.

## Archivos
- CRM: `roles.sql` (función `crm_rol` y cláusulas `case` de las tres políticas)
- CRM: `firmas.sql` (guarda de papel en `equipo lee firmas` y `equipo marca firmas`)
- CRM: `index.html` (sólo `revisarPermisos` / `pantallaPermisos`)
- CRM: `ROLES.md` (sección «Cuentas que no son de ventas»)
- shell: `test/apoyo/supabase-simulado.sql`
- shell: `test/crm-rls/roles.test.ts`
- shell: `package.json` (script `test:crm-rls`, variable `CRM_REPO` con la ruta al clon del CRM)

## Criterios de aceptación
- [ ] Todas las filas de la tabla R8 son casos de prueba, antes y después (el «antes» se prueba contra el `roles.sql` del commit publicado `81a7d1f`, para demostrar el hueco; el CRM no tiene rama `main`, y la línea base se puede mover con `CRM_REF_BASE`).
- [ ] Cuenta fuera de la lista: `select` → 0 filas de cualquier `tipo`; `insert`/`update` → rechazados.
- [ ] `admin`, `gerente`, `ejecutivo`, `captura` se comportan exactamente igual que antes (mismos conteos sobre el mismo juego de datos).
- [ ] La firma anónima de `firmas.sql` sigue funcionando con clave válida.
- [ ] Correr `nube.sql` → `roles.sql` → `firmas.sql` dos veces no falla (siguen siendo re-ejecutables).
- [ ] Una cuenta en `ninguno` no lee ni una fila de `crm_firmas`, y no puede editarlas: ni sustituir la firma pendiente ni marcarla como aplicada.
- [ ] Los cuatro papeles conocidos siguen leyendo y marcando firmas exactamente como antes.
- [ ] El cliente anónimo sigue depositando su firma con clave válida, y sigue sin poder leer el buzón.
- [ ] La pantalla «¿Por qué no veo algo?» distingue «la lista no llegó a la nube» de «tu correo no está en la lista», y ya no afirma que el servidor trata a todos como ejecutivos sin nombre.

## Verificación
```bash
docker compose -f docker-compose.test.yml up -d pg
# El «antes» se lee del commit 81a7d1f del CRM (su línea base publicada, fijada
# en la prueba porque el CRM no tiene `main`); el clon debe traer el historial
# completo. Para probar contra otra línea base: CRM_REF_BASE=<ref>.
CRM_REPO=../CRM-VENTAS- npm run test:crm-rls
```
