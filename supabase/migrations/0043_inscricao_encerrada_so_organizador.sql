-- ===========================================================================
-- Tabelaço — inscrições encerradas: só o organizador mexe no elenco
--
-- Até aqui a trava de inscrição (prazo antes do jogo e rodada fechada pelo
-- organizador, 0005/0007) existia só na tela do time: o botão ficava cinza,
-- mas as RPCs do portal aceitavam inscrever, editar e remover atletas com as
-- inscrições encerradas.
--
-- Agora o banco recusa. Com as inscrições encerradas, o portal do time não
-- inscreve, não edita e não remove atletas. O organizador continua podendo
-- tudo pelo painel dele — que grava direto na tabela `players` (RLS do dono)
-- e não passa por estas RPCs.
--
-- A regra é a mesma de `registrationLockForTeam` (src/lib/matchWindow.ts):
--   • partida do time ainda não finalizada numa rodada fechada (closed_rounds);
--   • ou partida do time não finalizada que começa em menos de
--     `registration_cutoff_hours` horas (0 = sem prazo).
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.assert_registration_open(p_team uuid)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cutoff int;
  v_closed jsonb;
begin
  select coalesce(c.registration_cutoff_hours, 0), coalesce(c.closed_rounds, '[]'::jsonb)
    into v_cutoff, v_closed
    from public.teams t
    join public.championships c on c.id = t.championship_id
   where t.id = p_team;

  -- 1) Rodada fechada manualmente pelo organizador.
  if jsonb_typeof(v_closed) = 'array' and exists (
    select 1
      from public.matches m
     where (m.home_team_id = p_team or m.away_team_id = p_team)
       and m.status <> 'finished'
       and exists (
         select 1 from jsonb_array_elements_text(v_closed) r
          where r ~ '^\d+$' and r::int = m.round
       )
  ) then
    raise exception 'As inscrições da próxima rodada foram encerradas pelo organizador. Só o organizador pode inscrever atletas agora.';
  end if;

  -- 2) Prazo antes do jogo.
  if v_cutoff > 0 and exists (
    select 1
      from public.matches m
     where (m.home_team_id = p_team or m.away_team_id = p_team)
       and m.status <> 'finished'
       and m.scheduled_at is not null
       and now() >= m.scheduled_at - make_interval(hours => v_cutoff)
  ) then
    raise exception 'As inscrições deste time estão encerradas para a próxima partida. Só o organizador pode inscrever atletas agora.';
  end if;
end;
$$;

revoke all on function public.assert_registration_open(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- As RPCs do portal do time passam a conferir a trava.
-- Mesmas assinaturas da 0026 (inscrever/editar) e da 0003 (remover).
-- ---------------------------------------------------------------------------
create or replace function public.reg_add_player(
  p_team uuid, p_token text,
  p_name text, p_cpf text, p_birthdate date, p_photo text,
  p_number int, p_position text, p_category text, p_role text,
  p_federated boolean default false, p_federated_in text default null
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

  perform public.assert_registration_open(p_team);
  perform public.assert_federated_allowed(p_team, p_federated, p_category, null);

  select championship_id into v_champ from public.teams where id = p_team;
  insert into public.players
    (team_id, championship_id, name, cpf, birthdate, photo, number, position, category_id, role,
     federated, federated_in)
  values
    (p_team, v_champ, p_name, p_cpf, p_birthdate, p_photo, p_number, p_position, p_category,
     coalesce(p_role, 'atleta'),
     coalesce(p_federated, false),
     case when coalesce(p_federated, false) then p_federated_in else null end);
end;
$$;

create or replace function public.reg_update_player(
  p_team uuid, p_token text, p_player uuid,
  p_name text, p_cpf text, p_birthdate date, p_photo text,
  p_number int, p_position text, p_category text, p_role text,
  p_federated boolean default false, p_federated_in text default null
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

  perform public.assert_registration_open(p_team);
  perform public.assert_federated_allowed(p_team, p_federated, p_category, p_player);

  update public.players set
    name = p_name, cpf = p_cpf, birthdate = p_birthdate, photo = p_photo,
    number = p_number, position = p_position, category_id = p_category,
    role = coalesce(p_role, 'atleta'),
    federated = coalesce(p_federated, false),
    federated_in = case when coalesce(p_federated, false) then p_federated_in else null end
  where id = p_player and team_id = p_team;
end;
$$;

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

  perform public.assert_registration_open(p_team);

  delete from public.players where id = p_player and team_id = p_team;
end;
$$;
