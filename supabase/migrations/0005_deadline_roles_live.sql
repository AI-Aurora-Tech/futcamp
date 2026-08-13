-- ===========================================================================
-- Tabelaço — prazo de inscrição, comissão técnica e ajustes de inscrição
--
--  • Campeonato: prazo de inscrição (horas antes do jogo).
--  • Atleta: papel (atleta | comissao).
--  • RPCs de inscrição recebem o papel; a de leitura passa a devolver o prazo e
--    as partidas do time (para o app calcular a trava de inscrição).
--
-- Obs.: os limites por categoria (máx. atletas/comissão) e o público-alvo já
-- ficam em championships.categories (JSON) — sem novas colunas para isso.
-- ===========================================================================

alter table public.championships add column if not exists registration_cutoff_hours int not null default 0;
alter table public.players       add column if not exists role text not null default 'atleta';

-- ---------------------------------------------------------------------------
-- Leitura da inscrição: inclui prazo e as partidas do time.
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
    'has_account', (i.username is not null),
    'players', coalesce(
      (select jsonb_agg(to_jsonb(p.*) order by p.number nulls last)
         from public.players p where p.team_id = p_team), '[]'::jsonb),
    'matches', coalesce(
      (select jsonb_agg(to_jsonb(m.*))
         from public.matches m
        where m.home_team_id = p_team or m.away_team_id = p_team), '[]'::jsonb)
  ) into v
  from public.teams t
  join public.championships c on c.id = t.championship_id
  join public.team_invites i on i.team_id = t.id
  where t.id = p_team;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recria as RPCs de atleta incluindo o papel (atleta | comissao).
-- ---------------------------------------------------------------------------
drop function if exists public.reg_add_player(uuid, text, text, text, date, text, int, text, text);
drop function if exists public.reg_update_player(uuid, text, uuid, text, text, date, text, int, text, text);

create or replace function public.reg_add_player(
  p_team uuid, p_token text,
  p_name text, p_cpf text, p_birthdate date, p_photo text,
  p_number int, p_position text, p_category text, p_role text
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
  insert into public.players (team_id, championship_id, name, cpf, birthdate, photo, number, position, category_id, role)
  values (p_team, v_champ, p_name, p_cpf, p_birthdate, p_photo, p_number, p_position, p_category, coalesce(p_role, 'atleta'));
end;
$$;

create or replace function public.reg_update_player(
  p_team uuid, p_token text, p_player uuid,
  p_name text, p_cpf text, p_birthdate date, p_photo text,
  p_number int, p_position text, p_category text, p_role text
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
  update public.players set
    name = p_name, cpf = p_cpf, birthdate = p_birthdate, photo = p_photo,
    number = p_number, position = p_position, category_id = p_category,
    role = coalesce(p_role, 'atleta')
  where id = p_player and team_id = p_team;
end;
$$;

grant execute on function public.reg_add_player(uuid, text, text, text, date, text, int, text, text, text)          to anon, authenticated;
grant execute on function public.reg_update_player(uuid, text, uuid, text, text, date, text, int, text, text, text) to anon, authenticated;
