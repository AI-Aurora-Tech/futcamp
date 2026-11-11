import { useState } from 'react'
import { formatCpf } from '../lib/eligibility'
import { validateAthlete } from '../services/validation'
import type { Player } from '../types'
import { Button, Field, VerifiedTag } from './ui'

/**
 * Identificação do atleta pela Receita Federal: CPF + nascimento primeiro, e o
 * nome vem da Receita. Se algo não bater, pergunta se quer cadastrar
 * manualmente. Usado no link de inscrição do time e no painel do organizador.
 *
 *   idle    → ainda não consultou (atleta novo vê só CPF e data)
 *   ok      → Receita confirmou; o nome vem dela e fica travado
 *   failed  → algo deu errado; pergunta se quer cadastrar manualmente
 *   manual  → cadastro manual, sem o selo de validado
 */
export function useReceitaLookup(initial: Player | undefined, isAthlete: boolean) {
  const [name, setName] = useState(initial?.name ?? '')
  const [cpf, setCpf] = useState(initial?.cpf ? formatCpf(initial.cpf) : '')
  const [birthdate, setBirthdate] = useState(initial?.birthdate ?? '')
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'ok' | 'failed' | 'manual'>(
    initial ? (initial.cpfVerified ? 'ok' : 'manual') : 'idle',
  )
  const [msg, setMsg] = useState('')
  const [fixable, setFixable] = useState(false)
  const [semConsulta, setSemConsulta] = useState(false)

  /** Atleta novo ainda sem consulta (ou com consulta recusada): o resto do formulário espera. */
  const precisaConsultar = isAthlete && !initial && lookup !== 'ok' && lookup !== 'manual'

  // Mexeu no CPF ou na data depois da consulta: o nome da Receita não vale mais.
  function docChanged() {
    if (lookup === 'ok' && !initial) setName('')
    if (lookup === 'ok' || lookup === 'failed') setLookup(initial ? 'manual' : 'idle')
  }

  async function consultar() {
    setLookup('loading')
    const r = await validateAthlete(cpf, birthdate)
    if (r.ok && r.officialName) {
      setName(r.officialName)
      setMsg(r.message)
      setLookup('ok')
      return
    }
    if (!initial) setName('')
    // Sem consulta automática configurada: nada a perguntar, segue no manual.
    if (r.status === 'unverified') {
      setMsg('')
      setLookup('manual')
      setSemConsulta(true)
      return
    }
    // CPF com dígito errado ou data vazia: é só corrigir, não cabe cadastro manual.
    setFixable(r.status === 'invalid_cpf' || r.status === 'invalid_birthdate')
    setMsg(r.message)
    setLookup('failed')
  }

  /** CPF, data, aviso da consulta e nome — no lugar dos campos antigos. */
  function campos({ cpfLabel, cpfRequired }: { cpfLabel?: string; cpfRequired?: boolean } = {}) {
    return (
      <>
        <div className="form-row">
          <Field label={cpfLabel ?? 'CPF'}>
            <input
              value={cpf}
              onChange={(e) => {
                setCpf(formatCpf(e.target.value))
                docChanged()
              }}
              placeholder="000.000.000-00"
              inputMode="numeric"
              required={cpfRequired}
            />
          </Field>
          <Field label={isAthlete || cpfRequired ? 'Data de nascimento' : 'Data de nascimento (opcional)'}>
            <input
              type="date"
              value={birthdate}
              onChange={(e) => {
                setBirthdate(e.target.value)
                docChanged()
              }}
              required={isAthlete && cpfRequired}
            />
          </Field>
        </div>

        {precisaConsultar && lookup !== 'failed' && (
          <p className="muted small">
            Informe o CPF e a data de nascimento do atleta. O nome é buscado na Receita Federal.
          </p>
        )}

        {isAthlete && lookup === 'failed' && (
          <div className="lookup-box lookup-box--warn" role="alert">
            <p>⚠️ {msg}</p>
            {!fixable && (
              <>
                <p className="strong">Deseja cadastrar este atleta manualmente?</p>
                <div className="lookup-box__actions">
                  <Button type="button" onClick={() => setLookup('manual')}>Sim, cadastrar manualmente</Button>
                </div>
              </>
            )}
          </div>
        )}

        {isAthlete && !initial && semConsulta && lookup === 'manual' && (
          <p className="muted small">
            ℹ️ Digite o nome completo. O organizador pode validar o atleta depois, conferindo na Receita.
          </p>
        )}

        {isAthlete && initial && lookup === 'manual' && (
          <button type="button" className="link-btn" onClick={() => void consultar()}>
            🔎 Consultar CPF na Receita
          </button>
        )}

        {!precisaConsultar &&
          (isAthlete && lookup === 'ok' ? (
            <Field label="Nome completo (Receita Federal)">
              <div className="lookup-name">
                <input value={name} readOnly />
                <VerifiedTag />
              </div>
              <button type="button" className="link-btn" onClick={() => setLookup('manual')}>
                editar o nome manualmente (o atleta deixa de ser validado)
              </button>
            </Field>
          ) : (
            <Field label="Nome completo">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" required />
            </Field>
          ))}
      </>
    )
  }

  /** Enquanto falta consultar, o botão principal consulta em vez de salvar. */
  function botaoConsultar() {
    return (
      <Button type="submit" disabled={lookup === 'loading' || !cpf || !birthdate}>
        {lookup === 'loading' ? 'Consultando a Receita…' : '🔎 Consultar na Receita'}
      </Button>
    )
  }

  return { name, cpf, birthdate, lookup, precisaConsultar, consultar, campos, botaoConsultar }
}
