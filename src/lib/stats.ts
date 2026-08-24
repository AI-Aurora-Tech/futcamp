import type { EventType, MatchEvent, Player, PlayerStat, Team } from '../types'

/**
 * Agrega eventos de um tipo (gols, cartões, assistências) por jogador,
 * ordenando do maior para o menor. Gols contra não entram na artilharia.
 */
export function aggregateByPlayer(
  events: MatchEvent[],
  type: EventType,
  players: Player[],
  teams: Team[],
): PlayerStat[] {
  const playerName = new Map(players.map((p) => [p.id, p.name] as const))
  const teamName = new Map(teams.map((t) => [t.id, t.shortName || t.name] as const))
  const acc = new Map<string, PlayerStat>()

  for (const e of events) {
    if (e.type !== type) continue
    const key = e.playerId ?? `team:${e.teamId}`
    const existing = acc.get(key)
    if (existing) {
      existing.count++
    } else {
      acc.set(key, {
        playerId: e.playerId,
        teamId: e.teamId,
        name: e.playerId
          ? playerName.get(e.playerId) ?? 'Jogador'
          : teamName.get(e.teamId) ?? 'Time',
        count: 1,
      })
    }
  }

  return [...acc.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
