-- ===========================================================================
-- Tabelaço — fases de grupos múltiplas + classificados por grupo
--
--  1. championships.group_stages     : fases de grupos (1ª, 2ª…), cada uma com
--     seus grupos e o número de classificados DE CADA GRUPO.
--  2. championships.advance_by_group : classificados por grupo da 1ª fase
--     (espelho da 1ª entrada de group_stages, para os campos legados).
--  3. matches.stage                  : a qual fase de grupos a partida pertence.
--  4. ensure_group_stage             : cria a próxima fase de grupos com os
--     classificados da anterior (funciona também quando quem encerra o último
--     jogo é o mesário).
--  5. ensure_knockout_stage ganha `p_stages`: só monta o mata-mata quando TODAS
--     as fases de grupos já existem e terminaram.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.championships add column if not exists group_stages     jsonb;
alter table public.championships add column if not exists advance_by_group jsonb;

alter table public.matches add column if not exists stage int not null default 1;
create index if not exists matches_stage_idx on public.matches (championship_id, phase, stage);

-- ---------------------------------------------------------------------------
-- Próxima fase de grupos
-- ---------------------------------------------------------------------------

/**
 * Cria a fase de grupos `p_stage` a partir de um plano montado pelo app
 * (grupos e confrontos dos times classificados na fase anterior).
 *
 * Só executa quando a fase anterior existe e está 100% encerrada e a fase
 * `p_stage` ainda não foi criada — por isso pode ser chamada com segurança por
 * qualquer perfil. Devolve quantos jogos foram criados.
 */
create or replace function public.ensure_group_stage(
  p_champ uuid, p_stage int, p_matches jsonb
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

  -- Serializa por campeonato: duas chamadas simultâneas não criam a fase duas
  -- vezes (a segunda espera e encontra os jogos já criados).
  perform pg_advisory_xact_lock(hashtext(p_champ::text || ':stage'));

  if exists (select 1 from public.matches
              where championship_id = p_champ and phase = 'group' and stage = p_stage) then
    return 0;
  end if;

  -- A fase anterior precisa existir e estar toda encerrada.
  if not exists (select 1 from public.matches
                  where championship_id = p_champ and phase = 'group' and stage = p_stage - 1) then
    return 0;
  end if;
  if exists (select 1 from public.matches
              where championship_id = p_champ and phase = 'group' and stage = p_stage - 1
                and status <> 'finished') then
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
      (championship_id, round, phase, stage, "group", home_team_id, away_team_id, status)
    values
      (p_champ,
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

-- ---------------------------------------------------------------------------
-- Mata-mata: só depois que TODAS as fases de grupos terminarem
-- ---------------------------------------------------------------------------
drop function if exists public.ensure_knockout_stage(uuid, jsonb);

create or replace function public.ensure_knockout_stage(
  p_champ uuid, p_matches jsonb, p_stages int default 1
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

  perform pg_advisory_xact_lock(hashtext(p_champ::text));

  -- Já existe mata-mata? Nada a fazer.
  if exists (select 1 from public.matches
              where championship_id = p_champ and phase <> 'group') then
    return 0;
  end if;

  -- Todas as fases de grupos previstas precisam existir…
  if (select count(distinct stage) from public.matches
       where championship_id = p_champ and phase = 'group') < greatest(1, coalesce(p_stages, 1)) then
    return 0;
  end if;
  -- …e estar 100% encerradas.
  if not exists (select 1 from public.matches
                  where championship_id = p_champ and phase = 'group') then
    return 0;
  end if;
  if exists (select 1 from public.matches
              where championship_id = p_champ and phase = 'group' and status <> 'finished') then
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
      (championship_id, round, phase, home_team_id, away_team_id, status, bracket_pos)
    values
      (p_champ,
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

grant execute on function public.ensure_group_stage(uuid, int, jsonb) to anon, authenticated;
grant execute on function public.ensure_knockout_stage(uuid, jsonb, int) to anon, authenticated;
