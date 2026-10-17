-- ===========================================================================
-- Tabelaço — mensagem de FIM DE JOGO com convite + link público
--
-- Troca a classificação, na mensagem de partida encerrada, por um convite para
-- abrir o app na página pública do campeonato — direto na CATEGORIA daquele
-- jogo. O link real é montado pela Edge Function `send-whatsapp`, que troca o
-- marcador `[[LINK]]` por `<APP_URL>/#/c/<champ>?cat=<categoria>`.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.wa_on_match_finished()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_home text; v_away text; v_gh int; v_ga int; v_pen text;
  v_win uuid; v_wname text; v_champ text; v_msg text;
begin
  if new.status <> 'finished' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_gh := coalesce(new.home_score, 0);
  v_ga := coalesce(new.away_score, 0);
  v_champ := public.wa_champ_nome(new.championship_id);

  if new.phase = 'group' then
    v_msg := format(
      E'🏆 *%s*\n🏁 *Fim de jogo* · %s\n\n⚽ %s %s x %s %s\n\nAcompanhe o desempenho da sua equipe na *%s* acessando o aplicativo:\n[[LINK]]',
      v_champ,
      public.wa_comp_linha(new.championship_id, new.category_id, new.phase, new.round),
      coalesce(v_home,'Mandante'), v_gh, v_ga, coalesce(v_away,'Visitante'),
      v_champ
    );
  else
    v_pen := case
      when new.penalty_home is not null and new.penalty_away is not null
      then format(E'\n🥅 Pênaltis: %s x %s', new.penalty_home, new.penalty_away) else '' end;
    v_win := coalesce(
      new.winner_team_id,
      case when new.penalty_home is not null and new.penalty_away is not null
                and new.penalty_home <> new.penalty_away
           then case when new.penalty_home > new.penalty_away then new.home_team_id else new.away_team_id end
           when v_gh <> v_ga
           then case when v_gh > v_ga then new.home_team_id else new.away_team_id end end);
    select name into v_wname from public.teams where id = v_win;
    v_msg := format(
      E'🏆 *%s*\n🏁 *Fim de jogo* · %s\n\n⚽ %s %s x %s %s%s%s\n\nAcompanhe o desempenho da sua equipe na *%s* acessando o aplicativo:\n[[LINK]]',
      v_champ,
      public.wa_comp_linha(new.championship_id, new.category_id, new.phase, new.round),
      coalesce(v_home,'Mandante'), v_gh, v_ga, coalesce(v_away,'Visitante'),
      v_pen,
      case when v_wname is null then ''
           when new.phase = 'final' then format(E'\n🏆 %s é campeão!', v_wname)
           else format(E'\n✅ %s avança de fase', v_wname) end,
      v_champ
    );
  end if;

  perform public.wa_enfileirar(
    new.championship_id, new.category_id,
    array[new.home_team_id, new.away_team_id]::uuid[],
    format('fim:%s', new.id), v_msg
  );
  return new;
end;
$$;

drop trigger if exists wa_on_match_finished on public.matches;
create trigger wa_on_match_finished
  after insert or update on public.matches
  for each row execute function public.wa_on_match_finished();
