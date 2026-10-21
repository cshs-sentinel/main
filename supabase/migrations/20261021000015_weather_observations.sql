-- Migration: 20261021000015_weather_observations.sql
-- Server-side weather observations (Phase 6, Task 6.1).
-- Written ONLY by the server-side worker (service_role); clients may read the
-- latest observation so that a stale value can be shown with its age, but they
-- can never write one. External weather is an advisory input, never an indoor
-- measurement and never a decision (docs/HEAT_INDEX.md).

create table public.weather_observations (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools (id),
  source text not null,
  observed_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  latitude numeric(9, 6) not null,
  longitude numeric(9, 6) not null,
  temperature_c numeric(6, 2) not null,
  humidity_percent numeric(5, 2) not null,
  heat_index_c numeric(6, 2),
  heat_index_method text,
  heat_index_applicable boolean,
  rule_version text not null,
  is_stale boolean not null default false,
  created_at timestamptz not null default now(),
  constraint weather_observations_source check (source in ('open-meteo')),
  constraint weather_observations_method check (heat_index_method in ('rothfusz', 'simple', 'not-applicable')),
  constraint weather_observations_temperature check (temperature_c between -50 and 60),
  constraint weather_observations_humidity check (humidity_percent between 0 and 100)
);

comment on table public.weather_observations is 'External weather observations ingested server-side. Advisory input only — not an indoor measurement and never a decision.';
comment on column public.weather_observations.rule_version is 'Calculation rule that produced heat_index_c (heat_index_v1).';
comment on column public.weather_observations.is_stale is 'True when the observation is older than the freshness window (1 hour) at write time.';

create index idx_weather_observations_school_time
  on public.weather_observations (school_id, fetched_at desc);

-- ============================================================
-- RLS: authenticated read (own school), no client write
-- ============================================================
alter table public.weather_observations enable row level security;

create policy "weather_observations_select_school"
  on public.weather_observations for select
  to authenticated
  using (school_id = public.my_school_id());
-- No client insert/update/delete: only the server-side worker writes (service_role).

grant select on public.weather_observations to authenticated;
