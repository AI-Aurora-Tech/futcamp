-- ===========================================================================
-- Tabelaço — expulsão e classificados passam a ser regra DE CATEGORIA
--
-- Na 0029 a penalidade da expulsão era do campeonato inteiro. Não serve: cada
-- categoria é um caso — o Sub-11 costuma deixar substituir o expulso depois de
-- cumprido o tempo, e o adulto segue com um a menos. Mesma coisa para a
-- quantidade de classificados.
--
-- A FORMA DE DISPUTA continua sendo do campeonato: é a mesma para todas as
-- categorias. O que muda de uma para outra é quantas equipes avançam.
--
-- As duas regras vão para dentro de `championships.categories` (jsonb), junto
-- do tempo de jogo, das substituições e da arbitragem. `bench_size` fica onde
-- está: o banco é do campeonato.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Leva a penalidade do campeonato para dentro de cada categoria.
--
-- Dentro de um bloco porque a coluna pode não existir: num banco que pulou a
-- 0029 não há nada para copiar, e referenciar a coluna ausente abortaria a
-- migration no meio.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'championships'
       and column_name = 'send_off_policy'
  ) then
    execute $mig$
      update public.championships c
         set categories = (
           select jsonb_agg(cat || jsonb_build_object('sendOffPolicy', c.send_off_policy))
             from jsonb_array_elements(c.categories) cat
         )
       where c.send_off_policy is not null
         and jsonb_typeof(c.categories) = 'array'
         and jsonb_array_length(c.categories) > 0
    $mig$;
  end if;
end
$$;

alter table public.championships drop constraint if exists championships_send_off_policy_check;
alter table public.championships drop column if exists send_off_policy;

-- ---------------------------------------------------------------------------
-- 2. Portal do time: a penalidade sai do bloco do campeonato.
--
-- Ela continua chegando ao time — agora dentro de `categories`, que a RPC já
-- devolve inteiro. Deixar o campo antigo no payload seria manter uma segunda
-- verdade sobre a mesma regra.
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
    'closed_rounds', coalesce(c.closed_rounds, '[]'::jsonb),
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
