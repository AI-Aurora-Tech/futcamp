// ===========================================================================
// Edge Function: assinaturas-varrer
//
// A carência vence pelo RELÓGIO, e relógio nenhum dispara gatilho no banco.
// Esta função existe só para dar o empurrão: chama `assinaturas_varrer()`,
// que
//
//   • encerra a assinatura cuja carência de 7 dias estourou e FECHA os
//     campeonatos Diamante que dependiam dela;
//   • encerra, sem fechar nada, a assinatura que cumpriu os meses combinados.
//
// Sem este agendamento, um cliente que parou de pagar continuaria com os
// campeonatos abertos até o Asaas mandar alguma outra notificação — que pode
// nunca vir, já que assinatura cancelada para de gerar cobrança.
//
// ⚠️ AGENDE UMA VEZ POR DIA (Supabase → Edge Functions → Schedules).
//    A carência é contada em dias; rodar de hora em hora só gastaria chamada.
//
// Secrets: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (injetados automaticamente).
//
// Publique com --no-verify-jwt:
//   supabase functions deploy assinaturas-varrer --no-verify-jwt
// ===========================================================================
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const VERSAO = '1'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'GET') return json({ ok: true, versao: VERSAO })

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const { data, error } = await db.rpc('assinaturas_varrer')
  if (error) {
    console.error('assinaturas-varrer:', error.message)
    return json({ ok: false, error: error.message, versao: VERSAO }, 500)
  }

  const encerradas = Number(data) || 0
  if (encerradas > 0) console.log(`assinaturas-varrer: ${encerradas} assinatura(s) encerrada(s)`)
  return json({ ok: true, encerradas, versao: VERSAO })
})
