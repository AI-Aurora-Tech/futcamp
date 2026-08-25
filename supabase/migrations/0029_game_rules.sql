-- ===========================================================================
-- Tabelaço — regras de jogo no cadastro do campeonato
--
-- O regulamento que os times baixam era montado só com o que o app já sabia:
-- formato, pontuação, idade, federados. Faltava o que de fato se discute na
-- beira do campo — tempo de jogo, banco de reservas, substituição, expulsão,
-- acúmulo de amarelo e arbitragem.
--
-- Quase tudo é POR CATEGORIA, e categoria mora em `championships.categories`
-- (jsonb): tempo de jogo, substituição, acúmulo de amarelo e arbitragem viajam
-- lá dentro, sem coluna nova. Duas regras são do campeonato inteiro e ganham
-- coluna própria:
--
--   • bench_size       — quantos reservas podem ficar no banco;
--   • send_off_policy  — expulsou: joga com um a menos ou substitui?
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.championships add column if not exists bench_size int;
alter table public.championships add column if not exists send_off_policy text;

alter table public.championships drop constraint if exists championships_send_off_policy_check;
alter table public.championships add constraint championships_send_off_policy_check
  check (send_off_policy is null or send_off_policy in ('menos_um', 'substitui'));

comment on column public.championships.bench_size is
  'Quantos atletas podem ficar no banco de reservas, uniformizados. NULL = não definido.';
comment on column public.championships.send_off_policy is
  'Expulsão: menos_um (segue com um a menos) ou substitui (pode substituir o expulso).';

-- ---------------------------------------------------------------------------
-- Portal do time: as regras novas precisam chegar junto.
--
-- O time baixa o MESMO regulamento que o organizador. Se a RPC não devolvesse
-- os campos, o documento sairia diferente para cada lado — e o que vale para
-- reclamar na mesa é o que o time tem na mão.
--
-- A lista continua fechada: nada de dono, cobrança ou token. `categories` já
-- carrega as regras por categoria, porque elas moram dentro do jsonb.
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
      'bench_size', c.bench_size,
      'send_off_policy', c.send_off_policy
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
