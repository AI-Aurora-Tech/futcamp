-- ===========================================================================
-- Tabelaço — pontos corridos: nº de partidas por equipe e mata-mata escalonado
--
-- Duas configurações novas, ambas exclusivas do formato de pontos corridos e
-- guardadas no próprio campeonato:
--
--   • `league_matches_per_team` — quantas partidas cada equipe joga. Vazio =
--     todos contra todos (turno, ou turno e returno). Informado, o app gera um
--     "todos contra todos" PARCIAL: mantém as primeiras rodadas até que cada
--     equipe atinja esse número de jogos.
--
--   • `league_entries` — mata-mata escalonado: cada faixa de colocações entra
--     numa fase (as melhores nas quartas, as seguintes nas oitavas, e assim por
--     diante). Um array de `{ "from": 1, "to": 4, "phase": "quarter" }`. Vazio =
--     todos os classificados entram na mesma fase, pelo chaveamento (`bracket`).
--
-- A montagem do mata-mata continua sendo feita pelo app e inserida por
-- `ensure_knockout_stage` (0016), que aceita o plano pronto (fase, times,
-- bracket_pos) — nenhuma outra função do banco precisa mudar: o avanço
-- automático (`advance_bracket`, 0015) usa a mesma ligação bracket_pos → /2.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.championships
  add column if not exists league_matches_per_team int;

alter table public.championships
  add column if not exists league_entries jsonb;

comment on column public.championships.league_matches_per_team is
  'Pontos corridos: nº de partidas por equipe (todos contra todos parcial). NULL = completo.';

comment on column public.championships.league_entries is
  'Pontos corridos: faixas de colocação por fase de entrada no mata-mata escalonado. NULL = entrada única.';
