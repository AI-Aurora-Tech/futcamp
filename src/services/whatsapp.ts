// ---------------------------------------------------------------------------
// WhatsApp (Evolution API) — camada de serviço.
//
//  • `flushWhatsapp`: pede à Edge Function `send-whatsapp` que entregue o
//    que está na fila `whatsapp_outbox`. É chamada logo depois das ações que
//    geram aviso (agendar, encerrar) para a entrega começar na hora — a própria
//    função respeita os 10 s entre um envio e o outro, e o agendamento termina
//    de drenar o que não coube.
//  • `cancelMatchWhatsapp`: enfileira o aviso de partida CANCELADA, chamado
//    ANTES de excluir a partida (os dados ainda precisam existir).
//
// Tudo depende do Supabase: no modo demo o recurso fica indisponível (não há
// servidor para enviar), exatamente como o push.
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'

/** Entrega o que estiver na fila deste campeonato. Falhas são silenciosas. */
export async function flushWhatsapp(championshipId: string): Promise<void> {
  if (authMode !== 'supabase' || !supabase) return
  try {
    await supabase.functions.invoke('send-whatsapp', { body: { championshipId } })
  } catch {
    /* a fila permanece pendente e sai no próximo agendamento */
  }
}

/**
 * Enfileira o aviso de "partida cancelada" e dispara a entrega. Deve ser
 * chamado ANTES de `deleteMatch`: depois de apagada, não há mais de onde tirar
 * os times e o horário. No modo demo é um no-op.
 */
export async function cancelMatchWhatsapp(matchId: string, championshipId: string): Promise<void> {
  if (authMode !== 'supabase' || !supabase) return
  try {
    const { error } = await supabase.rpc('wa_cancelar_partida', { p_match: matchId })
    if (error) {
      // Banco sem a migration 0041: não trava a exclusão da partida.
      console.warn('wa_cancelar_partida:', error.message)
      return
    }
    await flushWhatsapp(championshipId)
  } catch (err) {
    console.warn('wa_cancelar_partida:', err)
  }
}
