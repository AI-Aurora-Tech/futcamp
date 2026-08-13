// ---------------------------------------------------------------------------
// Validação dos dados do atleta: CPF (dígitos) e coerência CPF × nascimento.
//
// Estratégia em camadas:
//   1. Validação LOCAL (offline): dígitos verificadores do CPF e plausibilidade
//      da data de nascimento. Barra erros óbvios instantaneamente.
//   2. Verificação OFICIAL (opcional): chama uma API server-side —
//      a Edge Function `validate-athlete` (Supabase) ou uma URL em
//      VITE_VALIDATION_URL — que confere CPF × data de nascimento num provedor
//      de consulta (mantendo a chave fora do navegador).
//
// Sem backend/provedor configurado, o resultado é "unverified" (aceita, mas
// avisa que a checagem oficial não foi feita).
// ---------------------------------------------------------------------------
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { isValidCpf } from '../lib/eligibility'

export type ValidationStatus =
  | 'valid' // CPF válido e conferido oficialmente (bate com a data)
  | 'unverified' // CPF/data localmente ok, sem verificação oficial
  | 'invalid_cpf' // CPF com dígitos inválidos
  | 'invalid_birthdate' // data ausente/implausível
  | 'mismatch' // CPF não corresponde à data de nascimento no provedor
  | 'error' // falha ao consultar o provedor

export interface AthleteValidation {
  ok: boolean // pode prosseguir com a inscrição?
  status: ValidationStatus
  message: string
  officialName?: string
}

const REMOTE_URL = import.meta.env.VITE_VALIDATION_URL as string | undefined

/** Plausibilidade da data de nascimento (não futura, idade 0–120). */
function birthdatePlausible(birthdate?: string): boolean {
  if (!birthdate) return false
  const d = new Date(birthdate)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  if (d > now) return false
  const age = now.getFullYear() - d.getFullYear()
  return age >= 0 && age <= 120
}

/** Valida os dados do atleta, consultando a API oficial quando disponível. */
export async function validateAthlete(
  cpf: string,
  birthdate: string,
): Promise<AthleteValidation> {
  const digits = (cpf ?? '').replace(/\D/g, '')

  // 1) Camada local
  if (!isValidCpf(digits)) {
    return { ok: false, status: 'invalid_cpf', message: 'CPF inválido (dígitos verificadores não conferem).' }
  }
  if (!birthdatePlausible(birthdate)) {
    return { ok: false, status: 'invalid_birthdate', message: 'Data de nascimento ausente ou implausível.' }
  }

  // 2) Verificação oficial (se configurada)
  try {
    const remote = await callRemote(digits, birthdate)
    if (remote) return remote
  } catch {
    // Não bloqueia a inscrição por indisponibilidade do provedor.
    return {
      ok: true,
      status: 'error',
      message: 'Não foi possível consultar a base oficial agora — CPF e data válidos localmente.',
    }
  }

  return {
    ok: true,
    status: 'unverified',
    message: 'CPF e data de nascimento válidos. Verificação oficial não configurada.',
  }
}

async function callRemote(cpf: string, birthdate: string): Promise<AthleteValidation | null> {
  // Preferência 1: URL explícita
  if (REMOTE_URL) {
    const res = await fetch(REMOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf, birthdate }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return normalize(await res.json())
  }

  // Preferência 2: Edge Function do Supabase
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.functions.invoke('validate-athlete', {
      body: { cpf, birthdate },
    })
    if (error) throw error
    return normalize(data)
  }

  return null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalize(raw: any): AthleteValidation {
  const status = (raw?.status ?? (raw?.valid ? 'valid' : 'mismatch')) as ValidationStatus
  const ok = status === 'valid' || status === 'unverified' || status === 'error'
  const fallback: Record<ValidationStatus, string> = {
    valid: 'CPF confirmado e compatível com a data de nascimento.',
    unverified: 'CPF e data válidos (sem verificação oficial).',
    invalid_cpf: 'CPF inválido.',
    invalid_birthdate: 'Data de nascimento inválida.',
    mismatch: 'O CPF não corresponde à data de nascimento informada.',
    error: 'Falha ao consultar a base oficial.',
  }
  return {
    ok: raw?.ok ?? ok,
    status,
    message: raw?.message ?? fallback[status] ?? 'Resultado de validação.',
    officialName: raw?.name ?? raw?.officialName,
  }
}
