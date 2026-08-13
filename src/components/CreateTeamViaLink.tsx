import { useEffect, useRef, useState } from 'react'
import { getChampionship } from '../services/championships'
import { createTeamViaLink } from '../services/teams'
import { fileToDataUrl } from '../lib/image'
import type { Championship } from '../types'
import { Button, ChampLogo, Field, Spinner, TeamBadge } from './ui'

/**
 * Página pública de CRIAÇÃO de time via link (`#/novo-time/<champId>?k=<token>`).
 * O responsável cria o próprio time e é levado ao fluxo de inscrição
 * (`#/t/<teamId>?k=<token>`) para definir gestores e inscrever os atletas.
 */
export function CreateTeamViaLink({
  championshipId,
  token,
  onHome,
}: {
  championshipId: string
  token: string
  onHome: () => void
}) {
  const [champ, setChamp] = useState<Championship | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [logo, setLogo] = useState('')
  const [color, setColor] = useState('#2563eb')
  const [coach, setCoach] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    getChampionship(championshipId)
      .then((c) => {
        if (!active) return
        if (!c) setNotFound(true)
        else setChamp(c)
      })
      .catch(() => active && setNotFound(true))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [championshipId])

  async function onLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setLogo(await fileToDataUrl(file, 256))
      setError(null)
    } catch {
      setError('Não foi possível carregar a imagem.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { teamId, token: teamToken } = await createTeamViaLink(championshipId, token, {
        name,
        shortName,
        logo,
        color,
        coach,
      })
      // Segue para o fluxo de inscrição do time recém-criado.
      window.location.hash = `#/t/${teamId}?k=${teamToken}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o time.')
      setBusy(false)
    }
  }

  if (loading) return <div className="container pad-lg"><Spinner /></div>
  if (notFound || !champ) {
    return (
      <div className="container pad-lg center">
        <div className="empty__icon">🔒</div>
        <h2>Link inválido ou expirado</h2>
        <p className="muted">Peça ao organizador um novo link de criação de time.</p>
        <button className="btn btn--primary" onClick={onHome}>Ir para o início</button>
      </div>
    )
  }

  return (
    <div className="reg">
      <header className="reg__hero">
        <div className="container">
          <div className="reg__champ">
            <span className="reg__champ-logo"><ChampLogo logo={champ.logo} /></span>
            <div>
              <p className="reg__eyebrow">Criar time</p>
              <h1>{champ.name}</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="container reg__content">
        <section className="panel reg__panel">
          <h2>Dados do seu time</h2>
          <p className="muted">Crie o time do campeonato. Em seguida você define o acesso (até 2 gestores) e inscreve os atletas.</p>
          <form onSubmit={submit} className="reg__team">
            <div className="reg__badge">
              <TeamBadge team={{ name, shortName, logo, color }} size={96} />
              <div className="reg__logo-actions">
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogoUpload} />
                <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>⬆ Enviar escudo</Button>
                {logo?.startsWith('data:') && (
                  <button type="button" className="link-btn" onClick={() => setLogo('')}>remover imagem</button>
                )}
                <p className="field__hint">Envie a imagem do brasão (PNG/JPG/SVG). Sem imagem, usamos a sigla e a cor.</p>
              </div>
            </div>

            <div className="reg__fields">
              <div className="form-row">
                <Field label="Nome do time">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Leões FC" required />
                </Field>
                <Field label="Sigla" hint="3 letras (ex.: LEO)">
                  <input value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={4} placeholder="LEO" />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Técnico (opcional)">
                  <input value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="Nome do técnico" />
                </Field>
                <Field label="Cor">
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
                </Field>
              </div>
              {error && <p className="auth-error">{error}</p>}
              <div className="reg__save">
                <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Criando…' : 'Criar time e continuar'}</Button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
