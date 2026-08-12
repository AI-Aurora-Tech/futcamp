-- ===========================================================================
-- FutCamp — encerramento manual de inscrições por rodada
--
-- O organizador pode fechar/reabrir as inscrições de uma rodada. Enquanto a
-- rodada estiver fechada (e ainda não finalizada), os times daquela rodada não
-- inscrevem atletas.
-- ===========================================================================

alter table public.championships add column if not exists closed_rounds jsonb not null default '[]'::jsonb;

-- Atualiza a leitura de inscrição para devolver as rodadas fechadas.
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
    'closed_rounds', c.closed_rounds,
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
