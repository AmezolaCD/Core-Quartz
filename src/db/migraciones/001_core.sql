-- 001_core.sql · esquema `core` de Core Quartz (PRD §6).
--
-- Todo vive en el esquema `core`: nada se crea en `public` ni en `auth`.
-- Se puede volver a correr sin efecto (todo es `if not exists` / `on conflict`).
-- Las horas las sella el servidor (`now()`); el huso del hotel sólo importa al mostrar.
--
-- Las direcciones de los módulos llegan por variables de entorno, que el migrador
-- pone como ajustes de la transacción (`cq.url_crm`, `cq.url_cdh`).

create schema if not exists core;

-- ---- Registro del propio migrador ----

create table if not exists core.migraciones (
  nombre   text primary key,
  aplicada timestamptz not null default now()
);

-- ---- Personas del portal (PRD §6) ----

create table if not exists core.usuarios (
  id          uuid primary key,                       -- el mismo de auth.users
  correo      text not null,                          -- siempre en minúsculas
  nombre      text not null,
  es_admin    boolean not null default false,
  activo      boolean not null default true,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  constraint usuarios_correo_minusculas check (correo = lower(correo)),
  constraint usuarios_correo_no_vacio check (length(correo) > 0)
);

-- R2: el correo no distingue mayúsculas.
create unique index if not exists usuarios_correo_unico on core.usuarios (lower(correo));

-- ---- Catálogo de módulos (PRD §6, R1) ----

create table if not exists core.modulos (
  codigo   text primary key,                           -- 'crm' | 'cdh'
  nombre   text not null,
  url_base text,
  entrada  text not null,                              -- 'enlace_supabase' | 'boleto'
  activo   boolean not null default true,
  orden    integer not null default 0,
  constraint modulos_entrada_conocida check (entrada in ('enlace_supabase', 'boleto'))
);

-- ---- Accesos: quién alcanza qué módulo (R1, R7) ----

create table if not exists core.accesos (
  usuario_id     uuid not null references core.usuarios (id),
  modulo         text not null references core.modulos (codigo),
  usuario_modulo text,                                 -- CDH: su `username`; CRM: siempre NULL
  activo         boolean not null default true,
  creado         timestamptz not null default now(),
  actualizado    timestamptz not null default now(),
  primary key (usuario_id, modulo)
);

-- R7: un usuario de módulo (p. ej. el `username` del CDH) sólo puede estar ligado a
-- una persona, sin distinguir mayúsculas. Los accesos inactivos también ocupan el nombre.
create unique index if not exists accesos_usuario_modulo_unico
  on core.accesos (modulo, lower(usuario_modulo))
  where usuario_modulo is not null;

-- ---- Sesiones del portal (R2): del token sólo se guarda su SHA-256 ----

create table if not exists core.sesiones (
  id         uuid primary key,
  usuario_id uuid not null references core.usuarios (id),
  token_hash text not null unique,
  ip         text,
  agente     text,
  creada     timestamptz not null default now(),
  expira     timestamptz not null,
  revocada   timestamptz
);

create index if not exists sesiones_por_usuario on core.sesiones (usuario_id);
create index if not exists sesiones_vivas on core.sesiones (expira) where revocada is null;

-- ---- Boletos de un solo uso (R3, R4): del código sólo se guarda su SHA-256 ----

create table if not exists core.boletos (
  id             uuid primary key,
  codigo_hash    text not null unique,
  usuario_id     uuid not null references core.usuarios (id),
  modulo         text not null references core.modulos (codigo),
  usuario_modulo text,
  emitido        timestamptz not null default now(),
  expira         timestamptz not null,
  canjeado       timestamptz,
  resultado      text,
  ip             text
);

create index if not exists boletos_por_usuario on core.boletos (usuario_id);
create index if not exists boletos_pendientes on core.boletos (usuario_id) where canjeado is null;

-- ---- Bitácora del portal (PRD §6, invariante 8): sólo inserción ----

create table if not exists core.bitacora (
  n          bigserial primary key,
  cuando     timestamptz not null default now(),
  quien      uuid,                                     -- null = lo hizo el sistema
  accion     text not null,
  entidad    text not null,
  entidad_id text not null,
  antes      jsonb,
  despues    jsonb
);

create index if not exists bitacora_por_entidad on core.bitacora (entidad, entidad_id);
create index if not exists bitacora_por_quien on core.bitacora (quien);

create or replace function core.bitacora_solo_insercion() returns trigger
language plpgsql as $funcion$
begin
  raise exception 'core.bitacora es sólo de inserción: % no está permitido (invariante 8)', tg_op
    using errcode = 'restrict_violation';
end;
$funcion$;

-- Disparador por sentencia: también frena un `DELETE` sin `WHERE` o un `TRUNCATE`.
drop trigger if exists bitacora_sin_cambios on core.bitacora;
create trigger bitacora_sin_cambios
  before update or delete on core.bitacora
  for each statement execute function core.bitacora_solo_insercion();

drop trigger if exists bitacora_sin_truncar on core.bitacora;
create trigger bitacora_sin_truncar
  before truncate on core.bitacora
  for each statement execute function core.bitacora_solo_insercion();

-- ---- Semilla del catálogo (R1: el orden es por `orden`, no alfabético) ----

insert into core.modulos (codigo, nombre, url_base, entrada, activo, orden)
values
  ('crm', 'CRM de Ventas',
   coalesce(nullif(current_setting('cq.url_crm', true), ''), '/'),
   'enlace_supabase', true, 1),
  ('cdh', 'Control de Detalles por Habitación',
   coalesce(nullif(current_setting('cq.url_cdh', true), ''), '/cdh'),
   'boleto', true, 2)
on conflict (codigo) do nothing;
