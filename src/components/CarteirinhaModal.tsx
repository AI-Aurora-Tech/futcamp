import { useEffect, useState } from 'react'
import { desenharCarteirinha, nomeArquivoCarteirinha, type DadosCarteirinha } from '../lib/carteirinha'
import { Button, Modal } from './ui'

/** Pré-visualiza a carteirinha e baixa (ou compartilha) o PNG. */
export function CarteirinhaModal({ dados, onClose }: { dados: DadosCarteirinha; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    let criada: string | null = null
    desenharCarteirinha(dados)
      .then(
        (canvas) =>
          new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/png'),
          ),
      )
      .then((b) => {
        if (!vivo) return
        criada = URL.createObjectURL(b)
        setBlob(b)
        setUrl(criada)
      })
      .catch((e) => vivo && setErro((e as Error)?.message || 'Não foi possível gerar a carteirinha.'))
    return () => {
      vivo = false
      if (criada) URL.revokeObjectURL(criada)
    }
    // Desenha uma vez ao abrir: a tela por trás pode atualizar sem mudar o atleta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nome = nomeArquivoCarteirinha(dados.player, dados.team)
  const arquivo = blob ? new File([blob], nome, { type: 'image/png' }) : null
  const podeCompartilhar =
    !!arquivo && typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [arquivo] })

  function baixar() {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function compartilhar() {
    if (!arquivo) return
    try {
      await navigator.share({ files: [arquivo], title: nome })
    } catch {
      /* cancelado */
    }
  }

  return (
    <Modal title={`Carteirinha · ${dados.player.name}`} onClose={onClose}>
      <div className="carteirinha">
        {erro ? (
          <p className="auth-error">{erro}</p>
        ) : url ? (
          <img className="carteirinha__img" src={url} alt={`Carteirinha de ${dados.player.name}`} />
        ) : (
          <p className="muted center pad">Gerando a carteirinha…</p>
        )}
        <p className="muted small">
          Imagem em alta resolução, no formato de um cartão (8,5 × 5,4 cm). Ao imprimir, ajuste a largura para 8,5 cm.
        </p>
      </div>
      <div className="form-actions">
        <Button variant="ghost" type="button" onClick={onClose}>Fechar</Button>
        {podeCompartilhar && (
          <Button variant="soft" type="button" onClick={() => void compartilhar()}>📤 Compartilhar</Button>
        )}
        <Button type="button" onClick={baixar} disabled={!url}>⬇ Baixar carteirinha</Button>
      </div>
    </Modal>
  )
}
