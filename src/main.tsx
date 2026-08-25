import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// `@vercel/analytics/react` — o caminho `/next` é do Next.js e não existe aqui
// (o projeto é Vite + React); importá-lo quebraria o build.
import { Analytics } from '@vercel/analytics/react'
import { AuthProvider } from './context/AuthContext'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
      {/*
       * Vercel Analytics: contagem de acessos, sem cookie e sem dado pessoal.
       * Em desenvolvimento ele não envia nada — só registra no console — então
       * dá para deixar ligado sem sujar os números.
       */}
      <Analytics />
    </AuthProvider>
  </StrictMode>,
)

// Registra o service worker (torna o app instalável — WebAPK — e habilita
// funcionamento offline básico). A estratégia network-first mantém o app
// sempre atualizado, sem reinstalação.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
