-- ===========================================================================
-- 0062 — Encerrar inscrições da rodada com qualquer prazo; só o master reabre
-- ===========================================================================
-- 1. Com prazo 0 (inscrições sem trava automática), o organizador agora também
--    pode ENCERRAR as inscrições de uma rodada, e a trava vale para os times.
--    A rodada encerrada continua reabrindo para cada time quando o jogo dele
--    naquela rodada termina, como já era com prazo > 0.
--
-- 2. Rodada encerrada só é REABERTA pelo administrador master: o gatilho
--    recusa tirar uma rodada de `closed_rounds` para qualquer outra pessoa.
--
-- Organizador, co-organizador e master continuam inscrevendo a qualquer hora.
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- 1. A trava do time: rodada encerrada vale antes de olhar o prazo.
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
  v_closed jsonb;
begin
  select c.id, coalesce(c.registration_cutoff_hours, 0), coalesce(c.closed_rounds, '[]'::jsonb)
    into v_champ, v_cutoff, v_closed
    from public.teams t
    join public.championships c on c.id = t.championship_id
   where t.id = p_team;

  if v_champ is null then
    return;
  end if;

  -- Organizador, co-organizador ou master: inscreve a qualquer momento.
  if public.owns_championship(v_champ) then
    return;
  end if;

  -- 1) Rodada fechada pelo organizador, com partida do time ainda por jogar.
  --    Vale com qualquer prazo, inclusive 0.
  if jsonb_typeof(v_closed) = 'array' and exists (
    select 1
      from public.matches m
     where (m.home_team_id = p_team or m.away_team_id = p_team)
       and m.status <> 'finished'
       and exists (
         select 1 from jsonb_array_elements_text(v_closed) r
          where r ~ '^\d+$' and r::int = m.round
       )
  ) then
    raise exception 'As inscrições da próxima rodada foram encerradas pelo organizador.';
  end if;

  -- Prazo 0 = sem trava automática por proximidade do jogo.
  if v_cutoff <= 0 then
    return;
  end if;

  -- 2) Partida do time dentro do prazo (reabre quando ela termina).
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

-- 2. Só o master reabre uma rodada encerrada.
create or replace function public.protect_closed_rounds()
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
             case when jsonb_typeof(old.closed_rounds) = 'array' then old.closed_rounds else '[]'::jsonb end
           ) o
     where not exists (
       select 1
         from jsonb_array_elements_text(
                case when jsonb_typeof(new.closed_rounds) = 'array' then new.closed_rounds else '[]'::jsonb end
              ) n
        where n = o
     )
  ) then
    raise exception 'Só o administrador master pode reabrir as inscrições de uma rodada encerrada.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_closed_rounds on public.championships;
create trigger protect_closed_rounds
  before update of closed_rounds on public.championships
  for each row execute function public.protect_closed_rounds();
