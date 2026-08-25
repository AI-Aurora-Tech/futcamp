import { useEffect, useRef, useState } from 'react'
import {
  motivoDaFalha,
  addRegPlayer,
  createTeamAccount,
  loadRegistration,
  removeRegPlayer,
  saveTeamInfo,
  setTeamPassword,
  teamLogin,
  updateRegPlayer,
  type PlayerInput,
  type RegistrationData,
} from '../services/registration'
import {
  algumaPermite,
  contarFederados,
  limiteFederados,
  MODALIDADE_LABELS,
  permiteFederados,
  regraVale,
  textoRegra,
  vagasFederados,
  type ModalidadeFederado,
} from '../lib/federated'
import { fileToDataUrl } from '../lib/image'
import { formatCpf, withinAgeRule, birthYearOf } from '../lib/eligibility'
import { registrationLockForTeam } from '../lib/matchWindow'
import { validateAthlete } from '../services/validation'
import { disablePush, enablePush, flushPush, pushAvailable } from '../services/push'
import {
  POSICAO_PADRAO,
  opcoesDePosicao,
  posicaoValePara,
  type Category,
  type Player,
  type Position,
} from '../types'
import { RegulamentoButton } from './RegulamentoButton'
import { Button, ChampLogo, EmptyState, Field, Modal, PushToggle, Spinner, SuporteLink, TeamBadge } from './ui'
import { ImportAthletesModal } from './ImportAthletesModal'
import { abrirSessaoTime, temSessaoTime } from '../lib/teamSession'
import { emailPlausivel } from '../lib/email'
import { LINK_SUPORTE_TIME } from '../lib/whatsapp'


export function TeamRegistration({
  teamId,
  token,
  onHome,
}: {
  teamId: string
  token: string
  onHome: () => void
}) {
  const [data, setData] = useState<RegistrationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [motivo, setMotivo] = useState<string | null>(null)
  const [authed, setAuthed] = useState(false)

  const reload = async () => {
    const d = await loadRegistration(teamId, token)
    if (!d) setInvalid(true)
    else {
      setData(d)
      // Alterações do time geram aviso para o organizador: entrega na hora.
      void flushPush(d.championshipId)
    }
  }

  useEffect(() => {
    setAuthed(temSessaoTime(teamId))
    setLoading(true)
    loadRegistration(teamId, token)
      .then((d) => {
        if (d) setData(d)
        else {
          setMotivo(motivoDaFalha())
          setInvalid(true)
        }
      })
      .catch((e) => {
        setMotivo((e as Error)?.message ?? null)
        setInvalid(true)
      })
      .finally(() => setLoading(false))
  }, [teamId, token])

  function onAuthenticated() {
    abrirSessaoTime(teamId)
    setAuthed(true)
    void reload()
  }

  if (loading) return <div className="container pad-lg"><Spinner /></div>
  if (invalid || !data) {
    return (
      <div className="container pad-lg center">
        <div className="empty__icon">🔒</div>
        <h2>Link inválido ou expirado</h2>
        <p className="muted">Peça ao organizador um novo link de inscrição do time.</p>
        {motivo && <p className="muted small reg__motivo">Detalhe técnico: {motivo}</p>}
        <div className="reg__acoes">
          <button className="btn btn--primary" onClick={onHome}>Ir para o início</button>
          <SuporteLink href={LINK_SUPORTE_TIME} variant="botao">Falar com o suporte</SuporteLink>
        </div>
      </div>
    )
  }

  return (
    <div className="reg">
      <header className="reg__hero">
        <div className="container">
          <div className="reg__champ">
            <span className="reg__champ-logo"><ChampLogo logo={data.championshipLogo} /></span>
            <div>
              <p className="reg__eyebrow">Inscrição · {data.team.name}</p>
              <h1>{data.championshipName}</h1>
            </div>
            {data.championship && (
              <div className="reg__doc">
                <RegulamentoButton champ={data.championship} variant="soft" />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="container reg__content">
        {!authed ? (
          <AccessGate teamId={teamId} token={token} hasAccount={data.hasAccount} onDone={onAuthenticated} />
        ) : (
          <>
            <TeamCard teamId={teamId} token={token} data={data} onSaved={reload} />
            <ManagersCard teamId={teamId} token={token} data={data} onChanged={reload} />
            <RosterCard teamId={teamId} token={token} data={data} onChanged={reload} />
            <p className="reg__foot">
              Suas alterações são salvas para o organizador do campeonato.
              {' '}Alguma dúvida? <SuporteLink href={LINK_SUPORTE_TIME}>Fale com o suporte</SuporteLink>.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Acesso do time (criar conta / login)                                        */
/* -------------------------------------------------------------------------- */
function AccessGate({
  teamId,
  token,
  hasAccount,
  onDone,
}: {
  teamId: string
  token: string
  hasAccount: boolean
  onDone: () => void
}) {
  // 'reset' = a senha foi zerada pelo administrador; o gestor cria uma nova.
  const [mode, setMode] = useState<'login' | 'create' | 'reset'>(hasAccount ? 'login' : 'create')
  // O login do time é o e-mail do gestor. É ele que permite entrar depois pela
  // página inicial, sem precisar guardar o link do organizador.
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (mode === 'reset') {
      if (password !== confirm) {
        setError('As senhas não conferem.')
        return
      }
      setBusy(true)
      const set = await setTeamPassword(teamId, token, username, password)
      if (!set.ok) {
        setBusy(false)
        setError(set.error ?? 'Não foi possível redefinir a senha.')
        return
      }
      const login = await teamLogin(teamId, token, username, password)
      setBusy(false)
      if (login.ok) onDone()
      else {
        setMode('login'); setPassword(''); setConfirm('')
        setError('Senha criada! Entre novamente com a nova senha.')
      }
      return
    }

    if (mode === 'create') {
      if (!emailPlausivel(username)) {
        setError('Informe um e-mail válido — é com ele que você vai entrar pela página inicial.')
        return
      }
      if (password !== confirm) {
        setError('As senhas não conferem.')
        return
      }
    }
    setBusy(true)
    const res =
      mode === 'create'
        ? await createTeamAccount(teamId, token, username, password)
        : await teamLogin(teamId, token, username, password)
    setBusy(false)
    if (res.ok) onDone()
    else if ('needsPassword' in res && res.needsPassword) {
      // O administrador zerou a senha deste gestor: criar uma nova.
      setPassword(''); setConfirm(''); setError(null); setMode('reset')
    } else setError(res.error ?? 'Não foi possível continuar.')
  }

  if (mode === 'reset') {
    return (
      <section className="panel reg__panel reg__gate">
        <h2>Criar nova senha</h2>
        <p className="muted">
          O administrador zerou a senha de <b>{username.trim().toLowerCase()}</b>. Defina uma nova senha para gerir o time.
        </p>
        <form onSubmit={submit} className="form-grid reg__gate-form">
          <Field label="Nova senha">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} autoComplete="new-password" required />
          </Field>
          <Field label="Confirmar nova senha">
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={4} autoComplete="new-password" required />
          </Field>
          {error && <p className="auth-error">{error}</p>}
          <Button type="submit" disabled={busy || !password || !confirm}>{busy ? 'Salvando…' : 'Criar senha e entrar'}</Button>
        </form>
        <div className="reg__gate-switch">
          <button className="link-btn" onClick={() => { setMode('login'); setError(null); setPassword(''); setConfirm('') }}>Voltar</button>
        </div>
      </section>
    )
  }

  return (
    <section className="panel reg__panel reg__gate">
      <h2>{mode === 'create' ? 'Criar acesso do time' : 'Entrar'}</h2>
      <p className="muted">
        {mode === 'create'
          ? 'Use um e-mail válido e crie uma senha. Com eles você entra aqui e também pela página inicial do Tabelaço, sem precisar deste link.'
          : 'Entre com o e-mail e a senha do responsável pelo time.'}
      </p>
      <form onSubmit={submit} className="form-grid reg__gate-form">
        <Field label="E-mail do responsável">
          <input
            type="email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="voce@email.com"
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Senha">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} required={mode === 'create'} />
        </Field>
        {mode === 'create' && (
          <Field label="Confirmar senha">
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={4} required />
          </Field>
        )}
        {error && <p className="auth-error">{error}</p>}
        <Button type="submit" disabled={busy || !username.trim() || (mode === 'create' && !password)}>
          {busy ? 'Aguarde…' : mode === 'create' ? 'Criar acesso e entrar' : 'Entrar'}
        </Button>
      </form>
      {mode === 'create' ? (
        <p className="hint">
          🔑 Guarde este e-mail e senha: depois de criados, você gerencia o time entrando
          pela página inicial do Tabelaço — o link do organizador deixa de ser necessário.
        </p>
      ) : (
        <p className="hint">Sua senha foi zerada pelo organizador? Informe o e-mail e clique em Entrar para criar uma nova senha.</p>
      )}
      <div className="reg__gate-switch">
        {mode === 'create' ? (
          <button className="link-btn" onClick={() => { setMode('login'); setError(null) }}>Já tenho acesso — entrar</button>
        ) : (
          <button className="link-btn" onClick={() => { setMode('create'); setError(null) }}>Ainda não criei — criar acesso</button>
        )}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Escudo e dados do time                                                      */
/* -------------------------------------------------------------------------- */
function TeamCard({
  teamId,
  token,
  data,
  onSaved,
}: {
  teamId: string
  token: string
  data: RegistrationData
  onSaved: () => Promise<void>
}) {
  const t = data.team
  const [name, setName] = useState(t.name)
  const [coach, setCoach] = useState(t.coach ?? '')
  const [phone, setPhone] = useState(t.phone ?? '')
  const [color, setColor] = useState(t.color ?? '#2563eb')
  const [logo, setLogo] = useState(t.logo ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setLogo(await fileToDataUrl(file, 256))
    } catch {
      setMsg('Não foi possível carregar a imagem.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await saveTeamInfo(teamId, token, { name: name.trim(), coach: coach.trim(), phone: phone.trim(), color, logo })
      await onSaved()
      setMsg('Dados do time salvos! ✅')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Erro ao salvar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel reg__panel">
      <h2>Escudo e dados do time</h2>
      <form onSubmit={save} className="reg__team">
        <div className="reg__badge">
          <TeamBadge team={{ name, logo, color }} size={96} />
          <div className="reg__logo-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
            <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>⬆ Enviar escudo</Button>
            {logo?.startsWith('data:') && (
              <button type="button" className="link-btn" onClick={() => setLogo('')}>remover imagem</button>
            )}
            <p className="field__hint">Envie a imagem do brasão (PNG/JPG/SVG). Sem imagem, usamos a sigla e a cor.</p>
          </div>
        </div>

        <div className="reg__fields">
          <Field label="Nome do time">
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <div className="form-row">
            <Field label="Responsável">
              <input value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="Nome do responsável" />
            </Field>
            <Field label="Telefone">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
            </Field>
          </div>
          <Field label="Cor">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="color-input" />
          </Field>
          <div className="reg__save">
            {msg && <span className="reg__msg">{msg}</span>}
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Salvando…' : 'Salvar dados do time'}</Button>
          </div>
        </div>
      </form>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Gestores do time (até 2 pessoas)                                            */
/* -------------------------------------------------------------------------- */
function ManagersCard({
  teamId,
  token,
  data,
  onChanged,
}: {
  teamId: string
  token: string
  data: RegistrationData
  onChanged: () => Promise<void>
}) {
  const managers = data.managers
  const [adding, setAdding] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canAdd = managers.length < 2

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!emailPlausivel(username)) {
      setError('Informe um e-mail válido para o 2º gestor.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    const res = await createTeamAccount(teamId, token, username, password)
    setBusy(false)
    if (res.ok) {
      setUsername(''); setPassword(''); setConfirm(''); setAdding(false)
      await onChanged()
    } else {
      setError(res.error ?? 'Não foi possível adicionar o gestor.')
    }
  }

  return (
    <section className="panel reg__panel">
      <div className="panel__head">
        <div>
          <h2>Gestores do time ({managers.length}/2)</h2>
          <p className="muted">
            Até 2 pessoas podem acessar e gerir este time. Cada uma entra pela página
            inicial com o próprio e-mail e senha.
          </p>
        </div>
        {canAdd && !adding && (
          <div className="panel__head-actions">
            <Button variant="soft" onClick={() => setAdding(true)}>＋ Adicionar 2º gestor</Button>
          </div>
        )}
      </div>

      <ul className="manager-list">
        {managers.map((u) => (
          <li key={u} className="manager-list__item"><span>👤</span> {u}</li>
        ))}
      </ul>

      {canAdd && adding && (
        <form onSubmit={submit} className="form-grid">
          <div className="form-row">
            <Field label="E-mail do 2º gestor">
              <input
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="auxiliar@email.com"
                autoComplete="off"
                required
              />
            </Field>
            <Field label="Senha">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} autoComplete="new-password" required />
            </Field>
            <Field label="Confirmar senha">
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={4} required />
            </Field>
          </div>
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <Button variant="ghost" type="button" onClick={() => { setAdding(false); setError(null) }}>Cancelar</Button>
            <Button type="submit" disabled={busy || !username.trim() || !password}>{busy ? 'Adicionando…' : 'Adicionar gestor'}</Button>
          </div>
        </form>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Elenco / atletas                                                            */
/* -------------------------------------------------------------------------- */
function RosterCard({
  teamId,
  token,
  data,
  onChanged,
}: {
  teamId: string
  token: string
  data: RegistrationData
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Player | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const catById = new Map(data.categories.map((c) => [c.id, c] as const))
  const lock = registrationLockForTeam(data.team.id, data.matches, data.registrationCutoffHours, data.closedRounds)

  /* ---------------------------------------------------------------------- */
  /* Abas de categoria                                                       */
  /*                                                                          */
  /* Cada categoria é uma competição, e o elenco de uma não se mistura com o  */
  /* da outra: o clube inscreve atletas diferentes no Sub-11 e no Sub-15. As  */
  /* abas mostram só as categorias em que ESTE clube está inscrito — as       */
  /* outras não são assunto dele.                                             */
  /* ---------------------------------------------------------------------- */
  const minhas = data.teamCategories.length
    ? data.categories.filter((c) => data.teamCategories.includes(c.id))
    : data.categories
  const varias = minhas.length > 1
  const [catId, setCatId] = useState<string>(minhas[0]?.id ?? '')
  const catAtual = varias ? (minhas.some((c) => c.id === catId) ? catId : minhas[0]?.id) : minhas[0]?.id

  const doElenco = varias
    ? data.players.filter((p) => (p.categoryId || minhas[0]?.id) === catAtual)
    : data.players
  const athletes = doElenco.filter((p) => (p.role ?? 'atleta') === 'atleta').length
  const staff = doElenco.filter((p) => p.role === 'comissao').length
  const nomeCat = minhas.find((c) => c.id === catAtual)?.name

  async function remove(p: Player) {
    if (!confirm(`Remover ${p.name} do elenco?`)) return
    await removeRegPlayer(teamId, token, p.id)
    await onChanged()
  }

  return (
    <section className="panel reg__panel">
      <div className="panel__head">
        <div>
          <h2>
            {varias ? `Elenco · ${nomeCat}` : 'Elenco'} — {athletes} atleta(s), {staff} comissão
          </h2>
          <p className="muted">
            Inscreva os atletas com nome completo, CPF e data de nascimento.
            {varias && ' Cada categoria tem o seu elenco.'}
          </p>
        </div>
        <div className="panel__head-actions">
          <Button variant="soft" onClick={() => setImporting(true)} disabled={lock.locked}>📊 Importar planilha</Button>
          <Button onClick={() => setAdding(true)} disabled={lock.locked}>＋ Inscrever atleta</Button>
        </div>
      </div>

      {varias && (
        <nav className="cat-tabs cat-tabs--claro" aria-label="Categorias do time">
          {minhas.map((c) => {
            const quantos = data.players.filter(
              (p) => (p.categoryId || minhas[0]?.id) === c.id && (p.role ?? 'atleta') === 'atleta',
            ).length
            return (
              <button
                key={c.id}
                className={`cat-tab ${catAtual === c.id ? 'is-active' : ''}`}
                onClick={() => setCatId(c.id)}
              >
                {c.name} <span className="cat-tab__n">{quantos}</span>
              </button>
            )
          })}
        </nav>
      )}

      <PushToggle
        title="Avisos do meu time"
        hint="No celular: jogo marcado ou remarcado, lembrete 2 dias antes, gol com o nome de quem fez, atleta suspenso por cartão, o resumo da partida da sua equipe e a classificação quando a rodada fecha."
        available={pushAvailable()}
        enable={() => enablePush({ championshipId: data.championshipId, role: 'team', teamId: teamId, token })}
        disable={() => disablePush(data.championshipId)}
      />

      {lock.locked && (
        <div className="lock-banner">
          {lock.reason === 'manual' ? (
            <>🔒 As inscrições da <b>próxima rodada</b> foram <b>encerradas pelo organizador</b>. Reabrem após a rodada ser realizada.</>
          ) : (
            <>
              🔒 Inscrições <b>encerradas</b> para a próxima partida
              {lock.matchAt ? ` (${new Date(lock.matchAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : ''}.
              Reabrem automaticamente após o jogo ser finalizado.
            </>
          )}
        </div>
      )}

      {regraVale(data) && (
        <div className={`fed-note ${algumaPermite(data, data.categories) ? '' : 'fed-note--no'}`}>
          <b>Atletas federados (campo / futsal)</b>
          <ul className="fed-note__list">
            {(varias ? minhas.filter((c) => c.id === catAtual) : minhas).map((cat) => {
              const usadas = contarFederados(data.players, cat.id)
              const limite = limiteFederados(cat)
              return (
                <li key={cat.id}>
                  {permiteFederados(cat) ? '✅' : '⛔'} <b>{cat.name}</b>: {textoRegra(cat)}
                  {permiteFederados(cat) && (
                    <> Marcados: <b>{usadas}</b>{Number.isFinite(limite) && ` de ${limite}`}.</>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {doElenco.length === 0 ? (
        <EmptyState icon="👤" title={varias ? `Nenhum atleta no ${nomeCat}` : 'Nenhum atleta inscrito'}>
          <p>Comece inscrevendo os atletas do elenco.</p>
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="roster">
            <thead>
              <tr>
                <th className="col-num">#</th>
                <th>Atleta</th>
                <th>Nasc.</th>
                {!varias && data.categories.length > 1 && <th>Categoria</th>}
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {doElenco.map((p) => (
                <tr key={p.id}>
                  <td className="col-num">{p.number ?? '—'}</td>
                  <td>
                    <span className="athlete-cell">
                      <span className="athlete-photo">{p.photo ? <img src={p.photo} alt="" /> : '👤'}</span>
                      <span>
                        <span className="strong">
                          {p.name}
                          {p.federated && (
                            <span className="fed-tag" title="Atleta federado">
                              FEDERADO{p.federatedIn ? ` · ${MODALIDADE_LABELS[p.federatedIn]}` : ''}
                            </span>
                          )}
                        </span>
                        {p.cpf && <span className="athlete-cpf">{formatCpf(p.cpf)}</span>}
                      </span>
                    </span>
                  </td>
                  <td>{p.birthdate ? p.birthdate.split('-').reverse().join('/') : '—'}</td>
                  {!varias && data.categories.length > 1 && (
                    <td>{catById.get(p.categoryId ?? '')?.name ?? '—'}</td>
                  )}
                  <td className="col-actions">
                    <button className="icon-btn" title="Editar" onClick={() => setEditing(p)}>✎</button>
                    <button className="icon-btn icon-btn--danger" title="Remover" onClick={() => void remove(p)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <AthleteDialog
          teamId={teamId}
          token={token}
          // Só as categorias deste clube, e a da aba aberta já vem escolhida:
          // inscrever no Sub-15 estando na aba do Sub-11 seria um erro que só
          // aparece na hora do jogo.
          categories={varias ? minhas.filter((c) => c.id === catAtual) : minhas}
          audience={data.audience}
          elenco={data.players}
          initial={editing ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setAdding(false)
            setEditing(null)
            await onChanged()
          }}
        />
      )}

      {importing && (
        <ImportAthletesModal
          categories={varias ? minhas.filter((c) => c.id === catAtual) : minhas}
          existing={data.players}
          teamId={teamId}
          onAdd={async (i) => {
            await addRegPlayer(teamId, token, {
              name: i.name,
              cpf: i.cpf,
              birthdate: i.birthdate,
              categoryId: i.categoryId,
              role: i.role,
              federated: i.federated,
              federatedIn: i.federatedIn,
            })
          }}
          onClose={() => setImporting(false)}
          onDone={onChanged}
        />
      )}
    </section>
  )
}

export function AthleteDialog({
  teamId,
  token,
  categories,
  audience,
  elenco,
  initial,
  onClose,
  onSaved,
}: {
  teamId: string
  token: string
  categories: Category[]
  /** Público do campeonato: federados só existem na base. */
  audience?: 'infantil' | 'adulto'
  /** Elenco atual, para saber quantas vagas de federado restam. */
  elenco?: Player[]
  initial?: Player
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [role, setRole] = useState<'atleta' | 'comissao'>(initial?.role ?? 'atleta')
  const [name, setName] = useState(initial?.name ?? '')
  const [cpf, setCpf] = useState(initial?.cpf ? formatCpf(initial.cpf) : '')
  const [birthdate, setBirthdate] = useState(initial?.birthdate ?? '')
  const [number, setNumber] = useState(initial?.number != null ? String(initial.number) : '')
  const [position, setPosition] = useState<Position>(
    initial?.position ?? POSICAO_PADRAO[initial?.role ?? 'atleta'],
  )
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  const [photo, setPhoto] = useState<string | undefined>(initial?.photo)
  const [federated, setFederated] = useState(Boolean(initial?.federated))
  const [federatedIn, setFederatedIn] = useState<ModalidadeFederado>(initial?.federatedIn ?? 'campo')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const isAthlete = role === 'atleta'

  const category = categories.find((c) => c.id === categoryId)
  const ruleHint = category?.birthYear
    ? category.birthYearMode === 'min'
      ? `Aceita nascidos em ${category.birthYear} ou depois.`
      : `Aceita nascidos em ${category.birthYear} ou antes${category.exceptions ? ` (até ${category.exceptions} exceção(ões) por time)` : ''}.`
    : null
  const outOfRule = Boolean(category?.birthYear && birthdate && !withinAgeRule(category, birthYearOf(birthdate)))

  // A permissão é DA CATEGORIA escolhida — trocar de categoria muda a regra.
  // Vagas desconsiderando o próprio atleta: reeditar um federado que já existe
  // não pode esbarrar no limite por causa dele mesmo.
  const vagasFed = vagasFederados(category, elenco, initial?.id)
  const mostraFederado = isAthlete && regraVale({ audience }) && permiteFederados(category)
  const semVaga = !federated && vagasFed <= 0

  useEffect(() => {
    if (federated && !permiteFederados(category)) setFederated(false)
  }, [category, federated])

  // Atleta escolhe posição em campo; comissão técnica escolhe função. Trocar
  // de papel com um código da outra lista gravado deixaria o `select` sem
  // opção correspondente — e o navegador mostraria a primeira, calado.
  const opcoesPosicao = opcoesDePosicao(role)
  useEffect(() => {
    if (!posicaoValePara(role, position)) setPosition(POSICAO_PADRAO[role])
  }, [role, position])

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhoto(await fileToDataUrl(file, 320))
    } catch {
      setError('Não foi possível carregar a foto.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      // Validação de CPF × data de nascimento (API + fallback local).
      if (isAthlete || (cpf && birthdate)) {
        const check = await validateAthlete(cpf, birthdate)
        if (!check.ok) {
          setError(check.message)
          return
        }
      }
      const payload: PlayerInput = {
        name: name.trim(),
        cpf: cpf.replace(/\D/g, '') || undefined,
        federated: mostraFederado ? federated : false,
        federatedIn: mostraFederado && federated ? federatedIn : undefined,
        birthdate: birthdate || undefined,
        photo,
        number: number ? Number(number) : undefined,
        position,
        categoryId: categoryId || undefined,
        role,
      }
      if (initial) await updateRegPlayer(teamId, token, initial.id, payload)
      else await addRegPlayer(teamId, token, payload)
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível inscrever o atleta.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? 'Editar atleta' : 'Inscrever atleta'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <div className="athlete-photo-field">
          <span className="athlete-photo athlete-photo--lg">{photo ? <img src={photo} alt="" /> : '👤'}</span>
          <div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
            <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>📷 Foto (opcional)</Button>
            {photo && <button type="button" className="link-btn" onClick={() => setPhoto(undefined)}>remover foto</button>}
          </div>
        </div>

        <Field label="Tipo de inscrição">
          <div className="segmented">
            <button type="button" className={`segmented__item ${isAthlete ? 'is-active' : ''}`} onClick={() => setRole('atleta')}>🏃 Atleta</button>
            <button type="button" className={`segmented__item ${!isAthlete ? 'is-active' : ''}`} onClick={() => setRole('comissao')}>📋 Comissão técnica</button>
          </div>
        </Field>

        <Field label="Nome completo">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" required />
        </Field>

        <div className="form-row">
          <Field label={isAthlete ? 'CPF' : 'CPF (opcional)'}>
            <input value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" required={isAthlete} />
          </Field>
          <Field label={isAthlete ? 'Data de nascimento' : 'Data de nascimento (opcional)'}>
            <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} required={isAthlete} />
          </Field>
        </div>

        {categories.length > 1 && (
          <Field label="Categoria">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}
        {mostraFederado && (
          <div className="fed-box">
            <label className="check">
              <input
                type="checkbox"
                checked={federated}
                disabled={semVaga}
                onChange={(e) => setFederated(e.target.checked)}
              />
              <span>
                Este atleta é <b>federado</b>
                {categories.length > 1 && <span className="muted small"> em {category?.name}</span>}
                {Number.isFinite(vagasFed) && (
                  <span className="muted small">
                    {' '}— {semVaga ? 'sem vagas restantes' : `${vagasFed} vaga(s) restante(s)`}
                  </span>
                )}
              </span>
            </label>
            {federated && (
              <label className="mini-field">
                <span className="mini-field__label">Federado em</span>
                <select
                  value={federatedIn}
                  onChange={(e) => setFederatedIn(e.target.value as ModalidadeFederado)}
                >
                  {(Object.keys(MODALIDADE_LABELS) as ModalidadeFederado[]).map((m) => (
                    <option key={m} value={m}>{MODALIDADE_LABELS[m]}</option>
                  ))}
                </select>
              </label>
            )}
            {semVaga && (
              <p className="field__hint">
                O time já usou todas as vagas de atleta federado{category ? ` em ${category.name}` : ''}.
              </p>
            )}
          </div>
        )}

        {isAthlete && ruleHint && (
          <p className={`rule-hint ${outOfRule ? 'rule-hint--warn' : ''}`}>
            {outOfRule ? '⚠️ Fora da faixa: ' : 'ℹ️ '}
            {ruleHint}
          </p>
        )}

        <div className="form-row">
          <Field label="Número (opcional)">
            <input type="number" min={1} max={99} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="10" />
          </Field>
          <Field label={isAthlete ? 'Posição' : 'Função'}>
            <select value={position} onChange={(e) => setPosition(e.target.value as Position)}>
              {opcoesPosicao.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </Field>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Validando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
