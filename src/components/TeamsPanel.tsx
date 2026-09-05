import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createTeam,
  deleteTeam,
  ensureChampCategoryToken,
  ensureChampTeamToken,
  ensureTeamToken,
  listTeamManagers,
  resetTeamManagerPassword,
  setTeamCategories,
  updateTeam,
  type NewTeam,
  type TeamManager,
} from '../services/teams'
import type { Championship, Team } from '../types'
import { fileToDataUrl } from '../lib/image'
import { limiteDeTimes, motivoLimiteDeTimes, planOf, vagasDeTime } from '../lib/pricing'
import { competicaoDaCategoria, elencoDeTimes } from '../lib/categorias'
import { Button, EmptyState, Field, Modal, SearchField, Spinner, TeamBadge } from './ui'

export function TeamsPanel({
  championship,
  teams,
  categoryId,
  onChange,
}: {
  championship: Championship
  /** TODOS os clubes do campeonato — a inscrição é que diz quem joga o quê. */
  teams: Team[]
  /** Categoria em foco. Indefinida = campeonato de categoria única. */
  categoryId?: string
  onChange: () => void
}) {
  const [editing, setEditing] = useState<Team | null>(null)
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState<Team | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [search, setSearch] = useState('')
  // Limite do plano contratado. O botão some quando não cabe mais — deixar
  // clicável para o banco recusar no fim do formulário é fazer o organizador
  // digitar à toa.
  // Os clubes DESTA categoria — é o que a aba mostra. O limite do plano, porém,
  // conta o campeonato inteiro: um clube em quatro categorias é um clube.
  const daCategoria = elencoDeTimes(teams, categoryId)
  const catNome = championship.categories.find((c) => c.id === categoryId)?.name
  const limite = limiteDeTimes(championship.plan)
  const vagas = vagasDeTime(championship.plan, teams.length)
  const semVagas = vagas <= 0
  const grouped = championship.format === 'groups_knockout'
  const numGroups = Math.max(1, championship.numGroups ?? 2)

  // Busca por nome do time, responsável ou grupo ("grupo b" / "b").
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return daCategoria
    return daCategoria.filter((t) =>
      [t.name, t.coach, t.phone, t.group, t.group ? `grupo ${t.group}` : '']
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    )
  }, [daCategoria, search])

  /**
   * Sorteia os grupos DESTA categoria.
   *
   * O grupo é da inscrição, não do clube: o mesmo Leões pode cair no A do
   * Sub-11 e no C do Sub-15, e sortear uma categoria não pode desmanchar a
   * outra.
   */
  async function drawGroups() {
    if (daCategoria.length < 2) {
      alert('Cadastre ao menos 2 times para sortear os grupos.')
      return
    }
    const onde = catNome ? ` do ${catNome}` : ''
    if (!confirm(`Sortear ${daCategoria.length} time(s)${onde} em ${numGroups} grupo(s)? Isso substitui a divisão atual.`)) return
    setDrawing(true)
    try {
      const labels = Array.from({ length: numGroups }, (_, i) => String.fromCharCode(65 + i))
      // Embaralhamento Fisher–Yates.
      const shuffled = [...daCategoria]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      // Distribui em rodízio (serpentina) para equilibrar os grupos.
      await Promise.all(
        shuffled.map((t, idx) => {
          const grupo = labels[idx % numGroups]
          const original = teams.find((x) => x.id === t.id)
          return categoryId
            ? setTeamCategories(
                t.id,
                championship.id,
                (original?.categoryIds ?? [categoryId]).map((c) => ({
                  categoryId: c,
                  group: c === categoryId ? grupo : original?.groupByCategory?.[c],
                })),
              )
            : updateTeam(t.id, { group: grupo })
        }),
      )
      onChange()
    } catch {
      alert('Não foi possível sortear os grupos agora.')
    } finally {
      setDrawing(false)
    }
  }

  async function remove(team: Team) {
    if (!confirm(`Remover o time "${team.name}"? Os jogadores e resultados vinculados também serão afetados.`)) return
    await deleteTeam(team.id)
    onChange()
  }

  async function copyInviteLink(team: Team) {
    try {
      const token = await ensureTeamToken(team.id)
      const url = `${location.origin}/t/${team.id}?k=${token}`
      await navigator.clipboard?.writeText(url).catch(() => {})
      window.prompt(
        `Link de inscrição de ${team.name}\n\nEnvie ao representante do time — ele poderá incluir o escudo e os atletas:`,
        url,
      )
    } catch {
      alert('Não foi possível gerar o link agora.')
    }
  }

  /**
   * Link de criação de time.
   *
   * Sem categoria: o link é ABERTO — o responsável escolhe em quais categorias
   * inscreve o clube. Com categoria: o link já vem direcionado, e o time entra
   * direto nela. Mandar o link certo para o time certo evita que quem só tem
   * equipe de Sub-13 sequer veja a opção do Sub-17.
   */
  async function copyCreateTeamLink(categoryId?: string) {
    try {
      const token = categoryId
        ? await ensureChampCategoryToken(championship.id, [categoryId])
        : await ensureChampTeamToken(championship.id)
      const url = `${location.origin}/novo-time/${championship.id}?k=${token}`
      const cat = championship.categories.find((c) => c.id === categoryId)
      await navigator.clipboard?.writeText(url).catch(() => {})
      window.prompt(
        cat
          ? `Link de criação de time — ${cat.name}\n\nQuem abrir este link entra direto nesta categoria:`
          : 'Link para CRIAÇÃO de time (todas as categorias)\n\nEnvie ao responsável — ele escolhe em quais categorias inscreve o clube, define o escudo, os gestores e os atletas:',
        url,
      )
    } catch (e) {
      alert((e as Error)?.message || 'Não foi possível gerar o link agora.')
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <div>
          <h2>
            {catNome ? `Times · ${catNome}` : 'Times'} ({daCategoria.length}
            {Number.isFinite(limite) && !catNome ? ` de ${limite}` : ''})
          </h2>
          <p className="muted">
            {catNome
              ? `Clubes inscritos no ${catNome}. Cada categoria tem os seus — o clube entra pela inscrição.`
              : 'Cadastre os clubes participantes do campeonato.'}
            {Number.isFinite(limite) && !semVagas && ` Restam ${vagas} vaga(s) no plano ${planOf(championship.plan).tier}.`}
          </p>
        </div>
        <div className="panel__head-actions">
          {grouped && (
            <Button variant="ghost" onClick={() => void drawGroups()} disabled={drawing}>
              {drawing ? 'Sorteando…' : '🎲 Sortear grupos'}
            </Button>
          )}
          <Button variant="soft" onClick={() => void copyCreateTeamLink()} disabled={semVagas}>
            🔗 Link para criar time
          </Button>
          <Button onClick={() => setAdding(true)} disabled={semVagas}>＋ Adicionar time</Button>
        </div>
      </div>

      {/* Com mais de uma categoria, cada uma pode ter o seu link direcionado. */}
      {championship.categories.length > 1 && !semVagas && (
        <div className="cat-links">
          <span className="cat-links__label">Link só de uma categoria:</span>
          {championship.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className="cat-links__btn"
              onClick={() => void copyCreateTeamLink(c.id)}
            >
              🔗 {c.name}
            </button>
          ))}
        </div>
      )}

      {semVagas && (
        <p className="plano-cheio">
          🚫 {motivoLimiteDeTimes(championship.plan)}{' '}
          <a href="/planos" target="_blank" rel="noopener noreferrer">Ver planos</a>
        </p>
      )}

      {daCategoria.length > 0 && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Buscar time por nome, responsável ou grupo…"
          count={visible.length}
          total={daCategoria.length}
          noun="time"
        />
      )}

      {daCategoria.length === 0 ? (
        <EmptyState icon="🛡️" title="Nenhum time cadastrado">
          <p>Adicione os times para depois gerar a tabela de jogos.</p>
        </EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState icon="🔎" title="Nenhum time encontrado">
          <p>Nenhum time corresponde a “{search}”.</p>
          <Button variant="soft" onClick={() => setSearch('')}>Limpar busca</Button>
        </EmptyState>
      ) : (
        <div className="team-grid">
          {visible.map((t) => (
            <div key={t.id} className="team-item">
              <span className="team-item__badge"><TeamBadge team={t} size={44} /></span>
              <div className="team-item__info">
                <strong title={t.name}>{t.name}</strong>
                <span className="team-item__meta">
                  {t.coach ? `Resp. ${t.coach}` : 'Sem responsável'}
                  {t.phone ? ` · ${t.phone}` : ''}
                </span>
                {grouped && t.group && <span className="team-item__group">Grupo {t.group}</span>}
              </div>
              <div className="team-item__actions">
                <button className="icon-btn" title="Copiar link de inscrição" onClick={() => void copyInviteLink(t)}>🔗</button>
                <button className="icon-btn" title="Gestores e senhas" onClick={() => setManaging(t)}>🔑</button>
                <button className="icon-btn" title="Editar" onClick={() => setEditing(t)}>✎</button>
                <button className="icon-btn icon-btn--danger" title="Remover" onClick={() => void remove(t)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <TeamForm
          championship={championship}
          teams={teams}
          categoryId={categoryId}
          initial={editing ?? undefined}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSaved={() => {
            setAdding(false)
            setEditing(null)
            onChange()
          }}
        />
      )}

      {managing && (
        <ManagersModal team={managing} onClose={() => setManaging(null)} />
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Gestores do time (senhas) — visão do administrador                          */
/* -------------------------------------------------------------------------- */
function ManagersModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const [managers, setManagers] = useState<TeamManager[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setManagers(await listTeamManagers(team.id))
    } catch {
      setError('Não foi possível carregar os gestores.')
      setManagers([])
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id])

  async function reset(m: TeamManager) {
    if (!confirm(`Zerar a senha de "${m.username}"?\n\nEle perde o acesso pela página inicial e criará uma nova senha no próximo acesso pelo link de inscrição.`)) return
    setBusy(m.username)
    setError(null)
    try {
      await resetTeamManagerPassword(team.id, m.username)
      await load()
    } catch {
      setError('Não foi possível zerar a senha agora.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title={`Gestores — ${team.name}`} onClose={onClose}>
      <p className="muted">
        Zere a senha de um gestor que a esqueceu. Ele entrará pelo <b>link de inscrição</b> com o
        mesmo e-mail e criará uma nova senha — a redefinição não passa pela página inicial, para
        que ninguém entre no time só sabendo o endereço de e-mail do gestor.
      </p>
      {managers === null ? (
        <div className="pad-lg center"><Spinner /></div>
      ) : managers.length === 0 ? (
        <EmptyState icon="👤" title="Nenhum gestor cadastrado">
          <p>Este time ainda não tem acesso criado. Envie o link de inscrição para o responsável criar a conta com o e-mail dele.</p>
        </EmptyState>
      ) : (
        <ul className="manager-list">
          {managers.map((m) => (
            <li key={m.username} className="manager-list__item" style={{ justifyContent: 'space-between' }}>
              <span>👤 {m.username} {m.reset && <span className="muted small">· senha zerada</span>}</span>
              <Button variant="soft" type="button" disabled={busy === m.username || m.reset} onClick={() => void reset(m)}>
                {busy === m.username ? 'Zerando…' : m.reset ? 'Aguardando nova senha' : '🔑 Zerar senha'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="auth-error">{error}</p>}
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  )
}

function TeamForm({
  championship,
  teams,
  categoryId,
  initial,
  onClose,
  onSaved,
}: {
  championship: Championship
  teams: Team[]
  /** Categoria aberta na aba — é a escolha que já vem marcada. */
  categoryId?: string
  initial?: Team
  onClose: () => void
  onSaved: () => void
}) {
  const cats = championship.categories
  /** Mais de uma categoria = mais de uma competição, e é preciso perguntar. */
  const varias = cats.length > 1

  const [name, setName] = useState(initial?.name ?? '')
  const [logo, setLogo] = useState(initial?.logo ?? '')
  const [color, setColor] = useState(initial?.color ?? '#2563eb')
  const [coach, setCoach] = useState(initial?.coach ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [group, setGroup] = useState(initial?.group ?? 'A')

  /**
   * Em quais categorias o clube joga.
   *
   * Editando, vem das inscrições que ele já tem — e o clube ANTIGO, sem
   * inscrição nenhuma, aparece hoje em todas as abas; abrir a edição já
   * marcando todas é dizer na tela o que o app faz por baixo, sem tirá-lo de
   * lugar nenhum ao salvar.
   */
  const [escolhidas, setEscolhidas] = useState<string[]>(() => {
    if (!varias) return []
    if (initial) {
      const suas = (initial.categoryIds ?? []).filter((id) => cats.some((c) => c.id === id))
      return suas.length ? suas : cats.map((c) => c.id)
    }
    return categoryId ? [categoryId] : []
  })
  /** O grupo do clube EM CADA categoria — ele pode cair no A de uma e no C de outra. */
  const [grupos, setGrupos] = useState<Record<string, string>>(() => ({
    ...(initial?.groupByCategory ?? {}),
  }))

  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const grouped = championship.format === 'groups_knockout'

  /** A estrutura de grupos é de cada categoria: número e meta podem diferir. */
  const estrutura = (cat?: string) => {
    const c = cat ? competicaoDaCategoria(championship, cat) : championship
    return {
      target: c.teamsPerGroup,
      options: Array.from({ length: Math.max(1, c.numGroups ?? 2) }, (_, i) =>
        String.fromCharCode(65 + i),
      ),
    }
  }
  /** Quantos clubes já estão neste grupo DESTA categoria (fora o que se edita). */
  const countIn = (g: string, cat?: string) =>
    elencoDeTimes(teams, cat).filter((t) => t.group === g && t.id !== initial?.id).length
  const grupoDe = (cat: string) => grupos[cat] ?? initial?.group ?? 'A'

  function alternar(id: string) {
    setEscolhidas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    )
    setErro(null)
  }

  async function onLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setLogo(await fileToDataUrl(file, 256))
      setLogoError(null)
    } catch {
      setLogoError('Não foi possível carregar a imagem.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)

    // Sem categoria não há competição em que inscrever o clube — e um clube
    // sem inscrição reapareceria em todas as abas, que é o contrário do que a
    // separação por categoria promete.
    if (varias && escolhidas.length === 0) {
      setErro('Escolha ao menos uma categoria para inscrever o time.')
      return
    }

    // Aviso (não bloqueia) se algum grupo atingiu a meta de times.
    if (grouped) {
      const alvos = varias ? escolhidas : [undefined]
      for (const cat of alvos) {
        const g = cat ? grupoDe(cat) : group
        const { target } = estrutura(cat)
        const quantos = countIn(g, cat)
        if (!target || quantos < target) continue
        const onde = cat ? ` do ${cats.find((c) => c.id === cat)?.name}` : ''
        if (!confirm(`O Grupo ${g}${onde} já tem ${quantos} time(s) (meta: ${target}). Adicionar mesmo assim?`)) return
      }
    }

    setBusy(true)
    const inscricoes = escolhidas.map((c) => ({
      categoryId: c,
      group: grouped ? grupoDe(c) : undefined,
    }))
    const payload: NewTeam = {
      championshipId: championship.id,
      name: name.trim(),
      logo,
      color,
      coach: coach.trim() || undefined,
      phone: phone.trim() || undefined,
      // O `group` do clube segue existindo como reserva (dado antigo e
      // campeonato de categoria única); quem manda é o grupo da inscrição.
      group: grouped ? (varias ? grupoDe(escolhidas[0]) : group) : undefined,
      categoryIds: varias ? escolhidas : undefined,
      groupByCategory: varias && grouped
        ? Object.fromEntries(inscricoes.map((i) => [i.categoryId, i.group as string]))
        : undefined,
    }
    try {
      if (initial) {
        await updateTeam(initial.id, payload)
        // `updateTeam` só mexe na ficha do clube: as inscrições são outra
        // tabela, e é esta chamada que as reescreve.
        if (varias) await setTeamCategories(initial.id, championship.id, inscricoes)
      } else {
        await createTeam(payload)
      }
      onSaved()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar o time.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? 'Editar time' : 'Adicionar time'} onClose={onClose}>
      <form onSubmit={submit} className="form-grid">
        <div className="team-form__preview">
          <TeamBadge team={{ name, logo, color }} size={56} />
          <span>{name || 'Prévia do escudo'}</span>
        </div>
        <Field label="Nome do time">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Leões FC" required />
        </Field>
        <Field label="Escudo do time" hint="Envie a imagem do brasão (PNG/JPG/SVG). Sem imagem, usamos as iniciais do nome e a cor.">
          <div className="team-logo-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogoUpload} />
            <Button variant="soft" type="button" onClick={() => fileRef.current?.click()}>⬆ Enviar escudo</Button>
            {logo?.startsWith('data:') && (
              <button type="button" className="link-btn" onClick={() => setLogo('')}>remover imagem</button>
            )}
          </div>
          {logoError && <p className="hint" style={{ color: 'var(--danger)' }}>{logoError}</p>}
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
        {/* Cada categoria é uma competição — tabela, rodadas e classificados
            próprios. É aqui que o organizador diz em quais o clube disputa. */}
        {varias && (
          <div className="cat-pick">
            <span className="field__label">Em quais categorias o time vai jogar?</span>
            <p className="field__hint">
              Cada categoria é uma competição separada. Marque todas em que o clube inscreve equipe —
              o escudo, o responsável e o login são os mesmos.
            </p>
            <div className="cat-pick__list">
              {cats.map((c) => (
                <label key={c.id} className={`cat-pick__item ${escolhidas.includes(c.id) ? 'is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={escolhidas.includes(c.id)}
                    onChange={() => alternar(c.id)}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {grouped && !varias && (
          <Field
            label="Grupo"
            hint={estrutura().target ? `Meta: ${estrutura().target} time(s) por grupo` : undefined}
          >
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              {estrutura().options.map((g) => (
                <option key={g} value={g}>
                  Grupo {g}{estrutura().target ? ` (${countIn(g)}/${estrutura().target})` : ` (${countIn(g)})`}
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* O grupo é da INSCRIÇÃO: o mesmo clube pode cair no A do Sub-11 e no
            C do Sub-15, e cada categoria pode ter um número de grupos. */}
        {grouped && varias && escolhidas.length > 0 && (
          <div className="cat-grupos">
            <span className="field__label">Grupo em cada categoria</span>
            {cats
              .filter((c) => escolhidas.includes(c.id))
              .map((c) => {
                const { target, options } = estrutura(c.id)
                return (
                  <label key={c.id} className="cat-grupos__item">
                    <span className="cat-grupos__cat">{c.name}</span>
                    <select
                      value={grupoDe(c.id)}
                      onChange={(e) => setGrupos((g) => ({ ...g, [c.id]: e.target.value }))}
                    >
                      {options.map((g) => (
                        <option key={g} value={g}>
                          Grupo {g}{target ? ` (${countIn(g, c.id)}/${target})` : ` (${countIn(g, c.id)})`}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
          </div>
        )}

        {erro && <p className="auth-error">{erro}</p>}
        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
