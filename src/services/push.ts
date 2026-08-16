// ---------------------------------------------------------------------------
// Notificações push — camada de serviço.
//
//  • `enablePush` / `disablePush`: registram (ou removem) este navegador para
//    os avisos do campeonato, via RPCs que validam quem está pedindo.
//  • `flushPush`: pede à Edge Function `send-push` que entregue o que está na
//    fila. É chamada logo depois das ações que geram aviso (gol, alteração de
//    elenco) para a entrega ser imediata.
//
// Tudo depende do Supabase: no modo demo o recurso fica indisponível.
// ---------------------------------------------------------------------------
import { authMode } from './auth'
import { supabase } from '../lib/supabase'
import {
  currentEndpoint,
  pushSupported,
  subscribeBrowser,
  unsubscribeBrowser,
} from '../lib/push'

export type PushRole = 'organizer' | 'team'

export interface PushResult {
  ok: boolean
  error?: string
}

/** O recurso está disponível (navegador compatível + backend configurado)? */
export function pushAvailable(): boolean {
  return authMode === 'supabase' && !!supabase && pushSupported()
}

/** Este navegador já está inscrito? (checagem local, sem ir ao servidor) */
export async function pushEnabledHere(): Promise<boolean> {
  if (!pushAvailable()) return false
  return (await currentEndpoint()) != null && Notification.permission === 'granted'
}

/**
 * Liga os avisos deste navegador.
 * @param token  Token do link de inscrição — obrigatório para o responsável do time.
 */
export async function enablePush(params: {
  championshipId: string
  role: PushRole
  teamId?: string
  token?: string
}): Promise<PushResult> {
  if (!pushAvailable()) {
    return {
      ok: false,
      error: 'Notificações push exigem o app conectado ao Supabase e um navegador compatível.',
    }
  }
  const sub = await subscribeBrowser()
  if (!sub.ok) return { ok: false, error: sub.error }

  const { error } = await supabase!.rpc('push_subscribe', {
    p_championship: params.championshipId,
    p_role: params.role,
    p_team: params.teamId ?? null,
    p_token: params.token ?? null,
    p_endpoint: sub.subscription.endpoint,
    p_p256dh: sub.subscription.p256dh,
    p_auth: sub.subscription.auth,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Desliga os avisos deste navegador neste campeonato. */
export async function disablePush(championshipId: string): Promise<PushResult> {
  if (!pushAvailable()) return { ok: true }
  const endpoint = await currentEndpoint()
  if (endpoint) {
    const { error } = await supabase!.rpc('push_unsubscribe', {
      p_championship: championshipId,
      p_endpoint: endpoint,
    })
    if (error) return { ok: false, error: error.message }
  }
  await unsubscribeBrowser()
  return { ok: true }
}

/**
 * Entrega o que estiver na fila deste campeonato. Falhas são silenciosas: o
 * aviso continua na fila e sai no próximo envio (ou no agendamento).
 */
export async function flushPush(championshipId: string): Promise<void> {
  if (authMode !== 'supabase' || !supabase) return
  try {
    await supabase.functions.invoke('send-push', { body: { championshipId } })
  } catch {
    /* fila permanece pendente */
  }
}
