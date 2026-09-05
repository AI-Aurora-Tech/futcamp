import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Injeta o `preconnect` para o Supabase no `index.html`.
 *
 * O app abre a primeira consulta ao banco assim que renderiza. Sem o
 * preconnect, DNS e handshake TLS acontecem só nesse momento e entram inteiros
 * no caminho crítico — no celular, em rede móvel, são algumas centenas de
 * milissegundos que aparecem direto no LCP.
 *
 * É um plugin, e não uma tag fixa no HTML, porque a URL do backend vem do
 * ambiente: sem `VITE_SUPABASE_URL` (modo demo) não há a quem se conectar, e
 * uma tag com `href` vazio só atrapalharia.
 */
function preconnectSupabase(env: Record<string, string>): Plugin {
  return {
    name: 'tabelaco-preconnect-supabase',
    transformIndexHtml(html) {
      const url = env.VITE_SUPABASE_URL
      if (!url) return html.replace('<!--preconnect-supabase-->', '')
      let origem: string
      try {
        origem = new URL(url).origin
      } catch {
        return html.replace('<!--preconnect-supabase-->', '')
      }
      const tags = [
        `<link rel="preconnect" href="${origem}" crossorigin />`,
        `<link rel="dns-prefetch" href="${origem}" />`,
      ].join('\n    ')
      return html.replace('<!--preconnect-supabase-->', tags)
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  return {
    plugins: [react(), preconnectSupabase(env)],
    server: {
      host: true,
      port: 5173,
    },
  }
})
