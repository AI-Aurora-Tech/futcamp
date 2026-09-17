// ---------------------------------------------------------------------------
// Criar uma partida manualmente.
//
// A tabela costuma nascer do "Gerar tabela", mas às vezes o organizador precisa
// de um jogo avulso: um amistoso, uma partida remarcada como nova, um confronto
// que ficou de fora. Este modal cria uma partida solta, ligada à categoria em
// foco, e reaproveita os mesmos avisos (push + WhatsApp) do agendamento.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react'
import { createMatch } from '../services/matches'
import { flushPush } from '../services/push'
import { flushWhatsapp } from '../services/evolution'
import {
  PHASE_LABELS,
  type Championship,
  type Match,
  type MatchPhase,
  type Team,
  type Venue,
} from '../types'
import { Button, Field, Modal } from './ui'

export function ManualMatchModal({
  championship,
  teams,
  matches,
  categoryId,
  onClose,
  onSaved,
}: {
  championship: Championship
  teams: Team[]
  matches: Match[]
  categoryId?: string
  onClose: () => void
  onSaved: () => void
}) {
  // Rodada sugerida: a próxima depois da última rodada da fase de grupos.
  const proximaRodada = useMemo(() => {
    const rounds = matches.filter((m) => m.phase === 'group').map((m) => m.round)
    return rounds.length ? Math.max(...rounds) + 1 : 1
  }, [matches])

  const [homeTeamId, setHomeTeamId] = useState<string>('')
  const [awayTeamId, setAwayTeamId] = useState<string>('')
  const [phase, setPhase] = useState<MatchPhase>('group')
  const [round, setRound] = useState<string>(String(proximaRodada))
  const [group, setGroup] = useState<string>('')
  const [scheduledAt, setScheduledAt] = useState<string>('')
  const [venue, setVenue] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string>('')

  const venues: Venue[] = championship.venues ?? []
  const isGroup = phase === 'group'

  async function salvar() {
    setErro('')
    if (homeTeamId && awayTeamId && homeTeamId === awayTeamId) {
      setErro('Escolha times diferentes para mandante e visitante.')
      return
    }
    setBusy(true)
    try {
      await createMatch({
        championshipId: championship.id,
        categoryId,
        round: Math.max(1, Number(round) || 1),
        phase,
        group: isGroup ? (group.trim() || undefined) : undefined,
        homeTeamId: homeTeamId || null,
        awayTeamId: awayTeamId || null,
        homeScore: null,
        awayScore: null,
        status: 'scheduled',
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        venue: venue.trim() || undefined,
      })
      // Se já nasceu com data, o aviso foi enfileirado pelo gatilho — entrega já.
      if (scheduledAt) {
        void flushPush(championship.id)
        void flushWhatsapp(championship.id)
      }
      onSaved()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar a partida.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Nova partida" onClose={onClose}>
      <div className="form-grid">
        <Field label="Mandante">
          <select value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value)}>
            <option value="">A definir</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Visitante">
          <select value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value)}>
            <option value="">A definir</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Fase">
          <select value={phase} onChange={(e) => setPhase(e.target.value as MatchPhase)}>
            {(Object.keys(PHASE_LABELS) as MatchPhase[]).map((p) => (
              <option key={p} value={p}>{PHASE_LABELS[p]}</option>
            ))}
          </select>
        </Field>

        {isGroup && (
          <Field label="Rodada">
            <input
              type="number"
              min={1}
              value={round}
              onChange={(e) => setRound(e.target.value)}
            />
          </Field>
        )}

        {isGroup && (
          <Field label="Grupo (opcional)" hint="Deixe em branco se o campeonato não usa grupos.">
            <input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Ex.: A" />
          </Field>
        )}

        <Field label="Data e hora (opcional)">
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </Field>

        <Field label="Local (opcional)">
          {venues.length ? (
            <select value={venue} onChange={(e) => setVenue(e.target.value)}>
              <option value="">A definir</option>
              {venues.map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
          ) : (
            <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Nome do local" />
          )}
        </Field>
      </div>

      {erro && <p className="auth-error">{erro}</p>}

      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="button" onClick={() => void salvar()} disabled={busy}>
          {busy ? 'Criando…' : 'Criar partida'}
        </Button>
      </div>
    </Modal>
  )
}
