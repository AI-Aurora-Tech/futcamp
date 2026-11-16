-- ===========================================================================
-- 0064 — Limite de partidas para inscrever atletas
-- ===========================================================================
-- Nova configuração do campeonato: `registration_max_matches`. Depois que o
-- time DISPUTA esse número de partidas na categoria (jogos encerrados, W.O.
-- conta), ele não inscreve mais atletas nela. Só o administrador master pode.
-- 0 = sem limite (padrão — nada muda para quem não configurar).
--
-- Vale para todos os caminhos (portal do time, painel do organizador,
-- importação). Também barra trocar nome, CPF, nascimento, categoria ou time de
-- um atleta já inscrito — senão bastaria "editar" um atleta para pôr outro no
-- lugar. Número, posição e foto continuam editáveis; remover também.
--
-- Partida sem categoria conta para a primeira categoria (mesma regra do app).
--
-- Requer a 0062. Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.championships
  add column if not exists registration_max_matches int not null default 0;

create or replace function public.limite_de_partidas_atingido(p_champ uuid, p_team uuid, p_cat text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max   int;
  v_first text;
  v_cat   text;
  v_jogos int;
begin
  select coalesce(c.registration_max_matches, 0),
         case when jsonb_typeof(c.categories) = 'array' then c.categories -> 0 ->> 'id' end
    into v_max, v_first
    from public.championships c
   where c.id = p_champ;

  if coalesce(v_max, 0) <= 0 then
    return false;
  end if;

  v_cat := coalesce(nullif(p_cat, ''), v_first);

  select count(*) into v_jogos
    from public.matches m
   where m.championship_id = p_champ
     and m.status = 'finished'
     and (m.home_team_id = p_team or m.away_team_id = p_team)
     and coalesce(m.category_id, v_first, '') is not distinct from coalesce(v_cat, '');

  return v_jogos >= v_max;
end;
$$;

create or replace function public.players_block_match_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
begin
  if public.is_master() or public.chamada_do_servidor() then
    return new;
  end if;

  -- Editar sem trocar quem é o atleta (número, posição, foto): liberado.
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name
     and new.cpf is not distinct from old.cpf
     and new.birthdate is not distinct from old.birthdate
     and new.category_id is not distinct from old.category_id
     and new.team_id is not distinct from old.team_id then
    return new;
  end if;

  if public.limite_de_partidas_atingido(new.championship_id, new.team_id, new.category_id) then
    select registration_max_matches into v_max from public.championships where id = new.championship_id;
    raise exception 'Este time já disputou % partida(s) nesta categoria: a inscrição de atletas está encerrada. Só o administrador master pode inscrever agora.', v_max
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists players_block_match_limit on public.players;
create trigger players_block_match_limit
  before insert or update on public.players
  for each row execute function public.players_block_match_limit();

-- Portal do time: igual à 0062 + `registration_max_matches`.
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
    'registration_max_matches', coalesce(c.registration_max_matches, 0),
    'closed_rounds', '[]'::jsonb,
    'closed_categories', coalesce(c.closed_categories, '[]'::jsonb),
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
