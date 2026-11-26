-- ===========================================================================
-- 0065 — Próxima fase e mata-mata criados POR CATEGORIA
-- ===========================================================================
-- `ensure_group_stage` e `ensure_knockout_stage` (0016) — usadas pelo portal
-- do mesário para montar a fase seguinte quando o último jogo termina — olhavam
-- o campeonato inteiro:
--   • o mata-mata de uma categoria impedia o das outras ("já existe
--     mata-mata"), e a fase de grupos de uma era conferida junto com as demais;
--   • os jogos eram criados SEM categoria, e iam parar na primeira.
--
-- Agora as duas recebem `p_category` e só enxergam (e criam) jogos daquela
-- categoria. Jogo sem categoria conta para a primeira (mesma regra do app).
--
-- A regra de "fase encerrada" (todos os confrontos possíveis jogados, não só
-- os já criados) é conferida no app antes de chamar; aqui continua a trava de
-- segurança: a fase precisa existir e estar toda encerrada.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

drop function if exists public.ensure_group_stage(uuid, int, jsonb);
drop function if exists public.ensure_knockout_stage(uuid, jsonb, int);

-- A partida é da categoria? (sem categoria = a primeira do campeonato)
create or replace function public.partida_da_categoria(p_champ uuid, p_match_cat text, p_cat text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(p_match_cat, ''), f.first) is not distinct from coalesce(nullif(p_cat, ''), f.first)
    from (
      select case when jsonb_typeof(c.categories) = 'array' then c.categories -> 0 ->> 'id' end as first
        from public.championships c
       where c.id = p_champ
    ) f;
$$;

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

  if exists (select 1 from public.matches m
              where m.championship_id = p_champ and m.phase = 'group' and m.stage = p_stage
                and public.partida_da_categoria(p_champ, m.category_id, p_category)) then
    return 0;
  end if;

  -- A fase anterior DA CATEGORIA precisa existir e estar toda encerrada.
  if not exists (select 1 from public.matches m
                  where m.championship_id = p_champ and m.phase = 'group' and m.stage = p_stage - 1
                    and public.partida_da_categoria(p_champ, m.category_id, p_category)) then
    return 0;
  end if;
  if exists (select 1 from public.matches m
              where m.championship_id = p_champ and m.phase = 'group' and m.stage = p_stage - 1
                and m.status <> 'finished'
                and public.partida_da_categoria(p_champ, m.category_id, p_category)) then
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
      (p_champ, nullif(p_category, ''),
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

  -- Já existe mata-mata NESTA categoria? Nada a fazer.
  if exists (select 1 from public.matches m
              where m.championship_id = p_champ and m.phase <> 'group'
                and public.partida_da_categoria(p_champ, m.category_id, p_category)) then
    return 0;
  end if;

  -- Todas as fases de grupos previstas precisam existir na categoria…
  if (select count(distinct m.stage) from public.matches m
       where m.championship_id = p_champ and m.phase = 'group'
         and public.partida_da_categoria(p_champ, m.category_id, p_category)) < greatest(1, coalesce(p_stages, 1)) then
    return 0;
  end if;
  -- …e estar 100% encerradas.
  if exists (select 1 from public.matches m
              where m.championship_id = p_champ and m.phase = 'group' and m.status <> 'finished'
                and public.partida_da_categoria(p_champ, m.category_id, p_category)) then
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
      (p_champ, nullif(p_category, ''),
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

grant execute on function public.ensure_group_stage(uuid, int, jsonb, text) to anon, authenticated;
grant execute on function public.ensure_knockout_stage(uuid, jsonb, int, text) to anon, authenticated;
