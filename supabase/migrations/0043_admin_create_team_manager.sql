-- ===========================================================================
-- Tabelaço — organizador/master cadastra o responsável (gestor) do time
--
-- Até aqui, só o próprio time criava o acesso do responsável, pelo link de
-- inscrição (`create_team_account`, que exige o token). O organizador — e o
-- administrador MASTER — só conseguiam ZERAR a senha de um gestor que já
-- existia. Falta o outro lado: poder INSERIR o responsável direto pelo painel,
-- para o organizador entregar o acesso já pronto a quem não vai (ou não
-- consegue) abrir o link.
--
-- `admin_create_team_manager` preenche o próximo slot livre (até 2 gestores),
-- exatamente como o fluxo público, mas autorizando pelo dono do campeonato
-- (`owns_championship`, que já inclui o master) em vez do token do link.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.admin_create_team_manager(
  p_team uuid, p_username text, p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_champ uuid;
  v_u1    text;
  v_u2    text;
  v_user  text := lower(btrim(coalesce(p_username, '')));
begin
  select championship_id into v_champ from public.teams where id = p_team;
  if v_champ is null then
    raise exception 'Time não encontrado';
  end if;
  if not public.owns_championship(v_champ) then
    raise exception 'Não autorizado';
  end if;
  if v_user = '' then
    raise exception 'Informe o e-mail do responsável';
  end if;
  if coalesce(p_password, '') = '' then
    raise exception 'Informe a senha do responsável';
  end if;

  -- Times criados direto pelo painel (sem passar pelo link) podem ainda não
  -- ter a linha de convite — é nela que moram usuário e senha.
  insert into public.team_invites (team_id, championship_id, token)
  values (p_team, v_champ, encode(gen_random_bytes(16), 'hex'))
  on conflict (team_id) do nothing;

  select username, username2 into v_u1, v_u2
    from public.team_invites where team_id = p_team;

  if v_u1 is not null and v_u2 is not null then
    raise exception 'Este time já possui 2 gestores';
  end if;
  if v_user = lower(v_u1) or v_user = lower(v_u2) then
    raise exception 'Este e-mail já é gestor deste time';
  end if;

  if v_u1 is null then
    update public.team_invites
       set username = v_user,
           password_hash = crypt(p_password, gen_salt('bf'))
     where team_id = p_team;
  else
    update public.team_invites
       set username2 = v_user,
           password_hash2 = crypt(p_password, gen_salt('bf'))
     where team_id = p_team;
  end if;
end;
$$;

grant execute on function public.admin_create_team_manager(uuid, text, text) to authenticated;
