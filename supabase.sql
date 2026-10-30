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

-- 4) "Oye Siri, mi cartera" (opcional): resumen hablado que lee un atajo del iPhone con un código secreto
create table if not exists public.siri_resumen (
  token text primary key,
  data  jsonb not null,
  ts    timestamptz not null default now()
);
create or replace function public.siri(p_token text) returns jsonb
language sql security definer set search_path = public as $$
  select coalesce((select data from siri_resumen where token = p_token),
                  jsonb_build_object('texto', 'No encontré tu cartera. Revisá el código del atajo.'))
$$;
revoke all on function public.siri(text) from public;
grant execute on function public.siri(text) to anon, authenticated;


-- 5) Historial de precios por activo: una fila por fecha, con los precios de todos los tickers en "precios"
create table if not exists public.precios_hist (
  fecha   date primary key,
  precios jsonb not null default '{}'::jsonb
);
alter table public.precios_hist enable row level security;

-- ═════════════════════════════════════════════════════════════════
--  ACCESO — SOLO TU MAIL
--  Solo entra quien inició sesión con marcos.g.della@gmail.com. Sin sesión (anon) no se lee ni se escribe nada.
-- ═════════════════════════════════════════════════════════════════
alter table public.movimientos  enable row level security;
alter table public.trk_divs     enable row level security;
alter table public.config       enable row level security;
alter table public.siri_resumen enable row level security;

grant select, insert, update, delete on public.movimientos, public.trk_divs, public.config, public.siri_resumen, public.precios_hist to authenticated;
revoke select, insert, update, delete on public.movimientos, public.trk_divs, public.config, public.siri_resumen, public.precios_hist from anon;

do $$ declare t text; begin
  foreach t in array array['movimientos','trk_divs','config','siri_resumen','precios_hist'] loop
    execute format('drop policy if exists "app: acceso total" on public.%I', t);
    execute format('drop policy if exists "authenticated full access" on public.%I', t);
    execute format('drop policy if exists "solo mi email" on public.%I', t);
    execute format('drop policy if exists "solo yo" on public.%I', t);
    execute format('create policy "solo yo" on public.%I for all to authenticated using ((auth.jwt()->>''email'') = %L) with check ((auth.jwt()->>''email'') = %L)', t, 'marcos.g.della@gmail.com', 'marcos.g.della@gmail.com');
  end loop;
end $$;

-- Listo. Para verificar:  select policyname, roles from pg_policies where schemaname='public';
