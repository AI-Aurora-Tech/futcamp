-- ===========================================================================
-- Tabelaço — Row Level Security (RLS)
--
-- Modelo de acesso:
--   • Leitura pública: qualquer visitante pode consultar campeonatos, times,
--     jogadores, partidas e eventos (as páginas públicas do campeonato).
--   • Escrita restrita: apenas o organizador dono do campeonato pode criar,
--     editar ou remover dados daquele campeonato.
-- ===========================================================================

-- Função auxiliar: o usuário atual é dono do campeonato informado?
create or replace function public.owns_championship(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.championships c
    where c.id = cid and c.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- championships
-- ---------------------------------------------------------------------------
alter table public.championships enable row level security;

drop policy if exists championships_read on public.championships;
create policy championships_read on public.championships
  for select using (true);

drop policy if exists championships_insert on public.championships;
create policy championships_insert on public.championships
  for insert with check (auth.uid() = owner_id);

drop policy if exists championships_update on public.championships;
create policy championships_update on public.championships
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists championships_delete on public.championships;
create policy championships_delete on public.championships
  for delete using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- teams / players / matches / match_events
-- Padrão: leitura pública; escrita apenas para o dono do campeonato.
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;
drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select using (true);
drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams
  for all using (public.owns_championship(championship_id))
  with check (public.owns_championship(championship_id));

alter table public.players enable row level security;
drop policy if exists players_read on public.players;
create policy players_read on public.players for select using (true);
drop policy if exists players_write on public.players;
create policy players_write on public.players
  for all using (public.owns_championship(championship_id))
  with check (public.owns_championship(championship_id));

alter table public.matches enable row level security;
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select using (true);
drop policy if exists matches_write on public.matches;
create policy matches_write on public.matches
  for all using (public.owns_championship(championship_id))
  with check (public.owns_championship(championship_id));

alter table public.match_events enable row level security;
drop policy if exists match_events_read on public.match_events;
create policy match_events_read on public.match_events for select using (true);
drop policy if exists match_events_write on public.match_events;
create policy match_events_write on public.match_events
  for all using (public.owns_championship(championship_id))
  with check (public.owns_championship(championship_id));
