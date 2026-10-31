-- ═══════════════════════════════════════════════════════════════════════════════
--  PORTAFOLIO — tablas de Supabase (versión 2821 — acceso solo para marcos.g.della@gmail.com)
--  Correr entero en tu proyecto: Supabase → SQL Editor → New query → pegar → Run.
--  Se puede correr más de una vez: crea lo que falta y actualiza lo que ya tenías
--  sin borrar tus movimientos.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) Movimientos (compras, ventas, aportes): una fila por movimiento, el detalle va en "data"
create table if not exists public.movimientos (
  id         bigint primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2) Cobros (dividendos, rentas, amortizaciones)
create table if not exists public.trk_divs (
  id         bigint primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- 3) Configuración y datos de la app (precios objetivo, ratios, tipos de cambio, historial, etc.)
create table if not exists public.config (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now()
);

-- Si ya tenías las tablas de una versión anterior: agregar lo que falte
alter table public.movimientos add column if not exists updated_at timestamptz not null default now();
alter table public.trk_divs    add column if not exists updated_at timestamptz not null default now();
alter table public.config      add column if not exists updated_at timestamptz not null default now();

-- La app guarda con "upsert" por id / key: hace falta que sean clave primaria (o únicos).
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.movimientos'::regclass and contype in ('p','u')) then
    begin alter table public.movimientos add primary key (id);
    exception when others then raise notice 'movimientos: no se pudo agregar la clave primaria (¿ids repetidos?). La app igual funciona, pero más lento.'; end;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.trk_divs'::regclass and contype in ('p','u')) then
    begin alter table public.trk_divs add primary key (id);
    exception when others then raise notice 'trk_divs: no se pudo agregar la clave primaria.'; end;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.config'::regclass and contype in ('p','u')) then
    begin alter table public.config add primary key (key);
    exception when others then raise notice 'config: no se pudo agregar la clave primaria (¿keys repetidas?).'; end;
  end if;
end $$;

-- 4) (Quitado) "Oye Siri": se elimina la función y la tabla si existían, para no dejar una puerta abierta sin login.
drop function if exists public.siri(text);
drop table if exists public.siri_resumen;

-- 5) Historial de precios por activo: una fila por fecha, con los precios de todos los tickers en "precios"
create table if not exists public.precios_hist (
  fecha   date primary key,
  precios jsonb not null default '{}'::jsonb
);
alter table public.precios_hist enable row level security;

-- 6) Perfiles adicionales (otra cartera en la misma página): tablas propias para el perfil 2 y el perfil 3
create table if not exists public.movimientos_p2 (id bigint primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.trk_divs_p2    (id bigint primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.movimientos_p3 (id bigint primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.trk_divs_p3    (id bigint primary key, data jsonb not null, updated_at timestamptz not null default now());
alter table public.movimientos_p2 enable row level security;
alter table public.trk_divs_p2    enable row level security;
alter table public.movimientos_p3 enable row level security;
alter table public.trk_divs_p3    enable row level security;

-- ═════════════════════════════════════════════════════════════════
--  ACCESO — SOLO TU MAIL
--  Solo entra quien inició sesión con marcos.g.della@gmail.com. Sin sesión (anon) no se lee ni se escribe nada.
-- ═════════════════════════════════════════════════════════════════
alter table public.movimientos  enable row level security;
alter table public.trk_divs     enable row level security;
alter table public.config       enable row level security;

revoke all on public.movimientos, public.trk_divs, public.config, public.precios_hist, public.movimientos_p2, public.trk_divs_p2, public.movimientos_p3, public.trk_divs_p3 from anon;
revoke truncate, references, trigger on public.movimientos, public.trk_divs, public.config, public.precios_hist, public.movimientos_p2, public.trk_divs_p2, public.movimientos_p3, public.trk_divs_p3 from authenticated;
grant select, insert, update, delete on public.movimientos, public.trk_divs, public.config, public.precios_hist, public.movimientos_p2, public.trk_divs_p2, public.movimientos_p3, public.trk_divs_p3 to authenticated;
alter default privileges in schema public revoke all on tables from anon;

do $$ declare t text; begin
  foreach t in array array['movimientos','trk_divs','config','precios_hist','movimientos_p2','trk_divs_p2','movimientos_p3','trk_divs_p3'] loop
    execute format('drop policy if exists "app: acceso total" on public.%I', t);
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "solo mi email" on public.%I', t);
    execute format('drop policy if exists "solo yo" on public.%I', t);
    execute format('create policy "solo yo" on public.%I for all to authenticated using ((auth.jwt()->>''email'') = %L) with check ((auth.jwt()->>''email'') = %L)', t, 'marcos.g.della@gmail.com', 'marcos.g.della@gmail.com');
  end loop;
end $$;

-- Listo. Para verificar:  select policyname, roles from pg_policies where schemaname='public';
