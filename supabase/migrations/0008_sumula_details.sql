-- ===========================================================================
-- Tabelaço — súmula detalhada
--
--  • Eventos: substituição (quem saiu / quem entrou) e detalhe (motivo da
--    expulsão) → colunas player_in_id e detail em match_events.
--  • Partidas: relato de incidentes (atrasos, segurança, torcidas) → matches.incidents.
--  • RPCs do mesário atualizadas para gravar esses campos.
-- ===========================================================================

alter table public.match_events add column if not exists player_in_id uuid references public.players on delete set null;
alter table public.match_events add column if not exists detail text;
alter table public.matches      add column if not exists incidents text;

-- ---------------------------------------------------------------------------
-- Mesário: atualizar placar/status + relato de incidentes.
-- ---------------------------------------------------------------------------
drop function if exists public.mesa_update_match(uuid, text, text, uuid, int, int, text);
create or replace function public.mesa_update_match(
  p_champ uuid, p_username text, p_password text,
  p_match uuid, p_home int, p_away int, p_status text, p_incidents text
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
         incidents = p_incidents
   where id = p_match and championship_id = p_champ and official_id = v_id;
  if not found then raise exception 'Jogo não atribuído a você'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mesário: adicionar evento (com substituição e detalhe).
-- ---------------------------------------------------------------------------
drop function if exists public.mesa_add_event(uuid, text, text, uuid, uuid, uuid, text, int);
create or replace function public.mesa_add_event(
  p_champ uuid, p_username text, p_password text,
  p_match uuid, p_team uuid, p_player uuid, p_player_in uuid, p_type text, p_minute int, p_detail text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid; v_new uuid;
begin
  v_id := public.mesa_official_id(p_champ, p_username, p_password);
  if v_id is null then raise exception 'Credenciais inválidas'; end if;
  if not exists (select 1 from public.matches where id = p_match and official_id = v_id) then
    raise exception 'Jogo não atribuído a você';
  end if;
  insert into public.match_events (match_id, championship_id, team_id, player_id, player_in_id, type, minute, detail)
  values (p_match, p_champ, p_team, p_player, p_player_in, p_type, p_minute, p_detail)
  returning id into v_new;
  return jsonb_build_object('id', v_new);
end;
$$;

grant execute on function public.mesa_update_match(uuid, text, text, uuid, int, int, text, text)               to anon, authenticated;
grant execute on function public.mesa_add_event(uuid, text, text, uuid, uuid, uuid, uuid, text, int, text)      to anon, authenticated;
