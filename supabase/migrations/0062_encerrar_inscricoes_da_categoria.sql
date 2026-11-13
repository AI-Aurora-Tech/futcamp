-- ===========================================================================
-- 0062 — Encerrar as inscrições de uma CATEGORIA (só o master reabre)
-- ===========================================================================
-- O organizador encerra as inscrições de uma categoria inteira com um botão
-- (painel de Atletas). A partir daí, os TIMES não inscrevem, não editam e não
-- removem atletas naquela categoria — por qualquer caminho: portal do time,
-- importação, link. Organizador, co-organizador e master continuam ajustando
-- os elencos.
--
-- Só o administrador master REABRE: o gatilho `protect_closed_categories`
-- recusa tirar uma categoria de `closed_categories` para qualquer outra pessoa.
--
-- Vale com qualquer prazo de inscrição, inclusive 0. A trava automática por
-- proximidade do jogo (prazo > 0) continua como estava.
--
-- O encerramento por RODADA (`closed_rounds`) sai de cena: o botão foi
-- substituído por este, e o banco deixa de conferir rodadas encerradas
-- (rodadas marcadas antes não travam mais ninguém).
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- 1. Categorias encerradas.
alter table public.championships
  add column if not exists closed_categories jsonb not null default '[]'::jsonb;

-- 2. A categoria está encerrada? Atleta sem categoria conta para a primeira.
create or replace function public.categoria_encerrada(p_champ uuid, p_cat text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.championships c
     where c.id = p_champ
       and jsonb_typeof(c.closed_categories) = 'array'
       and c.closed_categories ? coalesce(
             nullif(p_cat, ''),
             case when jsonb_typeof(c.categories) = 'array' then c.categories -> 0 ->> 'id' end
           )
  );
$$;

-- Chamada pelo servidor (Edge Function com service role) não é time.
create or replace function public.chamada_do_servidor()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;

-- 3. Trava dos atletas: inscrever, editar e remover numa categoria encerrada.
create or replace function public.players_block_closed_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ uuid := coalesce(new.championship_id, old.championship_id);
begin
  if public.owns_championship(v_champ) or public.chamada_do_servidor() then
    return coalesce(new, old);
  end if;
  if (tg_op in ('INSERT', 'UPDATE') and public.categoria_encerrada(v_champ, new.category_id))
     or (tg_op in ('UPDATE', 'DELETE') and public.categoria_encerrada(v_champ, old.category_id)) then
    raise exception 'As inscrições desta categoria foram encerradas pelo organizador.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists players_block_closed_category on public.players;
create trigger players_block_closed_category
  before insert or update or delete on public.players
  for each row execute function public.players_block_closed_category();

-- 4. Clube novo entrando numa categoria encerrada (link de inscrição de time).
create or replace function public.team_categories_block_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.owns_championship(new.championship_id) or public.chamada_do_servidor() then
    return new;
  end if;
  if public.categoria_encerrada(new.championship_id, new.category_id) then
    raise exception 'As inscrições desta categoria foram encerradas pelo organizador.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists team_categories_block_closed on public.team_categories;
create trigger team_categories_block_closed
  before insert on public.team_categories
  for each row execute function public.team_categories_block_closed();

-- 5. Só o master reabre uma categoria encerrada.
create or replace function public.protect_closed_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_master() then
    return new;
  end if;
  if exists (
    select 1
      from jsonb_array_elements_text(
             case when jsonb_typeof(old.closed_categories) = 'array' then old.closed_categories else '[]'::jsonb end
           ) o
     where not (
       case when jsonb_typeof(new.closed_categories) = 'array' then new.closed_categories else '[]'::jsonb end
     ) ? o
  ) then
    raise exception 'Só o administrador master pode reabrir as inscrições de uma categoria encerrada.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_closed_categories on public.championships;
create trigger protect_closed_categories
  before update of closed_categories on public.championships
  for each row execute function public.protect_closed_categories();

-- 6. A trava do time por prazo: sem rodadas encerradas (o botão agora é por categoria).
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
begin
  select c.id, coalesce(c.registration_cutoff_hours, 0)
    into v_champ, v_cutoff
    from public.teams t
    join public.championships c on c.id = t.championship_id
   where t.id = p_team;

  -- Prazo 0 = sem trava automática.
  if v_champ is null or v_cutoff <= 0 then
    return;
  end if;

  -- Organizador, co-organizador ou master: inscreve a qualquer momento.
  if public.owns_championship(v_champ) then
    return;
  end if;

  -- Partida do time dentro do prazo (reabre quando ela termina).
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

-- 7. Portal do time: igual à 0057 + `closed_categories` (rodadas não travam mais).
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
