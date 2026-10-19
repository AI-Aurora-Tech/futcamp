-- ===========================================================================
-- Tabelaço — inscrições encerradas não reabrem
--
-- Antes: as inscrições de cada time fechavam X horas antes do jogo dele (ou
-- quando o organizador fechava a rodada) e REABRIAM quando a partida acabava.
--
-- Agora: fecham para o CAMPEONATO INTEIRO no primeiro destes eventos, e não
-- reabrem sozinhas — nem depois do jogo, nem na rodada seguinte:
--   • o organizador encerra uma rodada (closed_rounds não vazio);
--   • algum jogo começa ou termina (status live/finished);
--   • algum jogo entra no prazo (registration_cutoff_hours antes do início).
-- Só o organizador desfaz um encerramento manual, e só enquanto nenhum jogo
-- entrou no prazo. O painel do organizador continua podendo inscrever.
--
-- Encerradas, o time também não troca nome, CPF, nascimento, categoria ou
-- tipo de um atleta já inscrito (seria inscrever outra pessoa no lugar).
--
-- A mesma regra está no app (src/lib/matchWindow.ts → registrationLock).
--
-- Também corrige o portal do time: desde a 0033 `team_registration` não
-- devolvia as partidas, e a trava do portal nunca disparava no Supabase.
-- ===========================================================================

create or replace function public.registration_closed(p_champ uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (
      select 1 from public.championships c
       where c.id = p_champ
         and jsonb_typeof(c.closed_rounds) = 'array'
         and jsonb_array_length(c.closed_rounds) > 0
    )
    or exists (
      select 1 from public.matches m
        join public.championships c on c.id = m.championship_id
       where m.championship_id = p_champ
         and (
           m.status in ('live', 'finished')
           or (coalesce(c.registration_cutoff_hours, 0) > 0
               and m.scheduled_at is not null
               and now() >= m.scheduled_at - make_interval(hours => c.registration_cutoff_hours))
         )
    );
$$;

grant execute on function public.registration_closed(uuid) to anon, authenticated;

create or replace function public.assert_registration_open(p_team uuid)
returns void
language plpgsql
security definer
stable
set search_path = public
as $$
declare v_champ uuid;
begin
  select championship_id into v_champ from public.teams where id = p_team;
  if v_champ is not null and public.registration_closed(v_champ) then
    -- Mesma frase do app (REGISTRATION_CLOSED_MSG).
    raise exception 'As inscrições deste campeonato estão encerradas.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inscrição pelo link do time: recusa depois do encerramento.
-- Igual à 0026, com a checagem no começo. Assinatura não muda.
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

-- ---------------------------------------------------------------------------
-- Edição pelo link do time: depois do encerramento, trocar nome, CPF,
-- nascimento, categoria ou tipo equivale a inscrever outra pessoa no lugar —
-- é recusado. Número, posição, foto e federado continuam editáveis.
-- Igual à 0026, com a checagem no começo. Assinatura não muda.
-- Mesma regra no app: mudaIdentidade (src/lib/matchWindow.ts).
-- ---------------------------------------------------------------------------
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
declare v_champ uuid;
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;

  select championship_id into v_champ from public.teams where id = p_team;
  if public.registration_closed(v_champ) and exists (
    select 1 from public.players p
     where p.id = p_player and p.team_id = p_team
       and (
         lower(regexp_replace(trim(coalesce(p.name, '')), '\s+', ' ', 'g'))
           is distinct from lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'))
         or regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g')
           is distinct from regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')
         or p.birthdate is distinct from p_birthdate
         -- Atleta antigo sem categoria aceita a que vier (é a que a tela mostra).
         or (p.category_id is not null and p.category_id is distinct from p_category)
         or coalesce(p.role, 'atleta') is distinct from coalesce(p_role, 'atleta')
       )
  ) then
    -- Mesma frase do app (IDENTITY_LOCKED_MSG).
    raise exception 'As inscrições deste campeonato estão encerradas: não é possível trocar nome, CPF, data de nascimento, categoria ou tipo do atleta.';
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
-- Portal do time: igual à 0033 + as partidas do campeonato e o estado.
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
    'registration_closed', public.registration_closed(c.id),
    -- Todas as partidas do campeonato: o encerramento vale para todos os times.
    'matches', coalesce(
      (select jsonb_agg(to_jsonb(m.*))
         from public.matches m where m.championship_id = c.id),
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
