// ---------------------------------------------------------------------------
// Sessão do mesário.
//
// O portal do mesário (`#/mesa/<id>`) guarda a sessão no sessionStorage — some
// ao fechar a aba. Fica aqui, e não dentro do componente, porque quem entra
// pela página inicial (com e-mail e senha) precisa abrir essa mesma sessão
// antes de ir para o portal — senão o portal pediria a senha de novo.
// ---------------------------------------------------------------------------
import type { MesaContext } from '../services/officials'

export interface MesaSession extends MesaContext {
  name: string
}

const chave = (championshipId: string) => `futcamp:mesa:${championshipId}`

export function abrirSessaoMesa(s: MesaSession): void {
  try {
    sessionStorage.setItem(chave(s.championshipId), JSON.stringify(s))
  } catch {
    /* navegador sem sessionStorage: só pedirá a senha de novo */
  }
}

export function lerSessaoMesa(championshipId: string): MesaSession | null {
  try {
    const raw = sessionStorage.getItem(chave(championshipId))
    return raw ? (JSON.parse(raw) as MesaSession) : null
  } catch {
    return null
  }
}

export function fecharSessaoMesa(championshipId: string): void {
  try {
    sessionStorage.removeItem(chave(championshipId))
  } catch {
    /* ignore */
  }
}
