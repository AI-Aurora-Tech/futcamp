-- ===========================================================================
-- FutCamp — categorias, dados de atleta e acesso do time
--
--  • Campeonato: público-alvo (infantil/adulto) + categorias (JSON).
--  • Atleta: CPF e categoria.
--  • Acesso do time: usuário + senha (hash bcrypt via pgcrypto) para inscrição
--    pelo responsável, através do link de convite.
-- ===========================================================================

-- Campeonatos
alter table public.championships add column if not exists audience   text not null default 'adulto';
alter table public.championships add column if not exists categories jsonb not null default '[]'::jsonb;

-- Atletas
alter table public.players add column if not exists cpf         text;
alter table public.players add column if not exists category_id text;

-- Credenciais do responsável pelo time (na tabela de convites, fora do alcance
-- da leitura pública dos times)
alter table public.team_invites add column if not exists username      text;
alter table public.team_invites add column if not exists password_hash text;

-- ---------------------------------------------------------------------------
-- Criar acesso do time (uma única vez), validando o token do convite.
-- ---------------------------------------------------------------------------
create or replace function public.create_team_account(
  p_team uuid, p_token text, p_username text, p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;
  if exists (select 1 from public.team_invites where team_id = p_team and username is not null) then
    raise exception 'Este time já possui acesso';
  end if;
  update public.team_invites
     set username = p_username,
         password_hash = crypt(p_password, gen_salt('bf'))
   where team_id = p_team;
end;
$$;

-- ---------------------------------------------------------------------------
-- Login do responsável pelo time.
-- ---------------------------------------------------------------------------
create or replace function public.team_login(
  p_team uuid, p_token text, p_username text, p_password text
)
returns boolean
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_user text;
begin
  select username, password_hash into v_user, v_hash
    from public.team_invites where team_id = p_team and token = p_token;
  if v_hash is null then return false; end if;
  return v_user = p_username and v_hash = crypt(p_password, v_hash);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dados de inscrição (agora com público-alvo, categorias e flag de conta).
-- ---------------------------------------------------------------------------
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
-- Recria as RPCs de atleta com os novos campos (CPF, nascimento, foto, categoria).
-- ---------------------------------------------------------------------------
drop function if exists public.reg_add_player(uuid, text, text, int, text);
drop function if exists public.reg_update_player(uuid, text, uuid, text, int, text);

create or replace function public.reg_add_player(
  p_team uuid, p_token text,
  p_name text, p_cpf text, p_birthdate date, p_photo text,
  p_number int, p_position text, p_category text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_champ uuid;
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;
  select championship_id into v_champ from public.teams where id = p_team;
  insert into public.players (team_id, championship_id, name, cpf, birthdate, photo, number, position, category_id)
  values (p_team, v_champ, p_name, p_cpf, p_birthdate, p_photo, p_number, p_position, p_category);
end;
$$;

create or replace function public.reg_update_player(
  p_team uuid, p_token text, p_player uuid,
  p_name text, p_cpf text, p_birthdate date, p_photo text,
  p_number int, p_position text, p_category text
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
    name = p_name, cpf = p_cpf, birthdate = p_birthdate, photo = p_photo,
    number = p_number, position = p_position, category_id = p_category
  where id = p_player and team_id = p_team;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
grant execute on function public.create_team_account(uuid, text, text, text)                       to anon, authenticated;
grant execute on function public.team_login(uuid, text, text, text)                                 to anon, authenticated;
grant execute on function public.reg_add_player(uuid, text, text, text, date, text, int, text, text)    to anon, authenticated;
grant execute on function public.reg_update_player(uuid, text, uuid, text, text, date, text, int, text, text) to anon, authenticated;
