import { useState } from 'react'
import { baixarPdf } from '../lib/pdf'
import { montarRegulamento, nomeArquivoRegulamento } from '../lib/regulamento'
import type { Championship } from '../types'
import { Button } from './ui'

/**
 * Baixa o regulamento do campeonato em PDF.
 *
 * O documento é montado na hora, a partir do que está cadastrado: se o
 * organizador mudar uma regra, o próximo download já sai atualizado. Por isso
 * o PDF carimba a data de emissão.
 */
export function RegulamentoButton({
  champ,
  variant = 'soft',
}: {
  champ: Championship
  variant?: 'primary' | 'soft' | 'ghost'
}) {
  const [erro, setErro] = useState<string | null>(null)

  function baixar() {
    setErro(null)
    try {
      baixarPdf(
        {
          titulo: `Regulamento — ${champ.name}`,
          linhas: montarRegulamento(champ),
          rodape: champ.name,
        },
        nomeArquivoRegulamento(champ),
      )
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível gerar o regulamento.')
    }
  }

  return (
    <>
      <Button variant={variant} onClick={baixar}>📄 Baixar regulamento (PDF)</Button>
      {erro && <p className="auth-error">{erro}</p>}
    </>
  )
}
