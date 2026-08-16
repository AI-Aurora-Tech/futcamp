// ---------------------------------------------------------------------------
// Notificações push no navegador (Web Push / VAPID).
//
// A chave pública VAPID vem de `VITE_VAPID_PUBLIC_KEY` — a mesma que a Edge
// Function `send-push` usa para assinar os envios. Sem ela (ou sem Supabase),
// o recurso fica indisponível e o app avisa em vez de quebrar.
// ---------------------------------------------------------------------------

export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

/** O navegador suporta push e o app está configurado para usá-lo? */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    VAPID_PUBLIC_KEY.length > 0
  )
}

/** Chave VAPID (base64url) → bytes, formato exigido pelo PushManager. */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return buffer
}

/** Chave da inscrição em base64url (formato aceito pelo servidor). */
function keyToBase64(sub: PushSubscription, name: 'p256dh' | 'auth'): string {
  const key = sub.getKey(name)
  if (!key) return ''
  return btoa(String.fromCharCode(...new Uint8Array(key)))
}

export interface BrowserSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Pede permissão e assina o push neste navegador. Devolve os dados que o
 * servidor precisa guardar, ou uma mensagem de erro amigável.
 */
export async function subscribeBrowser(): Promise<
  { ok: true; subscription: BrowserSubscription } | { ok: false; error: string }
> {
  if (!pushSupported()) {
    return { ok: false, error: 'Este navegador (ou esta instalação) não suporta notificações push.' }
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return {
      ok: false,
      error:
        permission === 'denied'
          ? 'As notificações estão bloqueadas para este site. Libere nas configurações do navegador.'
          : 'Permissão de notificação não concedida.',
    }
  }
  try {
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
      }))
    return {
      ok: true,
      subscription: {
        endpoint: sub.endpoint,
        p256dh: keyToBase64(sub, 'p256dh'),
        auth: keyToBase64(sub, 'auth'),
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Não foi possível ativar as notificações.',
    }
  }
}

/** Endpoint atual deste navegador (para cancelar no servidor). */
export async function currentEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub?.endpoint ?? null
  } catch {
    return null
  }
}

/** Cancela a assinatura no navegador (o servidor é avisado à parte). */
export async function unsubscribeBrowser(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch {
    /* ignore */
  }
}
