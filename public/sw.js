// Service worker do Tabelaço.
// Estratégia NETWORK-FIRST: sempre tenta a rede primeiro (garante que o app
// atualize sozinho, sem reinstalar) e só usa o cache como reserva offline.
// A existência deste SW é o que torna o app "instalável" (WebAPK) no Android —
// necessário para o ícone adaptativo preencher toda a área, sem moldura branca.

const CACHE = 'tabelaco-runtime-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || !req.url.startsWith('http')) return

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req)
        // Guarda uma cópia para uso offline.
        const cache = await caches.open(CACHE)
        cache.put(req, fresh.clone()).catch(() => {})
        return fresh
      } catch {
        // Sem rede: tenta o cache; para navegação, cai no app (index).
        const cached = await caches.match(req)
        if (cached) return cached
        if (req.mode === 'navigate') {
          const shell = await caches.match('/index.html')
          if (shell) return shell
        }
        throw new Error('offline')
      }
    })(),
  )
})

// ---------------------------------------------------------------------------
// Notificações push (Web Push / VAPID).
// O conteúdo vem da Edge Function `send-push`:
//   { title, body, url, tag }
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Tabelaço', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Tabelaço'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'tabelaco',
      renotify: true,
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Se o app já estiver aberto, leva a aba existente para a página do aviso.
      for (const client of all) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client && target.startsWith('#')) {
            await client.navigate(client.url.split('#')[0] + target).catch(() => {})
          }
          return
        }
      }
      await self.clients.openWindow(target.startsWith('#') ? '/' + target : target)
    })(),
  )
})
