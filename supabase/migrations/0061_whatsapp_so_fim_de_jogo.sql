-- ===========================================================================
-- 0061 — WhatsApp aos times só no fim da partida
-- ===========================================================================
-- Os donos dos times passam a receber mensagem apenas quando a partida
-- TERMINA (resultado — `wa_on_match_finished`, que segue como está).
--
-- Deixam de sair:
--   • "📅 Partida marcada" e "🔄 Partida remarcada" (gatilho
--     `wa_on_match_scheduled`, criado na 0041 e refeito na 0044);
--   • "❌ Partida cancelada" (`wa_cancelar_partida`, que o app chama antes de
--     excluir a partida — vira uma função que não faz nada, para o app
--     continuar chamando sem erro).
--
-- Avisos de marcar/remarcar/cancelar que ainda estavam na fila, sem envio,
-- saem dela para não serem entregues depois.
--
-- O lembrete de prazo de inscrição (0056) e as notificações push não mudam.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

drop trigger if exists wa_on_match_scheduled on public.matches;
drop function if exists public.wa_on_match_scheduled();

create or replace function public.wa_cancelar_partida(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Cancelar partida não avisa mais os times por WhatsApp (0061).
  return;
end;
$$;

grant execute on function public.wa_cancelar_partida(uuid) to anon, authenticated;

delete from public.whatsapp_outbox
 where sent_at is null
   and (dedupe_key like 'jogo:%' or dedupe_key like 'cancel:%');
