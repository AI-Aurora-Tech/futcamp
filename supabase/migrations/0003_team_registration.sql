-- ===========================================================================
-- FutCamp — inscrição de times via link (sem login)
--
-- O organizador gera um link `#/t/<teamId>?k=<token>` e o envia ao time. Com o
-- token, o representante inclui escudo e atletas — sem conta e sem acesso ao
-- restante do campeonato.
--
-- Segurança: o token fica em `team_invites` (NUNCA na tabela pública `teams`) e
-- todas as operações passam por funções SECURITY DEFINER que validam o token.
-- ===========================================================================

create table if not exists public.team_invites (
  team_id         uuid primary key references public.teams on delete cascade,
  championship_id uuid not null references public.championships on delete cascade,
  token           text not null unique,
  created_at      timestamptz not null default now()
);

alter table public.team_invites enable row level security;

-- Apenas o dono do campeonato enxerga/gerencia os convites diretamente.
-- (As funções abaixo são SECURITY DEFINER e não dependem destas policies.)
drop policy if exists team_invites_owner on public.team_invites;
create policy team_invites_owner on public.team_invites
  for all using (public.owns_championship(championship_id))
  with check (public.owns_championship(championship_id));

-- ---------------------------------------------------------------------------
-- Organizador: garante (e retorna) o token de convite de um time.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_team_invite(p_team uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_champ uuid;
  v_token text;
begin
  select championship_id into v_champ from public.teams where id = p_team;
  if v_champ is null then
    raise exception 'Time não encontrado';
  end if;
  if not public.owns_championship(v_champ) then
    raise exception 'Não autorizado';
  end if;

  select token into v_token from public.team_invites where team_id = p_team;
  if v_token is null then
    v_token := encode(gen_random_bytes(16), 'hex');
    insert into public.team_invites (team_id, championship_id, token)
    values (p_team, v_champ, v_token);
  end if;
  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper interno: o token confere para o time?
-- ---------------------------------------------------------------------------
create or replace function public.invite_valid(p_team uuid, p_token text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_invites
    where team_id = p_team and token = p_token
  );
$$;

-- ---------------------------------------------------------------------------
-- Público (com token): dados de inscrição do time.
-- ---------------------------------------------------------------------------
create or replace function public.team_registration(p_team uuid, p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.invite_valid(p_team, p_token) then
    return null;
  end if;

  select jsonb_build_object(
    'team', to_jsonb(t.*),
    'championship_name', c.name,
    'championship_logo', c.logo,
    'players', coalesce(
      (select jsonb_agg(to_jsonb(p.*) order by p.number nulls last)
         from public.players p where p.team_id = p_team),
      '[]'::jsonb)
  ) into v
  from public.teams t
  join public.championships c on c.id = t.championship_id
  where t.id = p_team;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Público (com token): atualizar escudo/dados do time.
-- ---------------------------------------------------------------------------
create or replace function public.reg_update_team(
  p_team uuid, p_token text,
  p_name text, p_short text, p_logo text, p_color text, p_coach text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;
  update public.teams set
    name       = coalesce(nullif(p_name, ''), name),
    short_name = coalesce(p_short, short_name),
    logo       = coalesce(p_logo, logo),
    color      = coalesce(p_color, color),
    coach      = coalesce(p_coach, coach)
  where id = p_team;
end;
$$;

-- ---------------------------------------------------------------------------
-- Público (com token): adicionar atleta.
-- ---------------------------------------------------------------------------
create or replace function public.reg_add_player(
  p_team uuid, p_token text,
  p_name text, p_number int, p_position text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ uuid;
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;
  select championship_id into v_champ from public.teams where id = p_team;
  insert into public.players (team_id, championship_id, name, number, position)
  values (p_team, v_champ, p_name, p_number, p_position);
end;
$$;

-- ---------------------------------------------------------------------------
-- Público (com token): editar atleta (do próprio time).
-- ---------------------------------------------------------------------------
create or replace function public.reg_update_player(
  p_team uuid, p_token text, p_player uuid,
  p_name text, p_number int, p_position text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;
  update public.players set
    name = p_name, number = p_number, position = p_position
  where id = p_player and team_id = p_team;
end;
$$;

-- ---------------------------------------------------------------------------
-- Público (com token): remover atleta (do próprio time).
-- ---------------------------------------------------------------------------
create or replace function public.reg_delete_player(
  p_team uuid, p_token text, p_player uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;
  delete from public.players where id = p_player and team_id = p_team;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------------
revoke all on function public.invite_valid(uuid, text) from public, anon, authenticated;

grant execute on function public.ensure_team_invite(uuid)                              to authenticated;
grant execute on function public.team_registration(uuid, text)                         to anon, authenticated;
grant execute on function public.reg_update_team(uuid, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.reg_add_player(uuid, text, text, int, text)           to anon, authenticated;
grant execute on function public.reg_update_player(uuid, text, uuid, text, int, text)  to anon, authenticated;
grant execute on function public.reg_delete_player(uuid, text, uuid)                   to anon, authenticated;
