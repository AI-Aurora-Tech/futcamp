-- ===========================================================================
-- Tabelaço — disputa por pênaltis no mata-mata
--
--  • matches.penalty_home / penalty_away guardam as cobranças convertidas.
--  • match_winner passa a considerar os pênaltis: quem vence nas cobranças
--    avança no chaveamento (advance_bracket usa a mesma função).
--  • O mesário também lança os pênaltis pela RPC.
--
-- Ordem de decisão: winner_team_id (manual) > pênaltis > placar normal.
-- ===========================================================================

alter table public.matches add column if not exists penalty_home int;
alter table public.matches add column if not exists penalty_away int;

-- ---------------------------------------------------------------------------
-- Vencedor da partida, agora com pênaltis.
-- ---------------------------------------------------------------------------
create or replace function public.match_winner(m public.matches)
returns uuid
language sql
stable
as $$
  select case
    when m.winner_team_id is not null then m.winner_team_id
    when m.home_team_id is not null and m.away_team_id is null then m.home_team_id
    when m.away_team_id is not null and m.home_team_id is null then m.away_team_id
    when m.status = 'finished'
     and m.penalty_home is not null and m.penalty_away is not null
     and m.penalty_home > m.penalty_away then m.home_team_id
    when m.status = 'finished'
     and m.penalty_home is not null and m.penalty_away is not null
     and m.penalty_home < m.penalty_away then m.away_team_id
    when m.status = 'finished'
     and m.home_score is not null and m.away_score is not null
     and m.home_score > m.away_score then m.home_team_id
    when m.status = 'finished'
     and m.home_score is not null and m.away_score is not null
     and m.home_score < m.away_score then m.away_team_id
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Mesário: placar/status/incidentes + pênaltis.
--
-- A versão antiga precisa ser removida antes: com os dois novos parâmetros
-- tendo default, as duas assinaturas ficariam ambíguas na mesma chamada.
-- ---------------------------------------------------------------------------
drop function if exists public.mesa_update_match(uuid, text, text, uuid, int, int, text, text);
create or replace function public.mesa_update_match(
  p_champ uuid, p_username text, p_password text,
  p_match uuid, p_home int, p_away int, p_status text, p_incidents text,
  p_pen_home int default null, p_pen_away int default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  v_id := public.mesa_official_id(p_champ, p_username, p_password);
  if v_id is null then raise exception 'Credenciais inválidas'; end if;
  update public.matches
     set home_score = p_home,
         away_score = p_away,
         status = coalesce(p_status, status),
         incidents = p_incidents,
         penalty_home = p_pen_home,
         penalty_away = p_pen_away
   where id = p_match and championship_id = p_champ and official_id = v_id;
  if not found then raise exception 'Jogo não atribuído a você'; end if;
end;
$$;

grant execute on function public.mesa_update_match(uuid, text, text, uuid, int, int, text, text, int, int)
  to anon, authenticated;
