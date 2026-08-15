-- ===========================================================================
-- Tabelaço — recuperação de senha (gestor do time e mesário)
--
-- Fluxo: o ADMINISTRADOR do campeonato "zera" a senha do gestor do time ou do
-- mesário. A senha zerada vira uma string vazia ('') que nunca casa no login.
-- Quando o gestor/mesário entra com o usuário, o app detecta o estado "zerado"
-- e pede para CRIAR uma nova senha (sem exigir a senha antiga).
--
--  • Mesário: RPCs por championship + username (o username agora é um e-mail).
--  • Gestor do time: RPCs por team + token do link de inscrição.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Guarda contra senha zerada ('') no login do MESÁRIO.
-- (crypt(pw, '') lançaria erro de salt inválido — por isso o filtro <> '').
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
    and password_hash is not null and password_hash <> ''
    and password_hash = crypt(p_password, password_hash)
  limit 1;
$$;

-- Guarda contra senha zerada ('') no login do GESTOR do time.
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

  if r.password_hash is not null and r.password_hash <> ''
     and r.username = p_username
     and r.password_hash = crypt(p_password, r.password_hash) then
    return true;
  end if;
  if r.password_hash2 is not null and r.password_hash2 <> ''
     and r.username2 = p_username
     and r.password_hash2 = crypt(p_password, r.password_hash2) then
    return true;
  end if;
  return false;
end;
$$;

-- ===========================================================================
-- MESÁRIO
-- ===========================================================================

-- Administrador zera (recupera) a senha de um mesário.
create or replace function public.reset_official_password(p_official uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.officials o
    where o.id = p_official and public.owns_championship(o.championship_id)
  ) then
    raise exception 'Não autorizado';
  end if;
  update public.officials set password_hash = '' where id = p_official;
end;
$$;

-- Portal: o e-mail informado precisa criar uma nova senha? (estado zerado)
create or replace function public.mesa_needs_password(p_champ uuid, p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.officials
    where championship_id = p_champ and username = p_username
      and (password_hash is null or password_hash = '')
  );
$$;

-- Portal: define uma nova senha quando a conta está zerada (sem senha antiga).
create or replace function public.mesa_set_password(p_champ uuid, p_username text, p_new text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.officials
     set password_hash = crypt(p_new, gen_salt('bf'))
   where championship_id = p_champ and username = p_username
     and (password_hash is null or password_hash = '');
  return found;
end;
$$;

-- ===========================================================================
-- GESTOR DO TIME
-- ===========================================================================

-- Administrador: lista os gestores do time e se cada um está com senha zerada.
create or replace function public.team_managers(p_team uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare v jsonb;
begin
  if not exists (
    select 1 from public.teams t
    where t.id = p_team and public.owns_championship(t.championship_id)
  ) then
    raise exception 'Não autorizado';
  end if;
  select jsonb_build_object(
    'username',  i.username,
    'reset1',   (i.username  is not null and (i.password_hash  is null or i.password_hash  = '')),
    'username2', i.username2,
    'reset2',   (i.username2 is not null and (i.password_hash2 is null or i.password_hash2 = ''))
  ) into v
  from public.team_invites i where i.team_id = p_team;
  return coalesce(v, '{}'::jsonb);
end;
$$;

-- Administrador: zera (recupera) a senha de um gestor do time.
create or replace function public.reset_team_manager_password(p_team uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.teams t
    where t.id = p_team and public.owns_championship(t.championship_id)
  ) then
    raise exception 'Não autorizado';
  end if;
  update public.team_invites
     set password_hash  = case when username  = p_username then '' else password_hash  end,
         password_hash2 = case when username2 = p_username then '' else password_hash2 end
   where team_id = p_team;
end;
$$;

-- Inscrição: o usuário informado precisa criar uma nova senha? (estado zerado)
create or replace function public.team_needs_password(p_team uuid, p_token text, p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_invites
    where team_id = p_team and token = p_token
      and (
        (username  = p_username and (password_hash  is null or password_hash  = '')) or
        (username2 = p_username and (password_hash2 is null or password_hash2 = ''))
      )
  );
$$;

-- Inscrição: define nova senha do gestor quando a conta está zerada.
create or replace function public.team_set_password(
  p_team uuid, p_token text, p_username text, p_new text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_hash text := crypt(p_new, gen_salt('bf'));
begin
  update public.team_invites
     set password_hash  = case
           when username  = p_username and (password_hash  is null or password_hash  = '') then v_hash
           else password_hash end,
         password_hash2 = case
           when username2 = p_username and (password_hash2 is null or password_hash2 = '') then v_hash
           else password_hash2 end
   where team_id = p_team and token = p_token
     and (
       (username  = p_username and (password_hash  is null or password_hash  = '')) or
       (username2 = p_username and (password_hash2 is null or password_hash2 = ''))
     );
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.mesa_official_id(uuid, text, text) from public, anon, authenticated;

grant execute on function public.reset_official_password(uuid)                  to authenticated;
grant execute on function public.mesa_needs_password(uuid, text)               to anon, authenticated;
grant execute on function public.mesa_set_password(uuid, text, text)           to anon, authenticated;

grant execute on function public.team_managers(uuid)                           to authenticated;
grant execute on function public.reset_team_manager_password(uuid, text)       to authenticated;
grant execute on function public.team_needs_password(uuid, text, text)         to anon, authenticated;
grant execute on function public.team_set_password(uuid, text, text, text)     to anon, authenticated;
