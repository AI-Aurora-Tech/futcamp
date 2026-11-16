import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from './ui'

/** Moldura 3×4 (a mesma da carteirinha). */
const FRAME_W = 240
const FRAME_H = 320
/** Tamanho final da foto gravada. */
const OUT_W = 360
const OUT_H = 480

/**
 * Enquadrar a foto do atleta: arrastar para posicionar, aproximar/afastar
 * (barra, roda do mouse ou pinça no celular). Devolve um JPEG 3×4 leve.
 */
export function EnquadrarFoto({
  src,
  onCancel,
  onConfirm,
}: {
  /** Data URL da foto escolhida. */
  src: string
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1) // 1 = a foto cobre a moldura exatamente
  const [pos, setPos] = useState({ x: 0, y: 0 }) // deslocamento do centro, em px da moldura
  const [erro, setErro] = useState<string | null>(null)
  const ponteiros = useRef(new Map<number, { x: number; y: number }>())
  const pinca = useRef<{ dist: number; zoom: number } | null>(null)

  // Esc fecha só o enquadrador (não o cadastro aberto por trás).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  useEffect(() => {
    const i = new Image()
    i.onload = () => setImg(i)
    i.onerror = () => setErro('Não foi possível abrir esta foto.')
    i.src = src
  }, [src])

  // Escala que faz a foto cobrir a moldura (zoom 1).
  const base = img ? Math.max(FRAME_W / img.width, FRAME_H / img.height) : 1
  const escala = base * zoom
  const w = img ? img.width * escala : 0
  const h = img ? img.height * escala : 0

  /** Mantém a foto cobrindo a moldura inteira (sem faixa vazia). */
  function prender(p: { x: number; y: number }, ww = w, hh = h) {
    const mx = Math.max(0, (ww - FRAME_W) / 2)
    const my = Math.max(0, (hh - FRAME_H) / 2)
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) }
  }

  function mudarZoom(z: number) {
    const novo = Math.min(4, Math.max(1, z))
    setZoom(novo)
    if (img) setPos((p) => prender(p, img.width * base * novo, img.height * base * novo))
  }

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ponteiros.current.size === 2) {
      const [a, b] = [...ponteiros.current.values()]
      pinca.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const antes = ponteiros.current.get(e.pointerId)
    if (!antes) return
    const agora = { x: e.clientX, y: e.clientY }
    ponteiros.current.set(e.pointerId, agora)
    if (ponteiros.current.size === 2 && pinca.current) {
      const [a, b] = [...ponteiros.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinca.current.dist > 0) mudarZoom(pinca.current.zoom * (dist / pinca.current.dist))
      return
    }
    setPos((p) => prender({ x: p.x + (agora.x - antes.x), y: p.y + (agora.y - antes.y) }))
  }

  function onPointerUp(e: React.PointerEvent) {
    ponteiros.current.delete(e.pointerId)
    if (ponteiros.current.size < 2) pinca.current = null
  }

  function onWheel(e: React.WheelEvent) {
    mudarZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))
  }

  function confirmar() {
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = OUT_W
    canvas.height = OUT_H
    const ctx = canvas.getContext('2d')
    if (!ctx) return setErro('Seu navegador não conseguiu recortar a foto.')
    // Da moldura (px de tela) para a foto original.
    const sx = (img.width - FRAME_W / escala) / 2 - pos.x / escala
    const sy = (img.height - FRAME_H / escala) / 2 - pos.y / escala
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, OUT_W, OUT_H)
    ctx.drawImage(img, sx, sy, FRAME_W / escala, FRAME_H / escala, 0, 0, OUT_W, OUT_H)
    onConfirm(canvas.toDataURL('image/jpeg', 0.88))
  }

  return (
    <Modal title="Enquadrar a foto" onClose={onCancel} dismissable={false}>
      <div className="enquadrar">
        <p className="muted small">Arraste para posicionar o rosto e use o zoom para aproximar.</p>
        <div
          className="enquadrar__moldura"
          style={{ width: FRAME_W, height: FRAME_H }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {img && (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                width: w,
                height: h,
                transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
              }}
            />
          )}
          <span className="enquadrar__guia" aria-hidden />
        </div>
        <label className="enquadrar__zoom">
          <span aria-hidden>➖</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => mudarZoom(Number(e.target.value))}
            aria-label="Zoom"
          />
          <span aria-hidden>➕</span>
        </label>
        {erro && <p className="auth-error">{erro}</p>}
      </div>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>Cancelar</Button>
        <Button type="button" onClick={confirmar} disabled={!img}>✓ Usar esta foto</Button>
      </div>
    </Modal>
  )
}
