-- ===========================================================================
--  Fase 03 · Supabase simulado, para probar la RLS del CRM en Postgres local
--
--  Reproduce lo poco de Supabase que las reglas del CRM necesitan para ser
--  ciertas, y nada más:
--
--   · el esquema `auth` con `auth.jwt()`, que aquí lee la variable de sesión
--     `request.jwt.claims` — lo mismo que hace PostgREST en Supabase;
--   · los roles `anon` y `authenticated`, sin superusuario, para que la RLS
--     sí se les aplique (al dueño de la tabla no se le aplica);
--   · los permisos que Supabase le da por omisión a esos dos roles sobre el
--     esquema `public`.
--
--  Se carga ANTES de `nube.sql`, porque `crm_sella()` ya llama a `auth.jwt()`.
--  Nunca se corre contra Supabase: es al revés, esto imita a Supabase (PRD §9,
--  «nunca correr pruebas contra el Supabase de producción»).
--
--  Es re-ejecutable: correrlo dos veces no cambia nada.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Los roles del lado del cliente
--
--    `nologin` porque nadie se conecta como ellos: la prueba entra como
--    `postgres` y hace `set local role`, igual que PostgREST. `noinherit`
--    para que no arrastren permisos de otra parte sin que se note.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Existe por fidelidad: el CRM no lo usa desde el navegador (invariante 5).
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. El esquema `auth`
--
--    `auth.jwt()` en Supabase devuelve las afirmaciones del token que trae la
--    petición. Aquí salen de `request.jwt.claims`, que la prueba fija por
--    transacción con `set_config(..., true)`. Sin token, un objeto vacío: es
--    lo que ve una petición anónima, y es justo el caso que R8 arregla.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$ select auth.jwt() ->> 'role'; $$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid; $$;

create or replace function auth.email()
returns text
language sql
stable
as $$ select auth.jwt() ->> 'email'; $$;

-- ---------------------------------------------------------------------------
-- 3. Los permisos por omisión de Supabase
--
--    En Supabase `anon` y `authenticated` traen GRANT ALL sobre el esquema
--    `public`; lo único que los frena es la RLS. Si aquí no se les diera,
--    las pruebas pasarían por falta de permiso de tabla y no por la política,
--    que es precisamente lo que se quiere medir.
--
--    Se hace con ALTER DEFAULT PRIVILEGES *antes* de que `nube.sql` y
--    `firmas.sql` creen sus tablas, para que las alcance sin tener que volver
--    a otorgar nada después.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Y por si el archivo se carga sobre una base que ya tenía tablas.
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
