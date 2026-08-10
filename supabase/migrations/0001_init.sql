-- ===========================================================================
-- FutCamp — esquema inicial
-- Campeonatos esportivos: organizadores, times, jogadores, partidas e eventos.
-- ===========================================================================

-- Extensão para gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Perfis de organizadores (1:1 com auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text,
  email      text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Campeonatos
-- ---------------------------------------------------------------------------
create table if not exists public.championships (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users on delete cascade,
  name          text not null,
  sport         text not null default 'futebol',
  format        text not null default 'league',   -- league | groups_knockout | knockout
  season        text,
  status        text not null default 'draft',     -- draft | active | finished
  description   text,
  logo          text,
  primary_color text,
  points_win    int  not null default 3,
  points_draw   int  not null default 1,
  double_round  boolean not null default false,
  num_groups    int,
  created_at    timestamptz not null default now()
);
create index if not exists championships_owner_idx on public.championships (owner_id);

-- ---------------------------------------------------------------------------
-- Times
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships on delete cascade,
  name            text not null,
  short_name      text,
  logo            text,
  "group"         text,
  color           text,
  coach           text,
  created_at      timestamptz not null default now()
);
create index if not exists teams_championship_idx on public.teams (championship_id);

-- ---------------------------------------------------------------------------
-- Jogadores
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams on delete cascade,
  championship_id uuid not null references public.championships on delete cascade,
  name            text not null,
  number          int,
  position        text,
  birthdate       date,
  photo           text,
  created_at      timestamptz not null default now()
);
create index if not exists players_team_idx on public.players (team_id);
create index if not exists players_championship_idx on public.players (championship_id);

-- ---------------------------------------------------------------------------
-- Partidas
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships on delete cascade,
  round           int  not null default 1,
  phase           text not null default 'group',
  "group"         text,
  home_team_id    uuid references public.teams on delete set null,
  away_team_id    uuid references public.teams on delete set null,
  home_score      int,
  away_score      int,
  status          text not null default 'scheduled', -- scheduled | live | finished
  scheduled_at    timestamptz,
  venue           text,
  created_at      timestamptz not null default now()
);
create index if not exists matches_championship_idx on public.matches (championship_id);

-- ---------------------------------------------------------------------------
-- Eventos de partida (gols, cartões, assistências)
-- ---------------------------------------------------------------------------
create table if not exists public.match_events (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches on delete cascade,
  championship_id uuid not null references public.championships on delete cascade,
  team_id         uuid not null references public.teams on delete cascade,
  player_id       uuid references public.players on delete set null,
  type            text not null,   -- goal | own_goal | assist | yellow_card | red_card
  minute          int,
  created_at      timestamptz not null default now()
);
create index if not exists match_events_match_idx on public.match_events (match_id);
create index if not exists match_events_championship_idx on public.match_events (championship_id);

-- ---------------------------------------------------------------------------
-- Cria o perfil automaticamente quando um usuário se cadastra.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
