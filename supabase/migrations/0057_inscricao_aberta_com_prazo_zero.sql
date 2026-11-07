-- ===========================================================================
-- 0057 — Inscrição pelo time volta à regra do app (prazo 0 = sempre aberta)
-- ===========================================================================
-- Migrations de ramos que nunca entraram na main (0043–0046 de
-- `jolly-faraday` e `wonderful-ramanujan`) foram aplicadas no banco de
-- produção e deixaram nele uma trava diferente da do app:
--
--   • `registration_closed(campeonato)` dá as inscrições do CAMPEONATO INTEIRO
--     como encerradas, para sempre, assim que QUALQUER jogo começa ou termina
--     ou o organizador fecha qualquer rodada — mesmo com prazo 0;
--   • o gatilho `players_block_closed_registration` usa essa regra e recusa a
--     inscrição de quem não é organizador: "As inscrições deste campeonato
--     estão encerradas. Só o organizador pode inscrever atletas agora.";
--   • uma das versões apagou `reg_update_player` e `reg_delete_player`, que o
--     portal do time usa para editar e remover atletas.
--
-- Esta migration põe o banco na regra da main (src/lib/matchWindow.ts →
-- registrationLockForTeam), agora conferida também no servidor:
--
--   • prazo 0 → o time inscreve a qualquer momento, sem trava nenhuma;
--   • prazo > 0 → trava só o TIME, só perto da partida DELE (ou na rodada que
--     o organizador fechou), e reabre quando a partida termina;
--   • organizador, co-organizador e master inscrevem sempre.
--
-- Funciona com ou sem as migrations daqueles ramos no banco.
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Sai o gatilho que travava o campeonato inteiro.
-- ---------------------------------------------------------------------------
drop trigger if exists players_block_closed_registration on public.players;
drop function if exists public.players_block_closed_registration();

-- ---------------------------------------------------------------------------
-- 2. A trava do time — a mesma regra do app.
--    `create or replace` também substitui o invólucro que a 0046 de
--    `wonderful-ramanujan` pode ter criado; a função que ele envolvia sai em
--    seguida.
-- ---------------------------------------------------------------------------
create or replace function public.assert_registration_open(p_team uuid)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_champ  uuid;
  v_cutoff int;
  v_closed jsonb;
begin
  select c.id, coalesce(c.registration_cutoff_hours, 0), coalesce(c.closed_rounds, '[]'::jsonb)
    into v_champ, v_cutoff, v_closed
    from public.teams t
    join public.championships c on c.id = t.championship_id
   where t.id = p_team;

  -- Prazo 0 = sem prazo: inscrições abertas o tempo todo.
  if v_champ is null or v_cutoff <= 0 then
    return;
  end if;

  -- Organizador, co-organizador ou master: inscreve a qualquer momento.
  if public.owns_championship(v_champ) then
    return;
  end if;

  -- 1) Rodada fechada pelo organizador, com partida do time ainda por jogar.
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
    raise exception 'As inscrições da próxima rodada foram encerradas pelo organizador.';
  end if;

  -- 2) Partida do time dentro do prazo (reabre quando ela termina).
  if exists (
    select 1
      from public.matches m
     where (m.home_team_id = p_team or m.away_team_id = p_team)
       and m.status <> 'finished'
       and m.scheduled_at is not null
       and now() >= m.scheduled_at - make_interval(hours => v_cutoff)
  ) then
    raise exception 'As inscrições deste time estão encerradas para a próxima partida. Reabrem após o jogo.';
  end if;
end;
$$;

revoke all on function public.assert_registration_open(uuid) from public, anon, authenticated;
drop function if exists public.assert_registration_open_time(uuid);

-- `registration_closed` só existe se aqueles ramos foram aplicados. Se existir,
-- passa a respeitar o prazo 0 (quem ainda a consultar não vê "encerrado").
do $$
begin
  if to_regprocedure('public.registration_closed(uuid)') is not null then
    execute $f$
      create or replace function public.registration_closed(p_champ uuid)
      returns boolean
      language sql
      security definer
      stable
      set search_path = public
      as $b$
        select false
      $b$
    $f$;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPCs do portal do time. Mesmas assinaturas da 0026 (inscrever/editar) e
--    da 0003 (remover). Apaga antes qualquer outra versão que tenha sobrado.
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('reg_add_player', 'reg_update_player', 'reg_delete_player')
       and p.oid::regprocedure::text not in (
         'reg_add_player(uuid,text,text,text,date,text,integer,text,text,text,boolean,text)',
         'reg_update_player(uuid,text,uuid,text,text,date,text,integer,text,text,text,boolean,text)',
         'reg_delete_player(uuid,text,uuid)'
       )
  loop
    execute format('drop function if exists %s', f.assinatura);
  end loop;
end;
$$;

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
  delete from public.players where id = p_player and team_id = p_team;
end;
$$;

grant execute on function public.reg_add_player(uuid, text, text, text, date, text, int, text, text, text, boolean, text)
  to anon, authenticated;
grant execute on function public.reg_update_player(uuid, text, uuid, text, text, date, text, int, text, text, text, boolean, text)
  to anon, authenticated;
grant execute on function public.reg_delete_player(uuid, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Portal do time: igual à 0033 + as partidas DO TIME, para a tela mostrar
--    o aviso de prazo antes de o gestor tentar inscrever (a trava do app
--    nunca disparava no Supabase porque elas não vinham).
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
    'team_categories', coalesce(
      (select jsonb_agg(tc.category_id order by tc.created_at)
         from public.team_categories tc where tc.team_id = p_team),
      '[]'::jsonb),
    'registration_cutoff_hours', c.registration_cutoff_hours,
    'closed_rounds', coalesce(c.closed_rounds, '[]'::jsonb),
    'matches', coalesce(
      (select jsonb_agg(to_jsonb(m.*))
         from public.matches m
        where m.home_team_id = p_team or m.away_team_id = p_team),
      '[]'::jsonb),
    'championship', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'sport', c.sport,
      'audience', c.audience,
      'season', c.season,
      'description', c.description,
      'logo', c.logo,
      'format', c.format,
      'categories', c.categories,
      'double_round', c.double_round,
      'num_groups', c.num_groups,
      'teams_per_group', c.teams_per_group,
      'advance_per_group', c.advance_per_group,
      'league_qualifiers', c.league_qualifiers,
      'third_place', c.third_place,
      'points_win', c.points_win,
      'points_draw', c.points_draw,
      'tiebreakers', c.tiebreakers,
      'registration_cutoff_hours', c.registration_cutoff_hours,
      'bench_size', c.bench_size
    ),
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

grant execute on function public.team_registration(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
