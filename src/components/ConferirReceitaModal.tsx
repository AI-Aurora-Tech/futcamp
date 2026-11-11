import { useState } from 'react'
import { formatCpf } from '../lib/eligibility'
import { confirmCpfReceita } from '../services/players'
import type { Player } from '../types'
import { Button, Modal } from './ui'

/** Página oficial "Situação Cadastral do CPF" (com captcha — a conferência é feita por uma pessoa). */
export const RECEITA_URL =
  'https://servicos.receita.fazenda.gov.br/servicos/cpf/consultasituacao/consultapublica.asp'

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

/**
 * O organizador confere o atleta no site da Receita e confirma no app.
 * Gratuito: quem resolve o captcha e compara o nome é uma pessoa.
 */
export function ConferirReceitaModal({
  player,
  onClose,
  onValidated,
}: {
  player: Player
  onClose: () => void
  onValidated: () => void
}) {
  const cpf = formatCpf(player.cpf ?? '')
  const nasc = player.birthdate ? player.birthdate.split('-').reverse().join('/') : ''
  const [copiado, setCopiado] = useState<'cpf' | 'nasc' | null>(null)
  const [confere, setConfere] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function copy(qual: 'cpf' | 'nasc') {
    if (await copiar(qual === 'cpf' ? cpf.replace(/\D/g, '') : nasc)) setCopiado(qual)
  }

  function abrirReceita() {
    void copy('cpf')
    window.open(RECEITA_URL, '_blank', 'noopener')
  }

  async function validar() {
    setError(null)
    setBusy(true)
    try {
      await confirmCpfReceita(player.id)
      onValidated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível validar o atleta.')
    } finally {
      setBusy(false)
    }
  }

  if (!player.cpf || !player.birthdate) {
    return (
      <Modal title="Conferir na Receita" onClose={onClose}>
        <p>Para conferir na Receita, o atleta precisa ter <b>CPF</b> e <b>data de nascimento</b>. Edite o cadastro e tente de novo.</p>
        <div className="form-actions">
          <Button type="button" onClick={onClose}>Entendi</Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Conferir na Receita" onClose={onClose}>
      <div className="form-grid">
        <ol className="receita-steps">
          <li>Toque em <b>Abrir site da Receita</b>. O CPF já vai copiado.</li>
          <li>Cole o CPF, informe a data de nascimento e resolva o captcha.</li>
          <li>Confira se o nome que a Receita mostra é <b>igual</b> ao abaixo.</li>
        </ol>

        <div className="receita-dados">
          <div className="receita-dado">
            <span className="receita-dado__label">Nome no Tabelaço</span>
            <span className="receita-dado__valor strong">{player.name}</span>
          </div>
          <div className="receita-dado">
            <span className="receita-dado__label">CPF</span>
            <span className="receita-dado__valor">{cpf}</span>
            <button type="button" className="link-btn" onClick={() => void copy('cpf')}>
              {copiado === 'cpf' ? '✓ copiado' : 'copiar'}
            </button>
          </div>
          <div className="receita-dado">
            <span className="receita-dado__label">Nascimento</span>
            <span className="receita-dado__valor">{nasc}</span>
            <button type="button" className="link-btn" onClick={() => void copy('nasc')}>
              {copiado === 'nasc' ? '✓ copiado' : 'copiar'}
            </button>
          </div>
        </div>

        <Button type="button" variant="soft" onClick={abrirReceita}>🔎 Abrir site da Receita</Button>

        <label className="check">
          <input type="checkbox" checked={confere} onChange={(e) => setConfere(e.target.checked)} />
          <span>Conferi no site da Receita: o <b>nome</b>, o <b>CPF</b> e a <b>data de nascimento</b> batem.</span>
        </label>
        <p className="muted small">
          Nome diferente (abreviado, com erro)? Corrija o cadastro do atleta em ✎ Editar antes de validar.
        </p>

        {error && <p className="auth-error">{error}</p>}

        <div className="form-actions">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={!confere || busy} onClick={() => void validar()}>
            {busy ? 'Validando…' : '✓ Validar atleta'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
