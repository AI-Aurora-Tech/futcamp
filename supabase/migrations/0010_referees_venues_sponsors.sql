-- ===========================================================================
-- Tabelaço — árbitros, campos e patrocinadores/parceiros
--
--  • Árbitros, campos (locais) e patrocinadores/parceiros ficam embutidos como
--    JSON no próprio campeonato (como as categorias) — evita novas tabelas.
--  • Partidas ganham `referee_id` (id do árbitro escalado, referência ao JSON
--    championships.referees).
-- ===========================================================================

alter table public.championships add column if not exists referees jsonb not null default '[]'::jsonb;
alter table public.championships add column if not exists venues   jsonb not null default '[]'::jsonb;
alter table public.championships add column if not exists sponsors jsonb not null default '[]'::jsonb;

alter table public.matches add column if not exists referee_id text;
