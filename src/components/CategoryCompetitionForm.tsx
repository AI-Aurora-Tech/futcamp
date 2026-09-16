import { useMemo, useState } from 'react'
import {
  DEFAULT_TIEBREAKERS,
  FORMAT_LABELS,
  TIEBREAKER_LABELS,
  type Category,
  type Championship,
  type ChampionshipFormat,
  type TiebreakerId,
} from '../types'
import { Button, Field, Modal } from './ui'
import { updateChampionship } from '../services/championships'
import { stageGroupLetters } from '../lib/groupStages'

/**
 * Editor da DISPUTA de UMA categoria — cada categoria é um campeonato dentro do
 * campeonato, com o seu próprio formato e as suas regras de classificação.
 *
 * Grava só os campos daquela categoria (dentro do jsonb `categories`). O que
 * a categoria não define aqui herda o do campeonato. O chaveamento do mata-mata
 * é semeado automaticamente (1º × último colocado); confrontos manuais e a
 * entrada escalonada continuam em "Editar informações".
 */
export function CategoryCompetitionForm({
  champ,
  categoryId,
  onClose,
  onSaved,
}: {
  champ: Championship
  categoryId: string
  onClose: () => void
  onSaved: () => void
}) {
  const cat = champ.categories.find((c) => c.id === categoryId)
  const nome = cat?.name ?? 'categoria'

  // '' = herda o formato do campeonato.
  const [format, setFormat] = useState<'' | ChampionshipFormat>(cat?.format ?? '')
  const [doubleRound, setDoubleRound] = useState<boolean>(cat?.doubleRound ?? champ.doubleRound ?? false)
  const [pointsWin, setPointsWin] = useState<string>(cat?.pointsWin != null ? String(cat.pointsWin) : '')
  const [pointsDraw, setPointsDraw] = useState<string>(cat?.pointsDraw != null ? String(cat.pointsDraw) : '')
  const [ownTiebreakers, setOwnTiebreakers] = useState<boolean>(Boolean(cat?.tiebreakers?.length))
  const [tiebreakers, setTiebreakers] = useState<TiebreakerId[]>(
    cat?.tiebreakers?.length ? cat.tiebreakers : champ.tiebreakers?.length ? champ.tiebreakers : DEFAULT_TIEBREAKERS,
  )

  const [numGroups, setNumGroups] = useState<string>(cat?.numGroups != null ? String(cat.numGroups) : '')
  const [teamsPerGroup, setTeamsPerGroup] = useState<string>(cat?.teamsPerGroup != null ? String(cat.teamsPerGroup) : '')
  const [generalStanding, setGeneralStanding] = useState<boolean>(Boolean(cat?.generalStanding))
  const [byGroup, setByGroup] = useState<Record<string, string>>(() => {
    const src = cat?.advanceByGroup ?? {}
    const out: Record<string, string> = {}
    for (const [g, n] of Object.entries(src)) out[g] = String(n)
    return out
  })
  const advancePerGroup = cat?.advancePerGroup != null ? String(cat.advancePerGroup) : '2'
  // Liga / classificação geral: quantos se classificam ao mata-mata.
  const [qualifiers, setQualifiers] = useState<string>(
    cat?.leagueQualifiers != null ? String(cat.leagueQualifiers) : cat?.qualifiers != null ? String(cat.qualifiers) : '',
  )
  const [matchesPerTeam, setMatchesPerTeam] = useState<string>(
    cat?.leagueMatchesPerTeam != null ? String(cat.leagueMatchesPerTeam) : '',
  )
  const [thirdPlace, setThirdPlace] = useState<boolean>(cat?.thirdPlace ?? champ.thirdPlace ?? false)
  const [autoKnockout, setAutoKnockout] = useState<boolean>(cat?.autoKnockout ?? champ.autoKnockout ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Formato EFETIVO (o próprio ou o do campeonato) — decide quais campos mostrar.
  const fmt: ChampionshipFormat = format || champ.format
  const isGroups = fmt === 'groups_knockout'
  const isLeague = fmt === 'league'
  const isKnockout = fmt === 'knockout'
  const letters = useMemo(() => stageGroupLetters(Number(numGroups) || 2), [numGroups])

  function moveTiebreaker(id: TiebreakerId, dir: -1 | 1) {
    setTiebreakers((prev) => {
      const i = prev.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function toggleTiebreaker(id: TiebreakerId) {
    setTiebreakers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  function setGroupQuota(g: string, v: string) {
    setByGroup((prev) => {
      const next = { ...prev }
      if (v === '') delete next[g]
      else next[g] = v
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const q = qualifiers ? Math.max(1, Number(qualifiers)) : undefined
    const catGeneral = isGroups && generalStanding
    // Monta o patch da categoria. Campos irrelevantes ao formato viram
    // `undefined` de propósito — trocar o formato não pode deixar sobra do
    // formato anterior atrapalhando a montagem.
    const advBy = isGroups && !catGeneral
      ? Object.fromEntries(
          Object.entries(byGroup)
            .filter(([, v]) => v !== '')
            .map(([g, v]) => [g, Math.max(0, Number(v))]),
        )
      : undefined
    const patch: Partial<Category> = {
      format: format || undefined,
      doubleRound: isKnockout ? undefined : doubleRound,
      pointsWin: !isKnockout && pointsWin ? Math.max(0, Number(pointsWin)) : undefined,
      pointsDraw: !isKnockout && pointsDraw ? Math.max(0, Number(pointsDraw)) : undefined,
      tiebreakers: !isKnockout && ownTiebreakers && tiebreakers.length ? tiebreakers : undefined,
      numGroups: isGroups && numGroups ? Math.max(1, Number(numGroups)) : undefined,
      teamsPerGroup: isGroups && teamsPerGroup ? Math.max(2, Number(teamsPerGroup)) : undefined,
      advanceByGroup: advBy && Object.keys(advBy).length ? advBy : undefined,
      advancePerGroup: isGroups && !catGeneral ? Math.max(1, Number(advancePerGroup) || 2) : undefined,
      generalStanding: catGeneral ? true : undefined,
      leagueQualifiers: (isLeague || catGeneral) && q ? q : undefined,
      qualifiers: q,
      leagueMatchesPerTeam: isLeague && matchesPerTeam ? Math.max(1, Number(matchesPerTeam)) : undefined,
      // O chaveamento é semeado automaticamente a partir dos classificados.
      bracket: undefined,
      leagueEntries: undefined,
      thirdPlace: isKnockout ? undefined : thirdPlace,
      autoKnockout,
    }
    setBusy(true)
    try {
      const categories = champ.categories.map((c) => (c.id === categoryId ? { ...c, ...patch } : c))
      await updateChampionship(champ.id, { categories })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a disputa desta categoria.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Disputa · ${nome}`} onClose={onClose} dismissable={false} size="wide">
      <form onSubmit={submit} className="form-grid">
        <p className="field__hint">
          Cada categoria é um campeonato dentro do campeonato. Defina aqui a forma de disputa e as
          regras de classificação <b>desta</b> categoria. Em branco = herda o do campeonato.
        </p>

        <Field label="Forma de disputa">
          <select value={format} onChange={(e) => setFormat(e.target.value as '' | ChampionshipFormat)}>
            <option value="">Como o campeonato ({FORMAT_LABELS[champ.format]})</option>
            {(Object.keys(FORMAT_LABELS) as ChampionshipFormat[]).map((f) => (
              <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
            ))}
          </select>
        </Field>

        {!isKnockout && (
          <div className="form-row">
            <Field label="Pontos por vitória">
              <input type="number" min={0} max={5} value={pointsWin} onChange={(e) => setPointsWin(e.target.value)} placeholder={String(champ.pointsWin ?? 3)} />
            </Field>
            <Field label="Pontos por empate">
              <input type="number" min={0} max={3} value={pointsDraw} onChange={(e) => setPointsDraw(e.target.value)} placeholder={String(champ.pointsDraw ?? 1)} />
            </Field>
          </div>
        )}

        {!isKnockout && (
          <label className="checkbox">
            <input type="checkbox" checked={doubleRound} onChange={(e) => setDoubleRound(e.target.checked)} />
            <span>Turno e returno (todos se enfrentam duas vezes)</span>
          </label>
        )}

        {isLeague && (
          <>
            <Field label="Partidas por equipe" hint="Em branco = todos contra todos. Informe um número para um todos-contra-todos parcial.">
              <input type="number" min={1} max={100} value={matchesPerTeam} onChange={(e) => setMatchesPerTeam(e.target.value)} placeholder="todas contra todas" />
            </Field>
            <Field label="Classificados ao mata-mata" hint="Primeiras colocadas que avançam. Em branco = sem mata-mata (só a tabela).">
              <input type="number" min={1} max={64} value={qualifiers} onChange={(e) => setQualifiers(e.target.value)} placeholder="Ex.: 8" />
            </Field>
          </>
        )}

        {isGroups && (
          <div className="phase-config">
            <div className="form-row">
              <Field label="Número de grupos">
                <input type="number" min={1} max={16} value={numGroups} onChange={(e) => setNumGroups(e.target.value)} placeholder={String(champ.numGroups ?? 2)} />
              </Field>
              <Field label="Equipes por grupo">
                <input type="number" min={2} max={32} value={teamsPerGroup} onChange={(e) => setTeamsPerGroup(e.target.value)} placeholder="opcional" />
              </Field>
            </div>

            <label className="checkbox">
              <input type="checkbox" checked={generalStanding} onChange={(e) => setGeneralStanding(e.target.checked)} />
              <span>📊 <b>Classificação geral</b> — tabela única (todas as equipes juntas); classificam os melhores no geral</span>
            </label>

            {generalStanding ? (
              <Field label="Classificados ao mata-mata (geral)">
                <input type="number" min={1} max={64} value={qualifiers} onChange={(e) => setQualifiers(e.target.value)} placeholder="Ex.: 8" />
              </Field>
            ) : (
              <div className="stage-card__quotas">
                <span className="mini-field__label">Classificados por grupo</span>
                <div className="quota-grid">
                  {letters.map((g) => (
                    <label key={g} className="quota-item">
                      <span className="quota-item__label">Grupo {g}</span>
                      <input
                        type="number"
                        min={0}
                        max={32}
                        value={byGroup[g] ?? advancePerGroup}
                        onChange={(e) => setGroupQuota(g, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <small className="mini-field__hint">quantas equipes avançam de cada grupo</small>
              </div>
            )}
          </div>
        )}

        {!isKnockout && (
          <div className="phase-config">
            <label className="checkbox">
              <input type="checkbox" checked={ownTiebreakers} onChange={(e) => setOwnTiebreakers(e.target.checked)} />
              <span>📊 <b>Critérios de desempate próprios</b> desta categoria</span>
            </label>
            {ownTiebreakers && (
              <>
                <ol className="tiebreak-list">
                  {tiebreakers.map((t, i) => (
                    <li key={t} className="tiebreak-item">
                      <span className="tiebreak-item__idx">{i + 2}º</span>
                      <span className="tiebreak-item__label">{TIEBREAKER_LABELS[t]}</span>
                      <span className="tiebreak-item__actions">
                        <button type="button" className="icon-btn" title="Subir" onClick={() => moveTiebreaker(t, -1)} disabled={i === 0}>↑</button>
                        <button type="button" className="icon-btn" title="Descer" onClick={() => moveTiebreaker(t, 1)} disabled={i === tiebreakers.length - 1}>↓</button>
                        <button type="button" className="icon-btn icon-btn--danger" title="Remover" onClick={() => toggleTiebreaker(t)}>✕</button>
                      </span>
                    </li>
                  ))}
                </ol>
                {(Object.keys(TIEBREAKER_LABELS) as TiebreakerId[]).some((t) => !tiebreakers.includes(t)) && (
                  <div className="tiebreak-add">
                    <span className="muted small">Adicionar:</span>
                    {(Object.keys(TIEBREAKER_LABELS) as TiebreakerId[])
                      .filter((t) => !tiebreakers.includes(t))
                      .map((t) => (
                        <button type="button" key={t} className="chip-btn" onClick={() => toggleTiebreaker(t)}>
                          ＋ {TIEBREAKER_LABELS[t]}
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {(isGroups || (isLeague && Number(qualifiers) >= 2)) && (
          <div className="phase-config">
            <p className="field__hint">
              🏆 O mata-mata é montado automaticamente com os classificados (1º × último colocado). Para
              definir os confrontos na mão ou a entrada escalonada, use “Editar informações”.
            </p>
            <label className="checkbox">
              <input type="checkbox" checked={thirdPlace} onChange={(e) => setThirdPlace(e.target.checked)} />
              <span>Criar disputa de 3º lugar (perdedores das semifinais)</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={autoKnockout} onChange={(e) => setAutoKnockout(e.target.checked)} />
              <span>Criar o mata-mata automaticamente quando a fase de classificação encerrar</span>
            </label>
          </div>
        )}

        {isKnockout && (
          <p className="field__hint">Mata-mata direto: quem perde está eliminado. Gere a tabela em “Partidas”.</p>
        )}

        {error && <p className="auth-error">{error}</p>}

        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar disputa'}</Button>
        </div>
      </form>
    </Modal>
  )
}
