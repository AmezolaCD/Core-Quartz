# Fase 03 · Blindaje del CRM (R8)

## Alcance
Un cambio de **una función** en el repo del CRM: `crm_rol()` devuelve `'ninguno'` cuando el correo no
está en la lista de usuarios, y las políticas de `roles.sql` tratan `ninguno` como «nada». Se
documenta en `ROLES.md`. Las pruebas viven en el repo del shell y cargan los `.sql` reales del CRM
en el Postgres local, con un esquema `auth` simulado (`auth.jwt()` lee una variable de sesión) y los
roles `anon` / `authenticated`.

**No** se toca `index.html`, `nube.sql` ni `firmas.sql`. **No** se aplica en producción en esta fase:
se entrega el SQL y una nota con la condición previa del PRD §7-R8.

## Archivos
- CRM: `roles.sql` (función `crm_rol` y cláusulas `case` de las tres políticas)
- CRM: `ROLES.md` (sección «Cuentas que no son de ventas»)
- shell: `test/apoyo/supabase-simulado.sql`
- shell: `test/crm-rls/roles.test.ts`
- shell: `package.json` (script `test:crm-rls`, variable `CRM_REPO` con la ruta al clon del CRM)

## Criterios de aceptación
- [ ] Todas las filas de la tabla R8 son casos de prueba, antes y después (el «antes» se prueba contra el `roles.sql` de `main` para demostrar el hueco).
- [ ] Cuenta fuera de la lista: `select` → 0 filas de cualquier `tipo`; `insert`/`update` → rechazados.
- [ ] `admin`, `gerente`, `ejecutivo`, `captura` se comportan exactamente igual que antes (mismos conteos sobre el mismo juego de datos).
- [ ] La firma anónima de `firmas.sql` sigue funcionando con clave válida.
- [ ] Correr `nube.sql` → `roles.sql` → `firmas.sql` dos veces no falla (siguen siendo re-ejecutables).

## Verificación
```bash
docker compose -f docker-compose.test.yml up -d pg
CRM_REPO=../CRM-VENTAS- npm run test:crm-rls
```
