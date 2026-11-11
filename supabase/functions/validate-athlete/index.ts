// ===========================================================================
// Edge Function: validate-athlete
//
// Consulta CPF + data de nascimento na Receita Federal (via provedor) e, se
// tudo bater, devolve o nome oficial do atleta.
//
//   • CPF — dígitos verificadores (offline, sempre).
//   • Receita — provedor escolhido em CPF_PROVIDER (chave fica no servidor).
//   • Consulta confirmada é gravada em `cpf_verifications`; é ela que faz o
//     banco marcar o atleta como validado (migration 0058).
//
// Resposta (JSON):
//   { ok: boolean, status: 'valid'|'unverified'|'invalid_cpf'|
//     'invalid_birthdate'|'mismatch'|'error', message: string, name?: string }
//
// Secrets (Supabase → Project Settings → Edge Functions → Secrets):
//   CPF_PROVIDER         'infosimples' | 'mock' | 'generic' (padrão: generic
//                        se CPF_API_URL existir; senão, sem consulta).
//   CPF_API_TOKEN        Token do provedor (infosimples / generic).
//   CPF_API_URL          Só no 'generic': URL que recebe POST JSON.
//   CPF_API_AUTH_HEADER  Só no 'generic' (padrão "Authorization").
//   CPF_API_AUTH_PREFIX  Só no 'generic' (padrão "Bearer ").
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (injetados automaticamente)
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Status = 'valid' | 'unverified' | 'invalid_cpf' | 'invalid_birthdate' | 'mismatch' | 'error'
interface Result {
  ok: boolean
  status: Status
  message: string
  name?: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/** Valida os dígitos verificadores do CPF. */
function isValidCpf(value: string): boolean {
  const d = (value ?? '').replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}

/** yyyy-mm-dd -> dd/mm/yyyy */
function toBR(birthdate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : birthdate
}

/** A data devolvida pelo provedor é a mesma informada? (aceita dd/mm/yyyy ou yyyy-mm-dd) */
function sameDate(provided: unknown, birthdate: string): boolean {
  const a = String(provided ?? '').replace(/\D/g, '')
  return a === birthdate.replace(/\D/g, '') || a === toBR(birthdate).replace(/\D/g, '')
}

const CONFIRMADO = 'Dados conferidos na Receita Federal.'
const NAO_CONFERE = 'A Receita não confirmou este CPF com esta data de nascimento.'

// ---------------------------------------------------------------------------
// Provedores
// ---------------------------------------------------------------------------

/** Infosimples — consulta "receita-federal/cpf" (CPF + data de nascimento). */
// deno-lint-ignore no-explicit-any
async function infosimplesCall(cpf: string, birthdate: string): Promise<any> {
  const token = Deno.env.get('CPF_API_TOKEN') ?? ''
  const res = await fetch('https://api.infosimples.com/api/v2/consultas/receita-federal/cpf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, cpf, birthdate, timeout: '60' }),
  })
  const data = await res.json().catch(() => ({ code: res.status, code_message: `HTTP ${res.status}` }))
  // Só código e motivo no log — nada de nome ou documento.
  console.log('infosimples:', birthdate.includes('/') ? 'dd/mm/aaaa' : 'aaaa-mm-dd', data?.code, data?.code_message, data?.errors)
  return data
}

async function infosimples(cpf: string, birthdate: string): Promise<Result> {
  // A data vai no formato ISO; se o provedor recusar o pedido (qualquer coisa
  // que não seja "achou" ou "não achou"), tenta de novo com dd/mm/aaaa.
  let data = await infosimplesCall(cpf, birthdate)
  if (data?.code !== 200 && data?.code !== 612) data = await infosimplesCall(cpf, toBR(birthdate))

  if (data?.code !== 200) {
    const motivo = [data?.code_message, ...(Array.isArray(data?.errors) ? data.errors : [])]
      .filter(Boolean)
      .join(' — ')
    const detalhe = `código ${data?.code ?? '?'}${motivo ? `: ${motivo}` : ''}`
    if (data?.code === 612) return { ok: false, status: 'mismatch', message: `${NAO_CONFERE} (${detalhe})` }
    return { ok: false, status: 'error', message: `Não foi possível consultar a Receita agora (${detalhe}).` }
  }
  const r = Array.isArray(data.data) ? data.data[0] : data.data
  const name = String(r?.nome ?? r?.name ?? '').trim()
  if (!name) return { ok: false, status: 'error', message: 'A Receita respondeu sem o nome do titular.' }
  const nasc = r?.data_nascimento ?? r?.nascimento
  if (nasc && !sameDate(nasc, birthdate)) {
    return { ok: false, status: 'mismatch', message: `${NAO_CONFERE} (a Receita informa ${nasc})` }
  }
  return { ok: true, status: 'valid', message: CONFIRMADO, name }
}

/**
 * Modo de teste: não consulta nada. Confirma qualquer CPF válido e devolve um
 * nome fictício — exceto quem nasceu em 1º de janeiro, para testar a recusa.
 * NUNCA use em produção: marcaria atletas como validados sem consulta real.
 */
function mock(cpf: string, birthdate: string): Result {
  if (birthdate.slice(5) === '01-01') return { ok: false, status: 'mismatch', message: `${NAO_CONFERE} (modo de teste)` }
  return { ok: true, status: 'valid', message: `${CONFIRMADO} (modo de teste)`, name: `ATLETA TESTE ${cpf.slice(-4)}` }
}

/** Provedor genérico: POST JSON em CPF_API_URL, resposta interpretada por heurística. */
async function generic(cpf: string, birthdate: string): Promise<Result> {
  const url = Deno.env.get('CPF_API_URL') ?? ''
  const token = Deno.env.get('CPF_API_TOKEN') ?? ''
  const header = Deno.env.get('CPF_API_AUTH_HEADER') ?? 'Authorization'
  const prefix = Deno.env.get('CPF_API_AUTH_PREFIX') ?? 'Bearer '

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [header]: `${prefix}${token}` },
    body: JSON.stringify({ cpf, birthdate, dataNascimento: toBR(birthdate) }),
  })
  if (!res.ok) return { ok: false, status: 'error', message: `Provedor indisponível (HTTP ${res.status}).` }

  // deno-lint-ignore no-explicit-any
  const data: any = await res.json().catch(() => ({}))
  const explicit = data.valid ?? data.match ?? data.matches
  const statusStr = String(data.status ?? data.situacao ?? data.situacaoCadastral ?? '').toLowerCase()
  const name = String(data.name ?? data.nome ?? '').trim() || undefined

  let matched: boolean | undefined = typeof explicit === 'boolean' ? explicit : undefined
  if (matched === undefined && statusStr) matched = /regular|ativ|ok|válid|valid/.test(statusStr)
  const provBirth = data.birthdate ?? data.nascimento ?? data.dataNascimento
  if (matched !== false && provBirth && !sameDate(provBirth, birthdate)) matched = false

  if (matched === false) return { ok: false, status: 'mismatch', message: NAO_CONFERE }
  if (matched === true && name) return { ok: true, status: 'valid', message: CONFIRMADO, name }
  return { ok: false, status: 'error', message: 'O provedor não confirmou o nome do titular.' }
}

function provider(): ((cpf: string, birthdate: string) => Promise<Result> | Result) | null {
  const p = (Deno.env.get('CPF_PROVIDER') ?? '').toLowerCase()
  if (p === 'infosimples') return infosimples
  if (p === 'mock') return mock
  if (p === 'generic' || Deno.env.get('CPF_API_URL')) return generic
  return null
}

/** Guarda a consulta confirmada — o gatilho de `players` usa isto para marcar o atleta. */
async function registrar(cpf: string, birthdate: string, name: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return
  const db = createClient(url, key, { auth: { persistSession: false } })
  const source = (Deno.env.get('CPF_PROVIDER') ?? 'generic').toLowerCase()
  const { error } = await db
    .from('cpf_verifications')
    .upsert({ cpf, birthdate, name, source, verified_at: new Date().toISOString() })
  if (error) console.error('cpf_verifications:', error.message)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, status: 'error', message: 'Método não suportado.' }, 405)

  let cpf = ''
  let birthdate = ''
  try {
    const body = await req.json()
    cpf = String(body.cpf ?? '').replace(/\D/g, '')
    birthdate = String(body.birthdate ?? '')
  } catch {
    return json({ ok: false, status: 'error', message: 'Corpo inválido.' }, 400)
  }

  if (!isValidCpf(cpf)) {
    return json({ ok: false, status: 'invalid_cpf', message: 'CPF inválido. Confira os números digitados.' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
    return json({ ok: false, status: 'invalid_birthdate', message: 'Informe a data de nascimento.' })
  }

  const consultar = provider()
  if (!consultar) {
    return json({ ok: false, status: 'unverified', message: 'A consulta à Receita não está configurada.' })
  }

  try {
    const r = await consultar(cpf, birthdate)
    if (r.ok && r.name) await registrar(cpf, birthdate, r.name)
    // Na recusa, diz qual provedor respondeu — ajuda a achar configuração errada.
    if (!r.ok) r.message = `${r.message} [${consultar.name}]`
    return json(r)
  } catch (e) {
    console.error('validate-athlete:', e)
    return json({ ok: false, status: 'error', message: 'Não foi possível consultar a Receita agora.' })
  }
})
