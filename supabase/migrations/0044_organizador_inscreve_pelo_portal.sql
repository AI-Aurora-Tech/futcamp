-- ===========================================================================
-- Tabelaço — o organizador inscreve mesmo pelo portal do time
--
-- A 0043 travou o portal do time quando as inscrições estão encerradas. Mas o
-- organizador também costuma inscrever atletas abrindo o LINK DO TIME no
-- próprio navegador — e aí era tratado como time e recebia "inscrições
-- encerradas".
--
-- O portal não tem login próprio no Supabase: quem chama as RPCs carrega a
-- sessão de quem está logado no navegador. Se for o dono do campeonato (ou o
-- master), a trava não vale.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

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

  -- Organizador (dono do campeonato) ou master: inscreve a qualquer momento.
  if v_champ is not null and public.owns_championship(v_champ) then
    return;
  end if;

  -- 1) Rodada fechada manualmente pelo organizador.
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
    raise exception 'As inscrições da próxima rodada foram encerradas pelo organizador. Só o organizador pode inscrever atletas agora.';
  end if;

  -- 2) Prazo antes do jogo.
  if v_cutoff > 0 and exists (
    select 1
      from public.matches m
     where (m.home_team_id = p_team or m.away_team_id = p_team)
       and m.status <> 'finished'
       and m.scheduled_at is not null
       and now() >= m.scheduled_at - make_interval(hours => v_cutoff)
  ) then
    raise exception 'As inscrições deste time estão encerradas para a próxima partida. Só o organizador pode inscrever atletas agora.';
  end if;
end;
$$;

revoke all on function public.assert_registration_open(uuid) from public, anon, authenticated;
