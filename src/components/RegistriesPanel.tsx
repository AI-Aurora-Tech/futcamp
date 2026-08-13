import { useState } from 'react'
import { updateChampionship } from '../services/championships'
import { fileToDataUrl } from '../lib/image'
import { uid } from '../lib/id'
import type { Championship, Referee, Sponsor, Venue } from '../types'
import { Button, EmptyState, Field } from './ui'

/**
 * Cadastros auxiliares do campeonato: árbitros, campos (locais) e
 * patrocinadores/parceiros. Tudo fica embutido como JSON no campeonato.
 */
export function RegistriesPanel({
  championship,
  onChange,
}: {
  championship: Championship
  onChange: () => void
}) {
  const referees = championship.referees ?? []
  const venues = championship.venues ?? []
  const sponsors = championship.sponsors ?? []
  const [busy, setBusy] = useState(false)

  async function persist(patch: Partial<Championship>) {
    setBusy(true)
    try {
      await updateChampionship(championship.id, patch)
      onChange()
    } catch {
      alert('Não foi possível salvar agora.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>Cadastros</h2>
          <p className="muted">Árbitros, campos e patrocinadores/parceiros do campeonato.</p>
        </div>
      </div>

      <RefereesBlock referees={referees} busy={busy} onSave={(list) => void persist({ referees: list })} />
      <VenuesBlock venues={venues} busy={busy} onSave={(list) => void persist({ venues: list })} />
      <SponsorsBlock sponsors={sponsors} busy={busy} onSave={(list) => void persist({ sponsors: list })} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Árbitros
// ---------------------------------------------------------------------------
function RefereesBlock({
  referees,
  busy,
  onSave,
}: {
  referees: Referee[]
  busy: boolean
  onSave: (list: Referee[]) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onSave([...referees, { id: uid('ref'), name: name.trim(), phone: phone.trim() || undefined }])
    setName('')
    setPhone('')
  }

  return (
    <div className="settings-block">
      <h3>🧑‍⚖️ Árbitros</h3>
      <p className="muted small">Cadastre os árbitros para escalá-los nas partidas.</p>
      {referees.length === 0 ? (
        <EmptyState icon="🧑‍⚖️" title="Nenhum árbitro cadastrado" />
      ) : (
        <ul className="reg-list">
          {referees.map((r) => (
            <li key={r.id} className="reg-list__item">
              <div className="reg-list__info">
                <strong>{r.name}</strong>
                {r.phone && <span className="muted small">{r.phone}</span>}
              </div>
              <button
                className="icon-btn icon-btn--danger"
                title="Remover"
                disabled={busy}
                onClick={() => onSave(referees.filter((x) => x.id !== r.id))}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="reg-add">
        <Field label="Nome do árbitro">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João Silva" />
        </Field>
        <Field label="Contato (opcional)">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 90000-0000" />
        </Field>
        <Button type="submit" disabled={busy || !name.trim()}>＋ Adicionar</Button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Campos / locais
// ---------------------------------------------------------------------------
function VenuesBlock({
  venues,
  busy,
  onSave,
}: {
  venues: Venue[]
  busy: boolean
  onSave: (list: Venue[]) => void
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onSave([...venues, { id: uid('venue'), name: name.trim(), address: address.trim() || undefined }])
    setName('')
    setAddress('')
  }

  return (
    <div className="settings-block">
      <h3>🏟️ Campos</h3>
      <p className="muted small">Locais onde as partidas são disputadas.</p>
      {venues.length === 0 ? (
        <EmptyState icon="🏟️" title="Nenhum campo cadastrado" />
      ) : (
        <ul className="reg-list">
          {venues.map((v) => (
            <li key={v.id} className="reg-list__item">
              <div className="reg-list__info">
                <strong>{v.name}</strong>
                {v.address && <span className="muted small">{v.address}</span>}
              </div>
              <button
                className="icon-btn icon-btn--danger"
                title="Remover"
                disabled={busy}
                onClick={() => onSave(venues.filter((x) => x.id !== v.id))}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="reg-add">
        <Field label="Nome do campo">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Estádio Municipal" />
        </Field>
        <Field label="Endereço (opcional)">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, nº, bairro" />
        </Field>
        <Button type="submit" disabled={busy || !name.trim()}>＋ Adicionar</Button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Patrocinadores / parceiros
// ---------------------------------------------------------------------------
function SponsorsBlock({
  sponsors,
  busy,
  onSave,
}: {
  sponsors: Sponsor[]
  busy: boolean
  onSave: (list: Sponsor[]) => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [tier, setTier] = useState<Sponsor['tier']>('patrocinador')
  const [logo, setLogo] = useState<string | undefined>()
  const [uploading, setUploading] = useState(false)

  async function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      setLogo(await fileToDataUrl(file, 200))
    } catch {
      alert('Não foi possível carregar a imagem.')
    } finally {
      setUploading(false)
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onSave([
      ...sponsors,
      { id: uid('spon'), name: name.trim(), url: url.trim() || undefined, tier, logo },
    ])
    setName('')
    setUrl('')
    setTier('patrocinador')
    setLogo(undefined)
  }

  const isImage = (l?: string) => l?.startsWith('data:') || l?.startsWith('http')

  return (
    <div className="settings-block">
      <h3>🤝 Patrocinadores e parceiros</h3>
      <p className="muted small">Aparecem na página pública do campeonato.</p>
      {sponsors.length === 0 ? (
        <EmptyState icon="🤝" title="Nenhum patrocinador cadastrado" />
      ) : (
        <ul className="reg-list">
          {sponsors.map((s) => (
            <li key={s.id} className="reg-list__item">
              <span className="sponsor-logo">
                {isImage(s.logo) ? <img src={s.logo} alt="" /> : <span>{s.logo || '🏷️'}</span>}
              </span>
              <div className="reg-list__info">
                <strong>{s.name}</strong>
                <span className="muted small">
                  {s.tier === 'patrocinador' ? 'Patrocinador' : 'Parceiro'}
                  {s.url ? ` · ${s.url}` : ''}
                </span>
              </div>
              <button
                className="icon-btn icon-btn--danger"
                title="Remover"
                disabled={busy}
                onClick={() => onSave(sponsors.filter((x) => x.id !== s.id))}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="reg-add">
        <Field label="Nome">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Loja do Esporte" />
        </Field>
        <Field label="Tipo">
          <select value={tier} onChange={(e) => setTier(e.target.value as Sponsor['tier'])}>
            <option value="patrocinador">Patrocinador</option>
            <option value="parceiro">Parceiro</option>
          </select>
        </Field>
        <Field label="Site (opcional)">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Logotipo (opcional)">
          <div className="reg-logo-row">
            {logo && (
              <span className="sponsor-logo">
                {isImage(logo) ? <img src={logo} alt="" /> : <span>{logo}</span>}
              </span>
            )}
            <input type="file" accept="image/*" onChange={(e) => void pickLogo(e)} />
          </div>
        </Field>
        <Button type="submit" disabled={busy || uploading || !name.trim()}>
          {uploading ? 'Carregando…' : '＋ Adicionar'}
        </Button>
      </form>
    </div>
  )
}
