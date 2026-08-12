-- ===========================================================================
-- FutCamp — quantidade de times por grupo (opcional)
--
-- No formato "grupos + mata-mata", além do número de grupos, o organizador pode
-- informar a meta de times por grupo. É usado como referência/aviso ao montar
-- os grupos (não bloqueia).
-- ===========================================================================

alter table public.championships add column if not exists teams_per_group int;
