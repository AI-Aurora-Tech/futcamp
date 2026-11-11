// ===========================================================================
// Edge Function: validate-athlete
//
// Valida os dados do atleta antes da inscrição:
//   • CPF — dígitos verificadores (offline, sempre).
//   • CPF × data de nascimento — consulta a um provedor externo de "consulta
//     CPF" (opcional), mantendo a chave secreta no servidor.
//
// Contrato de resposta (JSON):
//   { ok: boolean, status: 'valid'|'unverified'|'invalid_cpf'|'mismatch'|'error',
//     message: string, name?: string }
//
// Configuração do provedor (Supabase → Project Settings → Edge Functions →
// Secrets). Se CPF_API_URL não estiver definido, a função valida só o CPF e
// responde "unverified".
//   CPF_API_URL          URL do provedor (POST JSON).
//   CPF_API_TOKEN        Token/chave do provedor.
//   CPF_API_AUTH_HEADER  Header de autenticação (padrão: "Authorization").
//   CPF_API_AUTH_PREFIX  Prefixo do valor (padrão: "Bearer ").
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function toBR(birthdate: string): string {
  // yyyy-mm-dd -> dd/mm/yyyy
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : birthdate
}

/** Consulta o provedor externo (se configurado) e interpreta o resultado. */
async function queryProvider(cpf: string, birthdate: string) {
  const url = Deno.env.get('CPF_API_URL')
  if (!url) return null

  const token = Deno.env.get('CPF_API_TOKEN') ?? ''
  const header = Deno.env.get('CPF_API_AUTH_HEADER') ?? 'Authorization'
  const prefix = Deno.env.get('CPF_API_AUTH_PREFIX') ?? 'Bearer '

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [header]: `${prefix}${token}`,
    },
    body: JSON.stringify({
      cpf,
      birthdate, // yyyy-mm-dd
      dataNascimento: toBR(birthdate), // dd/mm/yyyy (comum em provedores BR)
    }),
  })

  if (!res.ok) {
    return { ok: true, status: 'error', message: `Provedor indisponível (HTTP ${res.status}).` }
  }

  const data = await res.json().catch(() => ({}))

  // Heurística tolerante a diferentes contratos de provedores.
  const explicit = data.valid ?? data.match ?? data.matches
  const statusStr = String(data.status ?? data.situacao ?? data.situacaoCadastral ?? '').toLowerCase()
  const name = data.name ?? data.nome ?? undefined

  let matched: boolean | undefined = typeof explicit === 'boolean' ? explicit : undefined
  if (matched === undefined && statusStr) {
    matched = /regular|ativ|ok|válid|valid/.test(statusStr)
  }
  // Se o provedor devolveu a data de nascimento, confirma que bate.
  const provBirth = data.birthdate ?? data.nascimento ?? data.dataNascimento
  if (matched !== false && provBirth) {
    const a = String(provBirth).replace(/\D/g, '')
    const b = birthdate.replace(/\D/g, '')
    const bBR = toBR(birthdate).replace(/\D/g, '')
    if (!(a === b || a === bBR)) matched = false
  }

  if (matched === true) {
    return { ok: true, status: 'valid', message: 'CPF confirmado e compatível com a data de nascimento.', name }
  }
  if (matched === false) {
    return { ok: false, status: 'mismatch', message: 'O CPF não corresponde à data de nascimento informada.', name }
  }
  return { ok: true, status: 'unverified', message: 'CPF válido; provedor não confirmou a data de nascimento.', name }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, status: 'error', message: 'Método não suportado.' }, 405)

  let cpf = ''
  let birthdate = ''
  try {
    const body = await req.json()
    cpf = String(body.cpf ?? '')
    birthdate = String(body.birthdate ?? '')
  } catch {
    return json({ ok: false, status: 'error', message: 'Corpo inválido.' }, 400)
  }

  const digits = cpf.replace(/\D/g, '')
  if (!isValidCpf(digits)) {
    return json({ ok: false, status: 'invalid_cpf', message: 'CPF inválido (dígitos verificadores não conferem).' })
  }

  try {
    const provider = await queryProvider(digits, birthdate)
    if (provider) return json(provider)
  } catch (_e) {
    return json({ ok: true, status: 'error', message: 'Falha ao consultar o provedor; CPF válido localmente.' })
  }

  return json({ ok: true, status: 'unverified', message: 'CPF válido. Verificação oficial não configurada.' })
})
