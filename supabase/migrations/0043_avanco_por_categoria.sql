-- Avanço do chaveamento por categoria.
--
-- `advance_bracket` (0015) localizava a partida da fase seguinte só por
-- fase + posição no chaveamento. Com várias categorias (0033) essas chaves se
-- repetem, e o vencedor de uma categoria era gravado na partida de outra:
-- o time certo sumia ("A definir") e entrava um clube de fora da categoria.
-- Agora o avanço só enxerga as partidas da MESMA categoria do jogo de origem.

create or replace function public.advance_bracket(p_champ uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  src      public.matches;
  v_next   text;
  v_win    uuid;
  v_loser  uuid;
  v_rows   int;
  v_total  int := 0;
begin
  for src in
    select * from public.matches
     where championship_id = p_champ
       and public.phase_index(phase) between 1 and 4
     order by public.phase_index(phase), coalesce(bracket_pos, 0)
  loop
    v_win := public.match_winner(src);
    continue when v_win is null;

    select phase into v_next
      from public.matches
     where championship_id = p_champ
       and category_id is not distinct from src.category_id
       and public.phase_index(phase) > public.phase_index(src.phase)
       and public.phase_index(phase) between 1 and 5
     order by public.phase_index(phase)
     limit 1;
    continue when v_next is null;

    if coalesce(src.bracket_pos, 0) % 2 = 0 then
      update public.matches
         set home_team_id = v_win
       where championship_id = p_champ
         and category_id is not distinct from src.category_id
         and phase = v_next
         and coalesce(bracket_pos, 0) = coalesce(src.bracket_pos, 0) / 2
         and status = 'scheduled'
         and home_team_id is distinct from v_win;
    else
      update public.matches
         set away_team_id = v_win
       where championship_id = p_champ
         and category_id is not distinct from src.category_id
         and phase = v_next
         and coalesce(bracket_pos, 0) = coalesce(src.bracket_pos, 0) / 2
         and status = 'scheduled'
         and away_team_id is distinct from v_win;
    end if;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
  end loop;

  -- Disputa de 3º lugar: perdedores das semifinais, dentro da mesma categoria.
  for src in
    select * from public.matches
     where championship_id = p_champ and phase = 'semi' and status = 'finished'
     order by coalesce(bracket_pos, 0)
  loop
    v_win := public.match_winner(src);
    continue when v_win is null or src.home_team_id is null or src.away_team_id is null;
    v_loser := case when v_win = src.home_team_id then src.away_team_id else src.home_team_id end;

    if coalesce(src.bracket_pos, 0) = 0 then
      update public.matches
         set home_team_id = v_loser
       where championship_id = p_champ and phase = 'third_place'
         and category_id is not distinct from src.category_id
         and status = 'scheduled' and home_team_id is distinct from v_loser;
    else
      update public.matches
         set away_team_id = v_loser
       where championship_id = p_champ and phase = 'third_place'
         and category_id is not distinct from src.category_id
         and status = 'scheduled' and away_team_id is distinct from v_loser;
    end if;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
  end loop;

  return v_total;
end;
$$;

grant execute on function public.advance_bracket(uuid) to anon, authenticated;
