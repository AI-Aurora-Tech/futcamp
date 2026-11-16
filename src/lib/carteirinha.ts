// ---------------------------------------------------------------------------
// Carteirinha do atleta — imagem PNG no tamanho de um cartão (85,6 × 54 mm,
// ~300 dpi), com foto, dados do atleta, time, categoria e campeonato.
//
// Imagem, e não PDF: o PDF do projeto não desenha fotos, e a carteirinha sem a
// foto do atleta não serve para conferir quem entra em campo. O PNG imprime
// bem e vai direto pelo WhatsApp.
// ---------------------------------------------------------------------------
import { formatCpf } from './eligibility'
import { MODALIDADE_LABELS } from './federated'
import { labelDaPosicao, type Category, type Championship, type Player, type Team } from '../types'

export const CARTAO_LARGURA = 1012
export const CARTAO_ALTURA = 638

export interface DadosCarteirinha {
  player: Player
  team?: Pick<Team, 'name' | 'shortName' | 'logo' | 'color'>
  championship: Pick<Championship, 'name' | 'logo' | 'primaryColor' | 'season'>
  category?: Pick<Category, 'name'>
  /** Data de emissão (padrão: hoje). */
  emitidaEm?: Date
}

const ehImagem = (s?: string) => !!s && (s.startsWith('data:') || s.startsWith('http'))

function carregar(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // Logo vindo de outro site sem CORS "suja" o canvas e impede o download:
    // nesse caso a imagem não carrega e a carteirinha sai sem ela.
    if (src.startsWith('http')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function caminhoArredondado(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Desenha a imagem cobrindo a área (como `object-fit: cover`). */
function cobrir(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height)
  const sw = w / s
  const sh = h / s
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h)
}

/** Corta com reticências para caber na largura. */
function caber(ctx: CanvasRenderingContext2D, texto: string, largura: number): string {
  if (ctx.measureText(texto).width <= largura) return texto
  let t = texto
  while (t.length > 1 && ctx.measureText(`${t}…`).width > largura) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

/** Quebra o nome em até `linhas` linhas. */
function quebrar(ctx: CanvasRenderingContext2D, texto: string, largura: number, linhas: number): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let atual = ''
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p
    if (ctx.measureText(tentativa).width <= largura || !atual) atual = tentativa
    else {
      out.push(atual)
      atual = p
    }
  }
  if (atual) out.push(atual)
  if (out.length <= linhas) return out
  const cortadas = out.slice(0, linhas)
  cortadas[linhas - 1] = caber(ctx, out.slice(linhas - 1).join(' '), largura)
  return cortadas
}

const FONTE = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif'
const dataBR = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

/** Desenha a carteirinha num canvas novo e o devolve. */
export async function desenharCarteirinha(d: DadosCarteirinha): Promise<HTMLCanvasElement> {
  const W = CARTAO_LARGURA
  const H = CARTAO_ALTURA
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Seu navegador não conseguiu gerar a imagem.')

  const cor = d.championship.primaryColor || '#16a34a'
  const { player } = d
  const comissao = player.role === 'comissao'

  const [logoCamp, logoTime, foto] = await Promise.all([
    ehImagem(d.championship.logo) ? carregar(d.championship.logo!) : null,
    ehImagem(d.team?.logo) ? carregar(d.team!.logo!) : null,
    ehImagem(player.photo) ? carregar(player.photo!) : null,
  ])

  // Fundo do cartão.
  caminhoArredondado(ctx, 0, 0, W, H, 36)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Faixa do campeonato.
  const faixa = 132
  ctx.fillStyle = cor
  ctx.fillRect(0, 0, W, faixa)
  // Brilho leve na faixa.
  const brilho = ctx.createLinearGradient(0, 0, W, faixa)
  brilho.addColorStop(0, 'rgba(255,255,255,0.18)')
  brilho.addColorStop(1, 'rgba(0,0,0,0.12)')
  ctx.fillStyle = brilho
  ctx.fillRect(0, 0, W, faixa)

  // Logo do campeonato (imagem num círculo branco, ou emoji).
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(86, faixa / 2, 48, 0, Math.PI * 2)
  ctx.fill()
  if (logoCamp) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(86, faixa / 2, 44, 0, Math.PI * 2)
    ctx.clip()
    cobrir(ctx, logoCamp, 42, faixa / 2 - 44, 88, 88)
    ctx.restore()
  } else {
    ctx.font = `52px ${FONTE}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(d.championship.logo || '🏆', 86, faixa / 2 + 3)
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 40px ${FONTE}`
  const tituloX = 156
  const tituloW = W - tituloX - 40
  ctx.fillText(caber(ctx, d.championship.name, tituloW), tituloX, 62)
  ctx.font = `600 24px ${FONTE}`
  ctx.globalAlpha = 0.92
  const sub = [comissao ? 'CARTEIRINHA DA COMISSÃO TÉCNICA' : 'CARTEIRINHA DO ATLETA', d.category?.name, d.championship.season]
    .filter(Boolean)
    .join('  ·  ')
  ctx.fillText(caber(ctx, sub, tituloW), tituloX, 100)
  ctx.globalAlpha = 1

  // Foto 3×4.
  const fx = 44
  const fy = faixa + 36
  const fw = 250
  const fh = 330
  caminhoArredondado(ctx, fx, fy, fw, fh, 20)
  ctx.fillStyle = '#eef2f7'
  ctx.fill()
  if (foto) {
    ctx.save()
    caminhoArredondado(ctx, fx, fy, fw, fh, 20)
    ctx.clip()
    cobrir(ctx, foto, fx, fy, fw, fh)
    ctx.restore()
  } else {
    // Silhueta (presa à moldura).
    ctx.save()
    caminhoArredondado(ctx, fx, fy, fw, fh, 20)
    ctx.clip()
    ctx.fillStyle = '#c3cbd6'
    ctx.beginPath()
    ctx.arc(fx + fw / 2, fy + 125, 62, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(fx + fw / 2, fy + fh + 30, 115, 140, 0, Math.PI, 0)
    ctx.fill()
    ctx.fillStyle = '#64748b'
    ctx.font = `600 20px ${FONTE}`
    ctx.textAlign = 'center'
    ctx.fillText('sem foto', fx + fw / 2, fy + fh - 18)
    ctx.textAlign = 'left'
    ctx.restore()
  }
  caminhoArredondado(ctx, fx, fy, fw, fh, 20)
  ctx.strokeStyle = cor
  ctx.lineWidth = 4
  ctx.stroke()

  // Dados.
  const dx = fx + fw + 40
  const dw = W - dx - 44
  let y = fy + 40

  ctx.fillStyle = '#0f172a'
  ctx.font = `800 38px ${FONTE}`
  for (const linha of quebrar(ctx, player.name.toUpperCase(), dw, 2)) {
    ctx.fillText(linha, dx, y)
    y += 44
  }

  // Selos: validado na Receita, federado.
  const selos: { texto: string; fundo: string; cor: string }[] = []
  if (player.cpfVerified) selos.push({ texto: '✓ VALIDADO NA RECEITA', fundo: '#dcfce7', cor: '#166534' })
  if (player.federated) {
    selos.push({
      texto: `FEDERADO${player.federatedIn ? ` · ${MODALIDADE_LABELS[player.federatedIn].toUpperCase()}` : ''}`,
      fundo: '#ede9fe',
      cor: '#5b21b6',
    })
  }
  if (selos.length) {
    ctx.font = `700 19px ${FONTE}`
    let sx = dx
    for (const s of selos) {
      const w = ctx.measureText(s.texto).width + 28
      caminhoArredondado(ctx, sx, y - 4, w, 34, 17)
      ctx.fillStyle = s.fundo
      ctx.fill()
      ctx.fillStyle = s.cor
      ctx.fillText(s.texto, sx + 14, y + 20)
      sx += w + 10
    }
    y += 48
  } else {
    y += 8
  }

  // Campos em duas colunas.
  const campos: [string, string][] = [
    ['CPF', player.cpf ? formatCpf(player.cpf) : '—'],
    ['NASCIMENTO', dataBR(player.birthdate)],
    [comissao ? 'FUNÇÃO' : 'POSIÇÃO', labelDaPosicao(player.position) || '—'],
    ['Nº DA CAMISA', comissao || player.number == null ? '—' : String(player.number)],
  ]
  const colW = (dw - 20) / 2
  campos.forEach(([rotulo, valor], i) => {
    const cx = dx + (i % 2) * (colW + 20)
    const cy = y + Math.floor(i / 2) * 72
    ctx.fillStyle = '#64748b'
    ctx.font = `700 17px ${FONTE}`
    ctx.fillText(rotulo, cx, cy + 16)
    ctx.fillStyle = '#0f172a'
    ctx.font = `600 27px ${FONTE}`
    ctx.fillText(caber(ctx, valor, colW), cx, cy + 50)
  })
  y += 2 * 72 + 6

  // Time.
  ctx.fillStyle = '#64748b'
  ctx.font = `700 17px ${FONTE}`
  ctx.fillText('EQUIPE', dx, y + 16)
  const by = y + 26
  const corTime = d.team?.color || cor
  ctx.fillStyle = `${corTime}22`
  ctx.beginPath()
  ctx.arc(dx + 22, by + 22, 22, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = corTime
  ctx.lineWidth = 2
  ctx.stroke()
  if (logoTime) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(dx + 22, by + 22, 21, 0, Math.PI * 2)
    ctx.clip()
    cobrir(ctx, logoTime, dx + 1, by + 1, 42, 42)
    ctx.restore()
  } else {
    ctx.fillStyle = '#0f172a'
    ctx.font = `700 15px ${FONTE}`
    ctx.textAlign = 'center'
    const ini = d.team?.logo && !ehImagem(d.team.logo) ? d.team.logo : (d.team?.shortName || d.team?.name || '?').slice(0, 3).toUpperCase()
    ctx.fillText(ini, dx + 22, by + 28)
    ctx.textAlign = 'left'
  }
  ctx.fillStyle = '#0f172a'
  ctx.font = `700 28px ${FONTE}`
  ctx.fillText(caber(ctx, d.team?.name ?? '—', dw - 60), dx + 58, by + 32)

  // Rodapé.
  const ry = H - 58
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(0, ry, W, 58)
  ctx.fillStyle = cor
  ctx.fillRect(0, ry, W, 4)
  ctx.fillStyle = '#475569'
  ctx.font = `600 19px ${FONTE}`
  const emitida = (d.emitidaEm ?? new Date()).toLocaleDateString('pt-BR')
  ctx.fillText(`Emitida em ${emitida}`, 44, ry + 37)
  ctx.textAlign = 'right'
  ctx.fillText(`Inscrição nº ${player.id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}`, W - 44, ry + 37)
  ctx.textAlign = 'left'

  ctx.restore()
  // Contorno do cartão.
  caminhoArredondado(ctx, 1, 1, W - 2, H - 2, 36)
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 2
  ctx.stroke()

  return canvas
}

/** Nome do arquivo: "Carteirinha - Fulano - Time.png". */
export function nomeArquivoCarteirinha(player: Pick<Player, 'name'>, team?: Pick<Team, 'name'>): string {
  const limpo = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').trim()
  return `Carteirinha - ${limpo(player.name)}${team ? ` - ${limpo(team.name)}` : ''}.png`
}
