-- ===========================================================================
-- Tabelaço — atletas federados (campeonatos infantis)
--
-- Categoria de base costuma limitar quantos atletas federados cada time pode
-- inscrever — às vezes proíbe, às vezes libera dois ou três. A regra é do
-- campeonato; a marcação é do time.
--
-- O limite é conferido NO BANCO, dentro da RPC de inscrição. O portal do time
-- roda no navegador de quem se inscreve: validar só lá seria pedir licença
-- para burlar.
-- ===========================================================================

alter table public.championships add column if not exists allow_federated boolean not null default false;
alter table public.championships add column if not exists max_federated int;

comment on column public.championships.allow_federated is
  'O campeonato aceita atletas federados (campo/futsal)?';
comment on column public.championships.max_federated is
  'Quantos federados cada time pode inscrever. NULL = sem limite.';

alter table public.players add column if not exists federated boolean not null default false;
alter table public.players add column if not exists federated_in text;

alter table public.players drop constraint if exists players_federated_in_check;
alter table public.players add constraint players_federated_in_check
  check (federated_in is null or federated_in in ('campo', 'futsal', 'ambos'));

create index if not exists players_federated_idx
  on public.players (team_id) where federated;

-- ---------------------------------------------------------------------------
-- Quantos federados o time já tem (fora o atleta que está sendo editado).
-- ---------------------------------------------------------------------------
create or replace function public.count_federated(p_team uuid, p_exclude uuid default null)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.players
   where team_id = p_team
     and federated
     and (p_exclude is null or id <> p_exclude);
$$;

-- ---------------------------------------------------------------------------
-- Recusa a marcação quando o campeonato não permite, ou quando o time já
-- chegou no limite. Chamada pelas RPCs de inscrição.
-- ---------------------------------------------------------------------------
create or replace function public.assert_federated_allowed(
  p_team uuid,
  p_federated boolean,
  p_exclude uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_allow boolean;
  v_max   int;
  v_have  int;
begin
  if not coalesce(p_federated, false) then
    return;
  end if;

  select c.allow_federated, c.max_federated
    into v_allow, v_max
    from public.teams t
    join public.championships c on c.id = t.championship_id
   where t.id = p_team;

  if not coalesce(v_allow, false) then
    raise exception 'Este campeonato não aceita atletas federados.';
  end if;

  if v_max is not null then
    v_have := public.count_federated(p_team, p_exclude);
    if v_have >= v_max then
      raise exception 'Limite de % atleta(s) federado(s) por time já foi atingido.', v_max;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dados do portal do time: acrescenta a regra de federados (e devolve também
-- o prazo e as rodadas fechadas, que o app já esperava).
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
    'allow_federated', c.allow_federated,
    'max_federated', c.max_federated,
    'registration_cutoff_hours', c.registration_cutoff_hours,
    'closed_rounds', to_jsonb(coalesce(c.closed_rounds, '{}'::int[])),
    -- Regras do campeonato que entram no regulamento que o time baixa. É uma
    -- lista fechada: nada de dono, cobrança ou token — o time vê as regras da
    -- competição, não a administração dela.
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
      'allow_federated', c.allow_federated,
      'max_federated', c.max_federated
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
-- Inscrição de atleta com a marcação de federado.
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

  perform public.assert_federated_allowed(p_team, p_federated, null);

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

  -- Excluindo o próprio atleta da conta: reeditar um federado que já existe
  -- não pode esbarrar no limite por causa dele mesmo.
  perform public.assert_federated_allowed(p_team, p_federated, p_player);

  update public.players set
    name = p_name, cpf = p_cpf, birthdate = p_birthdate, photo = p_photo,
    number = p_number, position = p_position, category_id = p_category,
    role = coalesce(p_role, 'atleta'),
    federated = coalesce(p_federated, false),
    federated_in = case when coalesce(p_federated, false) then p_federated_in else null end
  where id = p_player and team_id = p_team;
end;
$$;

grant execute on function public.count_federated(uuid, uuid) to anon, authenticated;
grant execute on function public.assert_federated_allowed(uuid, boolean, uuid) to anon, authenticated;
grant execute on function public.reg_add_player(uuid, text, text, text, date, text, int, text, text, text, boolean, text)
  to anon, authenticated;
grant execute on function public.reg_update_player(uuid, text, uuid, text, text, date, text, int, text, text, text, boolean, text)
  to anon, authenticated;
