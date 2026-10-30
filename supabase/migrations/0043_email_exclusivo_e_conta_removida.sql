-- ===========================================================================
-- Tabelaço — e-mail exclusivo por papel + conta removida perde o acesso
--
--  1. O e-mail de gestor de time NÃO pode ser o mesmo de uma conta de
--     organizador de campeonato.
--  2. Conta removida do banco (auth.users) deixa de operar na hora: o token
--     (JWT) dela continua válido até expirar, então as políticas passam a
--     conferir que o usuário ainda existe.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar a conta do gestor recusa e-mail de organizador.
-- ---------------------------------------------------------------------------
create or replace function public.create_team_account(
  p_team uuid, p_token text, p_username text, p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_username, '')));
  v_u1 text;
  v_u2 text;
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;

  if not public.email_plausivel(v_email) then
    raise exception 'Informe um e-mail válido para o gestor do time (ex.: nome@email.com).';
  end if;

  if exists (select 1 from auth.users u where lower(trim(u.email)) = v_email) then
    raise exception 'Este e-mail já está cadastrado como organizador de campeonato. Use outro e-mail para gerir o time.';
  end if;

  if length(coalesce(p_password, '')) < 4 then
    raise exception 'A senha precisa ter pelo menos 4 caracteres.';
  end if;

  select username, username2 into v_u1, v_u2
    from public.team_invites where team_id = p_team;

  if v_u1 is not null and v_u2 is not null then
    raise exception 'Este time já possui 2 gestores';
  end if;
  if lower(trim(v_u1)) = v_email or lower(trim(v_u2)) = v_email then
    raise exception 'Este e-mail já é gestor deste time';
  end if;

  if v_u1 is null then
    update public.team_invites
       set username = v_email,
           password_hash = crypt(p_password, gen_salt('bf'))
     where team_id = p_team;
  else
    update public.team_invites
       set username2 = v_email,
           password_hash2 = crypt(p_password, gen_salt('bf'))
     where team_id = p_team;
  end if;
end;
$$;

grant execute on function public.create_team_account(uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Conta removida não administra mais nada (nem o master removido).
-- ---------------------------------------------------------------------------
create or replace function public.owns_championship(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from auth.users u where u.id = auth.uid())
     and (
       public.is_master() or exists (
         select 1 from public.championships c
         where c.id = cid and c.owner_id = auth.uid()
       )
     );
$$;
