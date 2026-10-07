-- ===========================================================================
-- Tabelaço — administrador master exclui um gestor (responsável) do time
--
--  • Só o master (is_master) remove o acesso de um gestor do time.
--  • Se o 1º gestor sai e existe um 2º, o 2º sobe para o 1º slot — o resto do
--    app trata "username preenchido" como "o time já tem conta".
--
-- Idempotente.
-- ===========================================================================

create or replace function public.delete_team_manager(p_team uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_login text := lower(trim(coalesce(p_username, '')));
begin
  if not public.is_master() then
    raise exception 'Somente o administrador master pode excluir gestores do time.';
  end if;

  update public.team_invites
     set username       = case when lower(trim(username)) = v_login then username2      else username      end,
         password_hash  = case when lower(trim(username)) = v_login then password_hash2 else password_hash end,
         username2      = null,
         password_hash2 = null
   where team_id = p_team and lower(trim(username)) = v_login;

  update public.team_invites
     set username2 = null, password_hash2 = null
   where team_id = p_team and lower(trim(username2)) = v_login;
end;
$$;

revoke all on function public.delete_team_manager(uuid, text) from public, anon;
grant execute on function public.delete_team_manager(uuid, text) to authenticated;
