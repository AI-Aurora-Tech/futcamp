// ---------------------------------------------------------------------------
// WhatsApp (Evolution API) — camada de serviço.
//
// O envio de fato acontece no servidor: os gatilhos do banco enfileiram os
// avisos em `whatsapp_outbox` (jogo marcado, jogo encerrado, lembrete de
// inscrição) e a Edge Function `send-whatsapp` os entrega aos responsáveis dos
// times, via Evolution API.
//
// `flushWhatsapp` só pede a entrega imediata do que a ação acabou de enfileirar
// — do mesmo jeito que `flushPush` faz com o push. É chamada logo depois de
// marcar/remarcar um jogo e de encerrar uma partida. O lembrete de inscrição
// não passa por aqui: ele nasce do relógio, no agendamento da própria função.
//
// Tudo depende do Supabase: no modo demo o recurso fica indisponível, e a
// falha é silenciosa — o aviso permanece na fila e sai no próximo agendamento.
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'

/**
 * Pede à Edge Function `send-whatsapp` que entregue o que está na fila deste
 * campeonato. Falhas são silenciosas: a fila permanece pendente e sai no
 * próximo envio (ou no agendamento a cada 15 minutos).
 */
export async function flushWhatsapp(championshipId: string): Promise<void> {
  if (authMode !== 'supabase' || !supabase) return
  try {
    await supabase.functions.invoke('send-whatsapp', { body: { championshipId } })
  } catch {
    /* fila permanece pendente */
  }
}
