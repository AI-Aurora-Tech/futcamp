-- ===========================================================================
-- FutCamp — mesários (table officials) e lançamento em tempo real
--
--  • O administrador cria mesários (usuário + senha bcrypt via pgcrypto) e
--    atribui jogos (matches.official_id).
--  • O mesário entra no portal e lança placar/eventos SOMENTE dos jogos
--    atribuídos a ele, via RPCs SECURITY DEFINER (não é usuário do Supabase Auth).
-- ===========================================================================

create table if not exists public.officials (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships on delete cascade,
  name            text not null,
  username        text not null,
  password_hash   text not null,
  created_at      timestamptz not null default now(),
  unique (championship_id, username)
);

alter table public.officials enable row level security;

-- Apenas o dono do campeonato gerencia os mesários diretamente.
drop policy if exists officials_owner on public.officials;
create policy officials_owner on public.officials
  for all using (public.owns_championship(championship_id))
  with check (public.owns_championship(championship_id));

alter table public.matches add column if not exists official_id uuid references public.officials on delete set null;

-- ---------------------------------------------------------------------------
-- Administrador: cria mesário com senha em hash.
-- ---------------------------------------------------------------------------
create or replace function public.create_official(
  p_champ uuid, p_name text, p_username text, p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.owns_championship(p_champ) then
    raise exception 'Não autorizado';
  end if;
  insert into public.officials (championship_id, name, username, password_hash)
  values (p_champ, p_name, p_username, crypt(p_password, gen_salt('bf')));
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper interno: id do mesário se as credenciais conferem.
-- ---------------------------------------------------------------------------
create or replace function public.mesa_official_id(p_champ uuid, p_username text, p_password text)
returns uuid
language sql
security definer
stable
set search_path = public, extensions
as $$
  select id from public.officials
  where championship_id = p_champ and username = p_username
    and password_hash = crypt(p_password, password_hash)
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Portal: login do mesário (sem expor o hash).
-- ---------------------------------------------------------------------------
create or replace function public.mesa_login(p_champ uuid, p_username text, p_password text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare v_id uuid; v jsonb;
begin
  v_id := public.mesa_official_id(p_champ, p_username, p_password);
  if v_id is null then return null; end if;
  select to_jsonb(o) - 'password_hash' into v from public.officials o where o.id = v_id;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal: atualizar placar/status de um jogo atribuído.
-- ---------------------------------------------------------------------------
create or replace function public.mesa_update_match(
  p_champ uuid, p_username text, p_password text,
  p_match uuid, p_home int, p_away int, p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  v_id := public.mesa_official_id(p_champ, p_username, p_password);
  if v_id is null then raise exception 'Credenciais inválidas'; end if;
  update public.matches
     set home_score = p_home,
         away_score = p_away,
         status = coalesce(p_status, status)
   where id = p_match and championship_id = p_champ and official_id = v_id;
  if not found then raise exception 'Jogo não atribuído a você'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal: adicionar evento a um jogo atribuído.
-- ---------------------------------------------------------------------------
create or replace function public.mesa_add_event(
  p_champ uuid, p_username text, p_password text,
  p_match uuid, p_team uuid, p_player uuid, p_type text, p_minute int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_new uuid;
begin
  v_id := public.mesa_official_id(p_champ, p_username, p_password);
  if v_id is null then raise exception 'Credenciais inválidas'; end if;
  if not exists (select 1 from public.matches where id = p_match and official_id = v_id) then
    raise exception 'Jogo não atribuído a você';
  end if;
  insert into public.match_events (match_id, championship_id, team_id, player_id, type, minute)
  values (p_match, p_champ, p_team, p_player, p_type, p_minute)
  returning id into v_new;
  return jsonb_build_object('id', v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- Portal: remover evento de um jogo atribuído.
-- ---------------------------------------------------------------------------
create or replace function public.mesa_delete_event(
  p_champ uuid, p_username text, p_password text, p_event uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  v_id := public.mesa_official_id(p_champ, p_username, p_password);
  if v_id is null then raise exception 'Credenciais inválidas'; end if;
  delete from public.match_events e
   using public.matches m
   where e.id = p_event and e.match_id = m.id and m.official_id = v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.mesa_official_id(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_official(uuid, text, text, text)                        to authenticated;
grant execute on function public.mesa_login(uuid, text, text)                                   to anon, authenticated;
grant execute on function public.mesa_update_match(uuid, text, text, uuid, int, int, text)      to anon, authenticated;
grant execute on function public.mesa_add_event(uuid, text, text, uuid, uuid, uuid, text, int)  to anon, authenticated;
grant execute on function public.mesa_delete_event(uuid, text, text, uuid)                      to anon, authenticated;
