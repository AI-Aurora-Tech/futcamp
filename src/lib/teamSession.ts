// ---------------------------------------------------------------------------
// Sessão do gestor do time.
//
// O portal do time (`#/t/<id>?k=<token>`) pede e-mail e senha na primeira
// visita e guarda um sinal de "já entrou" no sessionStorage — some ao fechar a
// aba, que é o certo para um acesso que costuma acontecer no celular
// emprestado do vestiário.
//
// Fica aqui, e não dentro do componente, porque quem entra pela página inicial
// (com e-mail e senha, sem link) precisa abrir essa mesma sessão antes de
// mandar a pessoa para o portal — senão o portal pediria a senha de novo,
// logo depois de conferi-la.
// ---------------------------------------------------------------------------

const chave = (teamId: string) => `futcamp:teamauth:${teamId}`

/** Marca que este navegador já provou ser gestor deste time. */
export function abrirSessaoTime(teamId: string): void {
  try {
    sessionStorage.setItem(chave(teamId), '1')
  } catch {
    /* navegador sem sessionStorage: só pedirá a senha de novo */
  }
}

/** Já entrou neste time nesta aba? */
export function temSessaoTime(teamId: string): boolean {
  try {
    return sessionStorage.getItem(chave(teamId)) === '1'
  } catch {
    return false
  }
}

/** Encerra a sessão do time neste navegador. */
export function fecharSessaoTime(teamId: string): void {
  try {
    sessionStorage.removeItem(chave(teamId))
  } catch {
    /* ignore */
  }
}
