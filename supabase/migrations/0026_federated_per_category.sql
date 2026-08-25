-- ===========================================================================
-- Tabelaço — atletas federados passam a ser regra DE CATEGORIA
--
-- Na 0025 a permissão era do campeonato inteiro. Não serve: um mesmo torneio
-- de base costuma proibir federados no Sub-11 e liberar dois no Sub-15. Quem
-- define o que é "atleta federado" na prática é a categoria.
--
-- As categorias moram em `championships.categories` (jsonb), então a regra
-- viaja dentro delas — nenhuma coluna nova. As duas colunas da 0025 saem, mas
-- o valor delas é copiado para todas as categorias antes, para quem já tinha
-- configurado não perder nada.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Colunas do atleta.
--
-- Repetidas da 0025 de propósito: assim esta migration roda sozinha, mesmo em
-- um banco que pulou a anterior. Rodar as duas em ordem também funciona — o
-- `if not exists` não reclama.
-- ---------------------------------------------------------------------------
alter table public.players add column if not exists federated boolean not null default false;
alter table public.players add column if not exists federated_in text;

alter table public.players drop constraint if exists players_federated_in_check;
alter table public.players add constraint players_federated_in_check
  check (federated_in is null or federated_in in ('campo', 'futsal', 'ambos'));

create index if not exists players_federated_idx
  on public.players (team_id) where federated;

-- ---------------------------------------------------------------------------
-- 1. Leva a regra do campeonato para dentro de cada categoria.
--
-- Dentro de um bloco porque as colunas podem não existir: num banco que nunca
-- rodou a 0025 não há nada para copiar, e referenciar a coluna ausente
-- abortaria a migration no meio — deixando o banco com a função antiga
-- apontando para colunas já removidas. Foi assim que o portal do time
-- quebrou: o campeonato existe, mas `team_registration` para de responder.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'championships'
       and column_name = 'allow_federated'
  ) then
    execute $mig$
      update public.championships c
         set categories = (
           select jsonb_agg(
             cat || jsonb_build_object(
               'allowFederated', true,
               'maxFederated', to_jsonb(c.max_federated)
             )
           )
           from jsonb_array_elements(c.categories) cat
         )
       where coalesce(c.allow_federated, false)
         and jsonb_typeof(c.categories) = 'array'
         and jsonb_array_length(c.categories) > 0
    $mig$;
  end if;
end
$$;

alter table public.championships drop column if exists allow_federated;
alter table public.championships drop column if exists max_federated;

-- ---------------------------------------------------------------------------
-- 2. A regra da categoria, lida de dentro do jsonb.
-- ---------------------------------------------------------------------------
create or replace function public.category_federated_rule(p_champ uuid, p_category text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select cat
    from public.championships c,
         lateral jsonb_array_elements(coalesce(c.categories, '[]'::jsonb)) cat
   where c.id = p_champ
     and cat->>'id' = p_category
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quantos federados o time já tem NAQUELA categoria.
-- ---------------------------------------------------------------------------
create or replace function public.count_federated(
  p_team uuid,
  p_category text default null,
  p_exclude uuid default null
)
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
     and (p_category is null or category_id = p_category)
     and (p_exclude is null or id <> p_exclude);
$$;

-- A versão antiga (sem categoria) sai de cena para não ficarem duas regras.
drop function if exists public.count_federated(uuid, uuid);
drop function if exists public.assert_federated_allowed(uuid, boolean, uuid);

-- ---------------------------------------------------------------------------
-- 4. Recusa a marcação quando a CATEGORIA não permite ou já lotou.
-- ---------------------------------------------------------------------------
create or replace function public.assert_federated_allowed(
  p_team uuid,
  p_federated boolean,
  p_category text default null,
  p_exclude uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_champ uuid;
  v_rule  jsonb;
  v_max   int;
  v_have  int;
  v_nome  text;
begin
  if not coalesce(p_federated, false) then
    return;
  end if;

  select championship_id into v_champ from public.teams where id = p_team;

  if p_category is null then
    raise exception 'Escolha a categoria antes de marcar o atleta como federado.';
  end if;

  v_rule := public.category_federated_rule(v_champ, p_category);
  v_nome := coalesce(v_rule->>'name', 'esta categoria');

  if v_rule is null or not coalesce((v_rule->>'allowFederated')::boolean, false) then
    raise exception 'A categoria % não aceita atletas federados.', v_nome;
  end if;

  -- `maxFederated` ausente ou nulo = sem limite.
  if jsonb_typeof(v_rule->'maxFederated') = 'number' then
    v_max := (v_rule->>'maxFederated')::int;
    v_have := public.count_federated(p_team, p_category, p_exclude);
    if v_have >= v_max then
      raise exception 'Limite de % atleta(s) federado(s) por time na categoria % já foi atingido.',
        v_max, v_nome;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. As RPCs de inscrição passam a categoria para a conferência.
--    A assinatura não muda: `p_category` já existia.
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

-- ---------------------------------------------------------------------------
-- 6. Portal do time: a regra já viaja dentro de `categories`.
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
      'registration_cutoff_hours', c.registration_cutoff_hours
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

grant execute on function public.category_federated_rule(uuid, text) to anon, authenticated;
grant execute on function public.count_federated(uuid, text, uuid) to anon, authenticated;
grant execute on function public.assert_federated_allowed(uuid, boolean, text, uuid) to anon, authenticated;
