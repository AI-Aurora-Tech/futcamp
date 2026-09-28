// ---------------------------------------------------------------------------
// Atualização em tempo real.
//
// Quem está com o campeonato aberto (página pública, painel do organizador ou
// portal do mesário) recebe placares, eventos, times e atletas novos sem
// precisar recarregar a janela.
//
//  • Supabase: Realtime (postgres_changes) nas tabelas do campeonato — ver a
//    migration 0045. Várias mudanças seguidas viram UM recarregamento.
//  • Reserva: se o Realtime cair (ou não estiver habilitado no projeto), a
//    tela ainda se atualiza sozinha a cada POLL_MS e ao voltar para a aba.
//  • Modo demo: os dados ficam no localStorage — outra aba avisa pelo evento
//    `storage`.
// ---------------------------------------------------------------------------
import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

const DEBOUNCE_MS = 700
const POLL_MS = 30_000
const TABELAS = ['matches', 'match_events', 'teams', 'players'] as const

export function useRealtimeChampionship(championshipId: string | null | undefined, onChange: () => void): void {
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    if (!championshipId) return
    let timer: number | undefined
    const disparar = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => cb.current(), DEBOUNCE_MS)
    }

    // Reserva: recarrega de tempos em tempos, só com a aba visível.
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') disparar()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') disparar()
    }
    document.addEventListener('visibilitychange', onVisible)

    // Modo demo: outra aba alterou o localStorage.
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('futcamp:data')) disparar()
    }
    window.addEventListener('storage', onStorage)

    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null
    if (supabase) {
      const filtro = `championship_id=eq.${championshipId}`
      channel = supabase.channel(`camp:${championshipId}:${Math.random().toString(36).slice(2)}`)
      for (const table of TABELAS) {
        channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: filtro }, disparar)
        channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: filtro }, disparar)
        // DELETE não aceita filtro no Realtime: confere o campeonato no registro
        // antigo (replica identity full) e ignora os de outros campeonatos.
        channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (payload) => {
          const antigo = payload.old as { championship_id?: string } | undefined
          if (!antigo?.championship_id || antigo.championship_id === championshipId) disparar()
        })
      }
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'championships', filter: `id=eq.${championshipId}` },
        disparar,
      )
      channel.subscribe()
    }

    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('storage', onStorage)
      if (channel && supabase) void supabase.removeChannel(channel)
    }
  }, [championshipId])
}
