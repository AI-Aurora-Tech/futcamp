-- ===========================================================================
-- Tabelaço — classificados (por grupo / pontos corridos) + presença/escalação
--
--  • championships.advance_per_group : nº de classificados por grupo (mata-mata).
--  • championships.league_qualifiers : nº de classificados nos pontos corridos.
--  • matches.lineup (jsonb) : atletas presentes na partida + nº da camisa do jogo.
--    Formato: [{ "playerId": "<uuid>", "number": 10 }, ...]
--    Só quem está na escalação pode receber gols/cartões.
--  • mesa_set_lineup : o mesário salva a presença dos jogos atribuídos a ele.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.championships add column if not exists advance_per_group int;
alter table public.championships add column if not exists league_qualifiers int;

alter table public.matches add column if not exists lineup jsonb;

-- ---------------------------------------------------------------------------
-- Portal do mesário: salvar a escalação (presença) de um jogo atribuído.
-- ---------------------------------------------------------------------------
create or replace function public.mesa_set_lineup(
  p_champ uuid, p_username text, p_password text, p_match uuid, p_lineup jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  v_id := public.mesa_official_id(p_champ, p_username, p_password);
  if v_id is null then raise exception 'Credenciais inválidas'; end if;
  update public.matches
     set lineup = p_lineup
   where id = p_match and championship_id = p_champ and official_id = v_id;
  if not found then raise exception 'Jogo não atribuído a você'; end if;
end;
$$;

grant execute on function public.mesa_set_lineup(uuid, text, text, uuid, jsonb) to anon, authenticated;
