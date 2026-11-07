-- ===========================================================================
-- 0055 — Inscrição de atletas pelo portal do time: uma versão só de cada RPC
-- ===========================================================================
-- A 0025 criou `reg_add_player` e `reg_update_player` com dois parâmetros a
-- mais (federado), mas não removeu as versões da 0005. O banco ficou com DUAS
-- funções de mesmo nome:
--
--   reg_add_player(10 parâmetros)                — 0005
--   reg_add_player(12 parâmetros, 2 com default) — 0025/0026
--
-- Uma chamada com os 10 parâmetros antigos serve para as duas, e o Postgres
-- recusa: "function public.reg_add_player(...) is not unique" (no PostgREST,
-- "Could not choose the best candidate function"). É exatamente a chamada que
-- o app faz quando a primeira tentativa falha — então o motivo real da recusa
-- some e o gestor do time fica sem conseguir inscrever.
--
-- Removendo as antigas, a chamada com 10 parâmetros cai na versão nova (os
-- dois parâmetros de federado têm default) e nada mais fica ambíguo.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

drop function if exists public.reg_add_player(uuid, text, text, text, date, text, int, text, text, text);
drop function if exists public.reg_update_player(uuid, text, uuid, text, text, date, text, int, text, text, text);

-- O PostgREST guarda as assinaturas em cache: avisa para recarregar.
notify pgrst, 'reload schema';
