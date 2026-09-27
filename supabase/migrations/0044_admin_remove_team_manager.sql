-- ===========================================================================
-- Tabelaço — organizador/master REMOVE o responsável (gestor) do time
--
-- Complemento de 0043 (cadastro do responsável pelo painel): agora o
-- organizador — e o administrador MASTER — também pode REMOVER o acesso de um
-- gestor, esvaziando o slot dele (usuário + senha). O time volta a ter aquela
-- vaga livre, e a pessoa deixa de entrar pela página inicial.
--
-- Autorização pelo dono do campeonato (`owns_championship`, que já inclui o
-- master), como as demais operações administrativas do time.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.admin_remove_team_manager(
  p_team uuid, p_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ uuid;
  v_user  text := lower(btrim(coalesce(p_username, '')));
begin
  select championship_id into v_champ from public.teams where id = p_team;
  if v_champ is null then
    raise exception 'Time não encontrado';
  end if;
  if not public.owns_championship(v_champ) then
    raise exception 'Não autorizado';
  end if;

  update public.team_invites
     set username       = case when lower(username)  = v_user then null else username       end,
         password_hash  = case when lower(username)  = v_user then null else password_hash  end,
         username2      = case when lower(username2) = v_user then null else username2      end,
         password_hash2 = case when lower(username2) = v_user then null else password_hash2 end
   where team_id = p_team;
end;
$$;

grant execute on function public.admin_remove_team_manager(uuid, text) to authenticated;
