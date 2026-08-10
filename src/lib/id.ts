/** Gera um identificador único (usado no modo demo, sem backend). */
export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}_${rand}` : rand
}

/** Gera um token de acesso curto e opaco (para links de inscrição de times). */
export function accessToken(): string {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return (Math.random().toString(36) + Math.random().toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 24)
}
