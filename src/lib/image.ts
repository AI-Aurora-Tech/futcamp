/**
 * Lê um arquivo de imagem e devolve um data URL já redimensionado, para manter
 * escudos/logos leves (importante no modo demo, que guarda tudo no localStorage).
 */
export function fileToDataUrl(file: File, maxDim = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Arquivo de imagem inválido.'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas indisponível.'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Converte o logo do campeonato em JPEG para embutir num PDF.
 *
 * O logo pode ser imagem (data URL ou http) ou um emoji. Os dois passam por um
 * canvas com fundo branco — o JPEG não tem transparência, e o PDF lê JPEG sem
 * precisar decodificar nada. Qualquer falha (imagem quebrada, servidor sem
 * CORS) devolve `undefined`: a súmula sai sem logo, mas sai.
 */
export async function logoParaJpeg(
  logo: string | undefined,
  maxDim = 240,
): Promise<{ jpeg: Uint8Array; largura: number; altura: number } | undefined> {
  if (!logo?.trim()) return undefined
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    if (/^(data:|https?:)/.test(logo)) {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.crossOrigin = 'anonymous'
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('logo'))
        el.src = logo
      })
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    } else {
      // Emoji: desenhado com a fonte de emoji do sistema.
      canvas.width = canvas.height = maxDim
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, maxDim, maxDim)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${Math.round(maxDim * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
      ctx.fillText(logo.trim(), maxDim / 2, maxDim / 2 + maxDim * 0.04)
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
    const jpeg = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i)
    return { jpeg, largura: canvas.width, altura: canvas.height }
  } catch {
    return undefined
  }
}
