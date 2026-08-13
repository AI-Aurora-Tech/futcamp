-- ===========================================================================
-- Tabelaço — 2 gestores por time + link público de CRIAÇÃO de time
--
--  • Um time pode ter até 2 gestores (usuário/senha) — segundo par de colunas
--    em team_invites.
--  • O organizador gera um link por campeonato (#/novo-time/<champId>?k=<token>)
--    para que o responsável crie o próprio time (e depois defina gestores e
--    inscreva atletas via o fluxo de inscrição já existente).
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2º gestor do time
-- ---------------------------------------------------------------------------
alter table public.team_invites add column if not exists username2      text;
alter table public.team_invites add column if not exists password_hash2 text;

-- Cria acesso do time preenchendo o próximo slot livre (até 2 gestores).
create or replace function public.create_team_account(
  p_team uuid, p_token text, p_username text, p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u1 text;
  v_u2 text;
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;

  select username, username2 into v_u1, v_u2
    from public.team_invites where team_id = p_team;

  if v_u1 is not null and v_u2 is not null then
    raise exception 'Este time já possui 2 gestores';
  end if;
  if p_username = v_u1 or p_username = v_u2 then
    raise exception 'Este usuário já existe neste time';
  end if;

  if v_u1 is null then
    update public.team_invites
       set username = p_username,
           password_hash = crypt(p_password, gen_salt('bf'))
     where team_id = p_team;
  else
    update public.team_invites
       set username2 = p_username,
           password_hash2 = crypt(p_password, gen_salt('bf'))
     where team_id = p_team;
  end if;
end;
$$;

-- Login: confere as credenciais contra qualquer um dos 2 gestores.
create or replace function public.team_login(
  p_team uuid, p_token text, p_username text, p_password text
)
returns boolean
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare r record;
begin
  select username, password_hash, username2, password_hash2 into r
    from public.team_invites where team_id = p_team and token = p_token;
  if not found then return false; end if;

  if r.password_hash is not null
     and r.username = p_username
     and r.password_hash = crypt(p_password, r.password_hash) then
    return true;
  end if;
  if r.password_hash2 is not null
     and r.username2 = p_username
     and r.password_hash2 = crypt(p_password, r.password_hash2) then
    return true;
  end if;
  return false;
end;
$$;

-- Dados de inscrição: agora inclui a lista de gestores (managers).
create or replace function public.team_registration(p_team uuid, p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare v jsonb;
begin
  if not public.invite_valid(p_team, p_token) then
    return null;
  end if;

  select jsonb_build_object(
    'team', to_jsonb(t.*),
    'championship_name', c.name,
    'championship_logo', c.logo,
    'audience', c.audience,
    'categories', c.categories,
    'has_account', (i.username is not null),
    'managers', to_jsonb(array_remove(array[i.username, i.username2], null)),
    'players', coalesce(
      (select jsonb_agg(to_jsonb(p.*) order by p.number nulls last)
         from public.players p where p.team_id = p_team),
      '[]'::jsonb)
  ) into v
  from public.teams t
  join public.championships c on c.id = t.championship_id
  join public.team_invites i on i.team_id = t.id
  where t.id = p_team;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Link público de CRIAÇÃO de time (por campeonato)
-- ---------------------------------------------------------------------------
create table if not exists public.champ_team_invites (
  championship_id uuid primary key references public.championships on delete cascade,
  token           text not null unique,
  created_at      timestamptz not null default now()
);

alter table public.champ_team_invites enable row level security;

drop policy if exists champ_team_invites_owner on public.champ_team_invites;
create policy champ_team_invites_owner on public.champ_team_invites
  for all using (public.owns_championship(championship_id))
  with check (public.owns_championship(championship_id));

-- Organizador: garante (e retorna) o token do link de criação de time.
create or replace function public.ensure_champ_team_invite(p_champ uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_token text;
begin
  if not public.owns_championship(p_champ) then
    raise exception 'Não autorizado';
  end if;
  select token into v_token from public.champ_team_invites where championship_id = p_champ;
  if v_token is null then
    v_token := encode(gen_random_bytes(16), 'hex');
    insert into public.champ_team_invites (championship_id, token)
    values (p_champ, v_token);
  end if;
  return v_token;
end;
$$;

-- Helper interno: o token de criação confere para o campeonato?
create or replace function public.champ_invite_valid(p_champ uuid, p_token text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.champ_team_invites
    where championship_id = p_champ and token = p_token
  );
$$;

-- Público (com token): cria o time e devolve {team_id, token de inscrição}.
create or replace function public.create_team_via_invite(
  p_champ uuid, p_token text,
  p_name text, p_short text, p_logo text, p_color text, p_coach text, p_group text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_team   uuid;
  v_invite text;
begin
  if not public.champ_invite_valid(p_champ, p_token) then
    raise exception 'Link de criação inválido';
  end if;
  if coalesce(nullif(btrim(p_name), ''), '') = '' then
    raise exception 'Informe o nome do time';
  end if;

  insert into public.teams (championship_id, name, short_name, logo, color, coach, "group")
  values (
    p_champ, btrim(p_name),
    nullif(p_short, ''), nullif(p_logo, ''), nullif(p_color, ''),
    nullif(p_coach, ''), nullif(p_group, '')
  )
  returning id into v_team;

  v_invite := encode(gen_random_bytes(16), 'hex');
  insert into public.team_invites (team_id, championship_id, token)
  values (v_team, p_champ, v_invite);

  return jsonb_build_object('team_id', v_team, 'token', v_invite);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.champ_invite_valid(uuid, text) from public, anon, authenticated;

grant execute on function public.create_team_account(uuid, text, text, text)  to anon, authenticated;
grant execute on function public.team_login(uuid, text, text, text)           to anon, authenticated;
grant execute on function public.team_registration(uuid, text)                to anon, authenticated;
grant execute on function public.ensure_champ_team_invite(uuid)               to authenticated;
grant execute on function public.create_team_via_invite(uuid, text, text, text, text, text, text, text) to anon, authenticated;
