// ---------------------------------------------------------------------------
// Leitura dos campeonatos pelo servidor, direto na API REST do Supabase.
//
// Não usa `@supabase/supabase-js` de propósito: aqui só é preciso um GET com a
// chave anônima, e a política de RLS `championships_read ... using (true)` já
// libera a leitura pública — é exatamente o mesmo acesso que qualquer visitante
// do site tem. Um `fetch` resolve, e a função serverless fica sem dependência
// nenhuma para instalar e sem cold start extra.
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''

/** Falso quando o backend não está configurado (modo demo). */
export const backendConfigurado = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export type CampeonatoDb = {
  id: string
  name: string
  sport: string
  format: string
  season: string | null
  status: string
  description: string | null
}

export type TimeDb = { id: string; name: string }

export type PartidaDb = {
  id: string
  status: string
  scheduled_at: string | null
  round: number
  home_team_id: string | null
  away_team_id: string | null
  home_score: number | null
  away_score: number | null
}

/**
 * GET na API REST do Supabase, com teto de tempo.
 *
 * O limite existe porque isto roda no caminho da resposta ao robô: é melhor
 * entregar a página sem os dados do que segurar o Googlebot esperando. Falha
 * de rede devolve `null` e quem chamou decide o que fazer.
 */
async function rest<T>(caminho: string, timeoutMs = 2500): Promise<T | null> {
  if (!backendConfigurado) return null
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const resposta = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
      signal: abort.signal,
    })
    if (!resposta.ok) return null
    return (await resposta.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Um campeonato pelo id. `null` quando não existe ou o banco não respondeu. */
export async function buscarCampeonato(id: string): Promise<CampeonatoDb | null> {
  const campo = 'id,name,sport,format,season,status,description'
  const linhas = await rest<CampeonatoDb[]>(
    `championships?id=eq.${encodeURIComponent(id)}&select=${campo}&limit=1`,
  )
  return linhas?.[0] ?? null
}

export async function listarTimes(championshipId: string): Promise<TimeDb[]> {
  const linhas = await rest<TimeDb[]>(
    `teams?championship_id=eq.${encodeURIComponent(championshipId)}&select=id,name&order=name`,
  )
  return linhas ?? []
}

export async function listarPartidas(championshipId: string): Promise<PartidaDb[]> {
  const campo = 'id,status,scheduled_at,round,home_team_id,away_team_id,home_score,away_score'
  const linhas = await rest<PartidaDb[]>(
    `matches?championship_id=eq.${encodeURIComponent(championshipId)}&select=${campo}&order=scheduled_at.asc.nullslast&limit=500`,
  )
  return linhas ?? []
}

/**
 * Campeonatos que entram no sitemap.
 *
 * Só `active` e `finished`: um campeonato em rascunho é um esboço do
 * organizador, ainda sem times nem jogos. Mandar isso para o Google seria
 * pedir para indexar página vazia — o que derruba a avaliação do site inteiro,
 * não só a daquela página.
 */
export async function listarCampeonatosPublicos(): Promise<{ id: string; status: string }[]> {
  const linhas = await rest<{ id: string; status: string }[]>(
    'championships?status=in.(active,finished)&select=id,status&order=created_at.desc&limit=5000',
    5000,
  )
  return linhas ?? []
}
