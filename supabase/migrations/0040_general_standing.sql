-- ===========================================================================
-- Tabelaço — grupos + mata-mata com CLASSIFICAÇÃO GERAL
--
-- Uma categoria (ou o campeonato) pode ter VÁRIOS GRUPOS e, ainda assim, uma
-- CLASSIFICAÇÃO GERAL: as equipes jogam dentro dos seus grupos, mas a tabela é
-- única (todas as equipes juntas) e a classificação ao mata-mata é pela
-- colocação GERAL (os `league_qualifiers` primeiros), e não por grupo.
--
--   • `general_standing` = true no campeonato liga o modo geral.
--   • Por categoria, a chave `generalStanding` mora no jsonb `categories`
--     (como as demais estruturas por categoria, migration 0033) — não precisa
--     de coluna própria.
--
-- Nada muda na geração das partidas (continuam por grupo) nem no avanço do
-- mata-mata: só a origem das vagas passa a ser a tabela geral, o que o app já
-- resolve montando o plano e inserindo por `ensure_knockout_stage` (0016).
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.championships
  add column if not exists general_standing boolean;

comment on column public.championships.general_standing is
  'Grupos + mata-mata com classificação geral (tabela única, colocação geral). NULL/false = por grupo.';
