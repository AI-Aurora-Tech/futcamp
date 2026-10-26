-- ===========================================================================
-- Tabelaço — inscrições do campeonato, login do mesário pela página inicial e
-- fases (grupos / mata-mata) separadas por categoria
--
--  1. championships.registrations_closed: o organizador fecha (e reabre) as
--     inscrições do CAMPEONATO INTEIRO — não mais rodada a rodada. Fechadas,
--     só o administrador master inscreve atletas. Um gatilho em `players`
--     garante isso no banco: nem o organizador (painel), nem o time (RPC do
--     portal) passam.
--  2. team_registration devolve `registrations_closed` ao portal do time.
--  3. mesa_login_email: o mesário entra pela página inicial só com e-mail e
--     senha — devolve os campeonatos em que ele é mesário.
--  4. ensure_group_stage / ensure_knockout_stage / advance_bracket ganham
--     `p_category`: cada categoria é uma competição, e a fase seguinte do
--     Sub-11 não pode esperar (nem se misturar com) a do Sub-15. Sem
--     `p_category`, valem para o campeonato inteiro, como antes.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Inscrições do campeonato
-- ---------------------------------------------------------------------------
alter table public.championships
  add column if not exists registrations_closed boolean not null default false;

comment on column public.championships.registrations_closed is
  'Inscrições do campeonato inteiro encerradas pelo organizador. Fechadas, só o administrador master inscreve.';

/**
 * Barra a inscrição de atleta com as inscrições do campeonato fechadas.
 *
 *  • INSERT: só o master.
 *  • UPDATE: trocar o atleta "por baixo" (outro CPF, outra data de
 *    nascimento, outra categoria ou outro time) também é inscrever — só o
 *    master. Corrigir nome, número, foto ou posição continua livre.
 *
 * Conexão direta ao banco (painel do Supabase, service role) não tem JWT de
 * usuário e passa — é manutenção, não inscrição.
 */
create or replace function public.players_registrations_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed boolean;
  v_role   text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_role = '' or v_role = 'service_role' then
    return new;
  end if;

  select coalesce(registrations_closed, false) into v_closed
    from public.championships where id = new.championship_id;
  if not coalesce(v_closed, false) then
    return new;
  end if;
  if public.is_master() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'As inscrições do campeonato estão encerradas. Só o administrador master pode inscrever atletas.';
  end if;

  if new.team_id is distinct from old.team_id
     or new.category_id is distinct from old.category_id
     or new.cpf is distinct from old.cpf
     or new.birthdate is distinct from old.birthdate then
    raise exception 'As inscrições do campeonato estão encerradas. Só o administrador master pode trocar o atleta inscrito.';
  end if;

  return new;
end;
$$;

drop trigger if exists players_registrations_closed on public.players;
create trigger players_registrations_closed
  before insert or update on public.players
  for each row execute function public.players_registrations_closed();

-- ---------------------------------------------------------------------------
-- 2. Portal do time: a situação das inscrições viaja junto.
--    (mesmo corpo da 0033, com `registrations_closed`)
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
    -- Em quais categorias este clube está inscrito. Vazio = todas (campeonato
    -- convertido, ou inscrição que o organizador ainda não fez).
    'team_categories', coalesce(
      (select jsonb_agg(tc.category_id order by tc.created_at)
         from public.team_categories tc where tc.team_id = p_team),
      '[]'::jsonb),
    'registration_cutoff_hours', c.registration_cutoff_hours,
    'closed_rounds', coalesce(c.closed_rounds, '[]'::jsonb),
    -- Inscrições do campeonato inteiro fechadas pelo organizador (0043).
    'registrations_closed', coalesce(c.registrations_closed, false),
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

-- ---------------------------------------------------------------------------
-- 3. Login do mesário pela página inicial (só e-mail e senha).
--
-- Como em `team_login_email` (0028): quando nada casa, devolve a lista vazia,
-- sem dizer se o e-mail existe ou se a senha errou. Devolve o `username` como
-- está gravado — é ele que as RPCs do portal (`mesa_*`) conferem.
-- ---------------------------------------------------------------------------
create or replace function public.mesa_login_email(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v jsonb;
begin
  if v_email = '' or coalesce(p_password, '') = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(x order by x->>'championship_name'), '[]'::jsonb)
    into v
  from (
    select jsonb_build_object(
             'official_id', o.id,
             'name', o.name,
             'username', o.username,
             'championship_id', c.id,
             'championship_name', c.name,
             'championship_logo', c.logo
           ) as x
      from public.officials o
      join public.championships c on c.id = o.championship_id
     where o.password_hash is not null and o.password_hash <> ''
       and lower(trim(o.username)) = v_email
       and o.password_hash = crypt(p_password, o.password_hash)
  ) s;

  return v;
end;
$$;

grant execute on function public.mesa_login_email(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Fases por categoria
--
-- A categoria da partida mora em `matches.category_id`; partida sem categoria
-- pertence à PRIMEIRA (`categories->0->>'id'`), como no app.
-- ---------------------------------------------------------------------------
create or replace function public.match_in_category(p_match_category text, p_champ uuid, p_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_category is null
      or coalesce(p_match_category,
                  (select c.categories -> 0 ->> 'id' from public.championships c where c.id = p_champ))
         = p_category;
$$;

grant execute on function public.match_in_category(text, uuid, text) to anon, authenticated;

-- As assinaturas antigas saem: com um parâmetro opcional a mais, a chamada
-- antiga (sem p_category) ficaria ambígua entre as duas versões.
drop function if exists public.ensure_group_stage(uuid, int, jsonb);
drop function if exists public.ensure_knockout_stage(uuid, jsonb, int);
drop function if exists public.advance_bracket(uuid);

create or replace function public.ensure_group_stage(
  p_champ uuid, p_stage int, p_matches jsonb, p_category text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       jsonb;
  v_home  uuid;
  v_away  uuid;
  v_count int := 0;
begin
  if p_stage is null or p_stage < 2 then return 0; end if;
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then return 0; end if;
  if jsonb_array_length(p_matches) = 0 or jsonb_array_length(p_matches) > 512 then return 0; end if;

  perform pg_advisory_xact_lock(hashtext(p_champ::text || ':stage:' || coalesce(p_category, '')));

  if exists (select 1 from public.matches
              where championship_id = p_champ and phase = 'group' and stage = p_stage
                and public.match_in_category(category_id, p_champ, p_category)) then
    return 0;
  end if;

  -- A fase anterior (desta categoria) precisa existir e estar toda encerrada.
  if not exists (select 1 from public.matches
                  where championship_id = p_champ and phase = 'group' and stage = p_stage - 1
                    and public.match_in_category(category_id, p_champ, p_category)) then
    return 0;
  end if;
  if exists (select 1 from public.matches
              where championship_id = p_champ and phase = 'group' and stage = p_stage - 1
                and status <> 'finished'
                and public.match_in_category(category_id, p_champ, p_category)) then
    return 0;
  end if;

  for r in select * from jsonb_array_elements(p_matches) loop
    v_home := nullif(r ->> 'home_team_id', '')::uuid;
    v_away := nullif(r ->> 'away_team_id', '')::uuid;
    if v_home is null or v_away is null then continue; end if;

    if not exists (select 1 from public.teams where id = v_home and championship_id = p_champ)
       or not exists (select 1 from public.teams where id = v_away and championship_id = p_champ) then
      raise exception 'Time fora do campeonato';
    end if;

    insert into public.matches
      (championship_id, category_id, round, phase, stage, "group", home_team_id, away_team_id, status)
    values
      (p_champ,
       p_category,
       coalesce((r ->> 'round')::int, 1),
       'group',
       p_stage,
       nullif(r ->> 'group', ''),
       v_home,
       v_away,
       'scheduled');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.ensure_knockout_stage(
  p_champ uuid, p_matches jsonb, p_stages int default 1, p_category text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r        jsonb;
  v_home   uuid;
  v_away   uuid;
  v_phase  text;
  v_count  int := 0;
begin
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then return 0; end if;
  if jsonb_array_length(p_matches) = 0 or jsonb_array_length(p_matches) > 128 then return 0; end if;

  perform pg_advisory_xact_lock(hashtext(p_champ::text || ':ko:' || coalesce(p_category, '')));

  -- Já existe mata-mata nesta categoria? Nada a fazer.
  if exists (select 1 from public.matches
              where championship_id = p_champ and phase <> 'group'
                and public.match_in_category(category_id, p_champ, p_category)) then
    return 0;
  end if;

  -- Todas as fases de grupos previstas (desta categoria) precisam existir…
  if (select count(distinct stage) from public.matches
       where championship_id = p_champ and phase = 'group'
         and public.match_in_category(category_id, p_champ, p_category))
     < greatest(1, coalesce(p_stages, 1)) then
    return 0;
  end if;
  -- …e estar 100% encerradas.
  if exists (select 1 from public.matches
              where championship_id = p_champ and phase = 'group' and status <> 'finished'
                and public.match_in_category(category_id, p_champ, p_category)) then
    return 0;
  end if;

  for r in select * from jsonb_array_elements(p_matches) loop
    v_phase := r ->> 'phase';
    if public.phase_index(v_phase) = 0 and v_phase <> 'third_place' then
      raise exception 'Fase inválida: %', v_phase;
    end if;

    v_home := nullif(r ->> 'home_team_id', '')::uuid;
    v_away := nullif(r ->> 'away_team_id', '')::uuid;

    if v_home is not null and not exists (
      select 1 from public.teams where id = v_home and championship_id = p_champ
    ) then
      raise exception 'Time fora do campeonato';
    end if;
    if v_away is not null and not exists (
      select 1 from public.teams where id = v_away and championship_id = p_champ
    ) then
      raise exception 'Time fora do campeonato';
    end if;

    insert into public.matches
      (championship_id, category_id, round, phase, home_team_id, away_team_id, status, bracket_pos)
    values
      (p_champ,
       p_category,
       coalesce((r ->> 'round')::int, 100),
       v_phase,
       v_home,
       v_away,
       'scheduled',
       coalesce((r ->> 'bracket_pos')::int, 0));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

/**
 * Leva os classificados para a fase seguinte do chaveamento (e os perdedores
 * das semifinais para a disputa de 3º lugar) — só dentro da categoria. Sem
 * `p_category`, percorre cada categoria do campeonato separadamente, para o
 * chaveamento de uma nunca alimentar o da outra.
 */
create or replace function public.advance_bracket(p_champ uuid, p_category text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  src      public.matches;
  v_cat    text;
  v_cats   text[];
  v_next   text;
  v_win    uuid;
  v_loser  uuid;
  v_rows   int;
  v_total  int := 0;
begin
  if p_category is not null then
    v_cats := array[p_category];
  else
    -- Todas as categorias com partidas (sem categoria = a primeira).
    select coalesce(array_agg(distinct coalesce(m.category_id, c.categories -> 0 ->> 'id')), array[]::text[])
      into v_cats
      from public.matches m
      join public.championships c on c.id = m.championship_id
     where m.championship_id = p_champ;
    -- Campeonato sem categorias cadastradas: um chaveamento só.
    if v_cats is null or array_length(v_cats, 1) is null or v_cats = array[null::text] then
      v_cats := array[null::text];
    end if;
  end if;

  foreach v_cat in array v_cats loop
    for src in
      select * from public.matches
       where championship_id = p_champ
         and public.phase_index(phase) between 1 and 4
         and (v_cat is null or public.match_in_category(category_id, p_champ, v_cat))
       order by public.phase_index(phase), coalesce(bracket_pos, 0)
    loop
      v_win := public.match_winner(src);
      continue when v_win is null;

      select phase into v_next
        from public.matches
       where championship_id = p_champ
         and public.phase_index(phase) > public.phase_index(src.phase)
         and public.phase_index(phase) between 1 and 5
         and (v_cat is null or public.match_in_category(category_id, p_champ, v_cat))
       order by public.phase_index(phase)
       limit 1;
      continue when v_next is null;

      if coalesce(src.bracket_pos, 0) % 2 = 0 then
        update public.matches
           set home_team_id = v_win
         where championship_id = p_champ
           and phase = v_next
           and (v_cat is null or public.match_in_category(category_id, p_champ, v_cat))
           and coalesce(bracket_pos, 0) = coalesce(src.bracket_pos, 0) / 2
           and status = 'scheduled'
           and home_team_id is distinct from v_win;
      else
        update public.matches
           set away_team_id = v_win
         where championship_id = p_champ
           and phase = v_next
           and (v_cat is null or public.match_in_category(category_id, p_champ, v_cat))
           and coalesce(bracket_pos, 0) = coalesce(src.bracket_pos, 0) / 2
           and status = 'scheduled'
           and away_team_id is distinct from v_win;
      end if;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    end loop;

    -- Disputa de 3º lugar: perdedores das semifinais.
    for src in
      select * from public.matches
       where championship_id = p_champ and phase = 'semi' and status = 'finished'
         and (v_cat is null or public.match_in_category(category_id, p_champ, v_cat))
       order by coalesce(bracket_pos, 0)
    loop
      v_win := public.match_winner(src);
      continue when v_win is null or src.home_team_id is null or src.away_team_id is null;
      v_loser := case when v_win = src.home_team_id then src.away_team_id else src.home_team_id end;

      if coalesce(src.bracket_pos, 0) = 0 then
        update public.matches
           set home_team_id = v_loser
         where championship_id = p_champ and phase = 'third_place'
           and (v_cat is null or public.match_in_category(category_id, p_champ, v_cat))
           and status = 'scheduled' and home_team_id is distinct from v_loser;
      else
        update public.matches
           set away_team_id = v_loser
         where championship_id = p_champ and phase = 'third_place'
           and (v_cat is null or public.match_in_category(category_id, p_champ, v_cat))
           and status = 'scheduled' and away_team_id is distinct from v_loser;
      end if;
      get diagnostics v_rows = row_count;
      v_total := v_total + v_rows;
    end loop;
  end loop;

  return v_total;
end;
$$;

grant execute on function public.ensure_group_stage(uuid, int, jsonb, text)    to anon, authenticated;
grant execute on function public.ensure_knockout_stage(uuid, jsonb, int, text) to anon, authenticated;
grant execute on function public.advance_bracket(uuid, text)                   to anon, authenticated;
