import { useState } from 'react'
import { ChampLogo, SuporteLink } from './ui'
import { LINK_SUPORTE } from '../lib/whatsapp'
import { formatBRL, planOf } from '../lib/pricing'

// ---------------------------------------------------------------------------
// Como usar o Tabelaço — o passo a passo, por quem faz.
//
// Três pessoas usam o app e nenhuma precisa saber o que a outra faz: o
// organizador monta o campeonato, o responsável do time inscreve os atletas e
// o mesário anota a súmula no campo. Um manual único misturaria as três e
// obrigaria cada uma a garimpar a sua parte — daí as abas.
//
// A página é pública (`#/como-usar`): o organizador manda o link para os times
// e para os mesários, e ninguém precisa estar logado para ler.
// ---------------------------------------------------------------------------

type Papel = 'organizador' | 'time' | 'mesario'

interface Passo {
  titulo: string
  texto: string
  /** Detalhes que só interessam a quem já está naquele passo. */
  itens?: string[]
  /** Aviso do tipo "isto costuma dar errado aqui". */
  atencao?: string
}

const ORGANIZADOR: Passo[] = [
  {
    titulo: 'Crie a sua conta',
    texto:
      'Na página inicial, use "Criar conta" com o seu e-mail e uma senha. É esta conta que administra os campeonatos.',
  },
  {
    titulo: 'Crie o campeonato',
    texto:
      'Dê o nome, escolha o esporte, a temporada e o público. Depois defina a forma de disputa e as categorias.',
    itens: [
      'Pontos corridos — todos jogam contra todos, e o primeiro é campeão.',
      'Grupos + mata-mata — a fase de grupos classifica, e o mata-mata decide.',
      'Mata-mata direto — quem perde, sai.',
      'Cada categoria (Sub-11, Sub-15, Adulto…) é um campeonato à parte, com tabela, classificação e campeão próprios.',
    ],
  },
  {
    titulo: 'Escolha o plano',
    texto:
      'O plano é definido pelo número de equipes que cabem em cada categoria. O valor já inclui a primeira categoria; cada categoria a mais tem um adicional.',
    itens: [
      'Grátis — 1 campeonato, 1 categoria, até 8 equipes.',
      'Bronze, Prata e Ouro — pagos por campeonato, com 16, 32 e equipes ilimitadas.',
      `Diamante — ${formatBRL(planOf('diamante').monthlyCents ?? 0)}/mês na sua conta, com campeonatos, categorias e equipes ilimitados.`,
    ],
  },
  {
    titulo: 'Pague e libere',
    texto:
      'O campeonato nasce fechado e abre sozinho assim que o pagamento é confirmado — Pix costuma levar minutos, boleto até dois dias úteis. O plano Grátis já nasce aberto.',
    atencao:
      'Nada é perdido enquanto o pagamento não confirma: o campeonato fica guardado do jeito que você montou.',
  },
  {
    titulo: 'Cadastre os times',
    texto: 'Na aba Times, de dois jeitos — e você pode misturar os dois.',
    itens: [
      'Você mesmo: "＋ Adicionar time", preenchendo nome, escudo e responsável.',
      '"🔗 Link para criar time": mande no grupo e cada responsável cria o próprio clube.',
      'Com várias categorias, dá para mandar o link de UMA categoria — quem só tem equipe no Sub-13 nem vê o Sub-17.',
    ],
  },
  {
    titulo: 'Mande o link de inscrição de cada time',
    texto:
      'No cartão do time, o botão 🔗 gera o link do responsável. É por ele que o time cria o acesso e inscreve os atletas — você não precisa digitar elenco nenhum.',
    atencao:
      'Em Ajustes você define o prazo de inscrição: quantas horas antes do jogo o elenco fecha.',
  },
  {
    titulo: 'Sorteie os grupos',
    texto:
      'Só para grupos + mata-mata. O botão "🎲 Sortear grupos" distribui os times de forma equilibrada. Você também pode escolher o grupo de cada um na mão.',
  },
  {
    titulo: 'Gere a tabela de jogos',
    texto:
      'Na aba Jogos, "Gerar tabela" cria todos os confrontos de uma vez, respeitando o formato e o turno/returno.',
    atencao:
      'Regerar a tabela apaga os jogos daquela categoria. Com resultado já lançado, o app avisa antes.',
  },
  {
    titulo: 'Marque data, hora e local',
    texto:
      'Ainda em Jogos, use "Agendar" para definir quando e onde cada partida acontece. Os locais saem do cadastro de campos do campeonato.',
    itens: [
      'Assim que você marca, os times recebem o aviso no celular — com data, hora e local.',
      'Dois dias antes, eles recebem o lembrete automático.',
    ],
  },
  {
    titulo: 'No dia do jogo, abra a súmula',
    texto:
      'Clique na partida para registrar tudo: presença, gols com o autor e o minuto, cartões, substituições e ocorrências.',
    itens: [
      'Atleta suspenso por cartões aparece bloqueado — não dá para escalar por engano.',
      'A classificação e a artilharia se atualizam sozinhas ao encerrar.',
      'A súmula pode ser impressa ou baixada para assinar no campo.',
    ],
  },
  {
    titulo: 'Avance para o mata-mata',
    texto:
      'Encerrada a fase de grupos, o app monta o chaveamento com os classificados, na ordem que você definiu. Os vencedores avançam sozinhos a cada rodada.',
  },
  {
    titulo: 'Encerre e mostre o campeão',
    texto:
      'Em Ajustes, encerre a categoria. O campeão aparece na página pública do campeonato — o endereço que você divulga para todo mundo acompanhar.',
    itens: [
      'Cada categoria encerra na sua data: o Sub-11 pode acabar com o Sub-17 na semifinal.',
    ],
  },
]

const TIME: Passo[] = [
  {
    titulo: 'Abra o link que o organizador mandou',
    texto:
      'É um link só seu, do seu time. Não precisa de conta nem de senha para abrir da primeira vez.',
  },
  {
    titulo: 'Crie o acesso com um e-mail válido',
    texto:
      'O e-mail é o seu usuário. Guarde-o: é por ele que você entra depois, direto pela página inicial do Tabelaço.',
    itens: ['Cada time pode ter até 2 gestores, cada um com o próprio e-mail e senha.'],
    atencao:
      'Esqueceu a senha? Peça ao organizador para zerá-la. Você cria uma nova pelo link de inscrição — não pela página inicial.',
  },
  {
    titulo: 'Complete os dados do time',
    texto:
      'Escudo, cor, nome do responsável e telefone. O escudo aparece na tabela, na súmula e na página pública.',
  },
  {
    titulo: 'Inscreva os atletas',
    texto: 'Nome, número da camisa, posição, data de nascimento e foto.',
    itens: [
      'Atletas: goleiro, zagueiro, lateral, volante, meia, atacante.',
      'Comissão técnica: técnico, auxiliar técnico, massagista, preparador físico, médico, marketing.',
      'Tem muita gente? Importe de uma planilha, pelo botão de importação.',
    ],
    atencao:
      'Em campeonatos de base, o mesmo atleta não pode estar em dois times — o app confere pelo CPF.',
  },
  {
    titulo: 'Ligue os avisos no celular',
    texto:
      'No portal do time, ative "Avisos do meu time" para receber jogo marcado, lembrete de 2 dias, gols, suspensão por cartão, o resultado com o resumo da partida e a classificação da rodada.',
    atencao:
      'No iPhone, os avisos só funcionam com o app adicionado à Tela de Início.',
  },
  {
    titulo: 'Depois, entre pela página inicial',
    texto:
      'Não precisa mais do link: use o seu e-mail e senha na página inicial do Tabelaço e você cai direto no seu time.',
  },
  {
    titulo: 'Fique de olho no prazo',
    texto:
      'O organizador define quantas horas antes do jogo as inscrições fecham. Passado o prazo, o elenco daquela rodada trava — inscreva antes.',
  },
]

const MESARIO: Passo[] = [
  {
    titulo: 'Receba o link da mesa e a sua senha',
    texto:
      'O organizador cadastra você como mesário e envia um link do tipo tabelaco…/#/mesa/… junto com uma senha.',
  },
  {
    titulo: 'Entre e veja só os seus jogos',
    texto:
      'O portal mostra apenas as partidas atribuídas a você. Nada do resto do campeonato fica ao seu alcance.',
  },
  {
    titulo: 'Confirme a presença antes de começar',
    texto:
      'Abra a partida e marque quem está em campo. Atleta suspenso por cartões vem bloqueado, com o motivo escrito.',
  },
  {
    titulo: 'Registre o jogo ao vivo',
    texto:
      'Gols (com autor e minuto), cartões, substituições e ocorrências. O placar acompanha sozinho.',
    itens: ['Quem estiver acompanhando pelo celular recebe o gol na hora.'],
  },
  {
    titulo: 'Encerre a partida',
    texto:
      'Ao encerrar, a classificação se atualiza, os times recebem o resultado com o resumo, e a súmula fica disponível para imprimir.',
  },
]

const PAPEIS: { key: Papel; icone: string; titulo: string; quem: string; passos: Passo[] }[] = [
  {
    key: 'organizador',
    icone: '🏆',
    titulo: 'Organizador',
    quem: 'Você monta o campeonato, cadastra os times e comanda a competição.',
    passos: ORGANIZADOR,
  },
  {
    key: 'time',
    icone: '🛡️',
    titulo: 'Time',
    quem: 'Você recebeu um link e precisa inscrever o seu clube e os atletas.',
    passos: TIME,
  },
  {
    key: 'mesario',
    icone: '📋',
    titulo: 'Mesário',
    quem: 'Você anota a súmula no campo, no dia do jogo.',
    passos: MESARIO,
  },
]

interface Duvida {
  p: string
  r: string
}

const DUVIDAS: Duvida[] = [
  {
    p: 'Preciso pagar para experimentar?',
    r: 'Não. O plano Grátis dá um campeonato completo, com uma categoria e até 8 equipes, com todas as funcionalidades. Sem cartão, sem prazo.',
  },
  {
    p: 'Como funciona quando tenho várias categorias?',
    r: 'Cada categoria é um campeonato dentro do campeonato: tabela, jogos, classificação, mata-mata e campeão próprios — e começa e termina na data dela. Dentro do painel, uma aba para cada.',
  },
  {
    p: 'O atleta que leva o terceiro cartão fica suspenso sozinho?',
    r: 'Fica. Na partida seguinte ele aparece bloqueado na escalação, com o motivo escrito, e o time recebe o aviso no celular. O número de amarelos que suspende é definido por você, em cada categoria.',
  },
  {
    p: 'Como divulgo o campeonato?',
    r: 'Todo campeonato tem uma página pública com tabela, classificação, artilharia e o campeão. É um endereço aberto: mande no grupo, ninguém precisa de conta para ver.',
  },
  {
    p: 'Dá para usar no celular sem internet boa?',
    r: 'O Tabelaço é leve e pode ser instalado como aplicativo no celular, pelo próprio navegador. No campo, isso deixa a súmula bem mais rápida de abrir.',
  },
  {
    p: 'Escolhi o plano errado. E agora?',
    r: 'Dá para trocar. Descer de plano vale na hora; subir gera a diferença a pagar, e você pode desfazer antes de pagar. O que já foi cadastrado não se perde.',
  },
  {
    p: 'Quem pode ver o quê?',
    r: 'O organizador vê tudo do campeonato dele. O time vê e edita apenas o próprio elenco. O mesário vê apenas os jogos atribuídos a ele. A página pública mostra só resultado e classificação.',
  },
]

export function ComoUsar({ onHome }: { onHome: () => void }) {
  const [papel, setPapel] = useState<Papel>('organizador')
  const atual = PAPEIS.find((p) => p.key === papel) ?? PAPEIS[0]

  return (
    <div className="reg guia">
      <header className="reg__hero">
        <div className="container">
          <button className="back-link" onClick={onHome}>← Tabelaço</button>
          <div className="reg__champ">
            <span className="reg__champ-logo"><ChampLogo logo="📖" /></span>
            <div>
              <p className="reg__eyebrow">Guia</p>
              <h1>Como usar o Tabelaço</h1>
            </div>
          </div>
          <p className="guia__lede">
            Do primeiro campeonato ao troféu na mão. Escolha abaixo o que você é — o caminho é
            diferente para cada um.
          </p>
        </div>
      </header>

      <div className="container reg__content">
        {/* Três pessoas, três caminhos. Ninguém precisa ler o dos outros. */}
        <nav className="guia__papeis" aria-label="Escolha o seu papel">
          {PAPEIS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`guia__papel ${p.key === papel ? 'is-active' : ''}`}
              onClick={() => setPapel(p.key)}
              aria-pressed={p.key === papel}
            >
              <span className="guia__papel-ic" aria-hidden>{p.icone}</span>
              <span className="guia__papel-nome">{p.titulo}</span>
            </button>
          ))}
        </nav>

        <p className="guia__quem">{atual.quem}</p>

        <ol className="guia__passos">
          {atual.passos.map((s, i) => (
            <li key={s.titulo} className="guia__passo">
              <span className="guia__num" aria-hidden>{i + 1}</span>
              <div className="guia__corpo">
                <h3>{s.titulo}</h3>
                <p>{s.texto}</p>
                {s.itens && (
                  <ul className="guia__itens">
                    {s.itens.map((it) => <li key={it}>{it}</li>)}
                  </ul>
                )}
                {s.atencao && <p className="guia__atencao">💡 {s.atencao}</p>}
              </div>
            </li>
          ))}
        </ol>

        <section className="guia__duvidas">
          <h2>Perguntas frequentes</h2>
          {DUVIDAS.map((d) => (
            <details key={d.p} className="guia__duvida">
              <summary>{d.p}</summary>
              <p>{d.r}</p>
            </details>
          ))}
        </section>

        <section className="guia__fim">
          <h2>Ficou alguma dúvida?</h2>
          <p>
            Fale com a gente no WhatsApp — respondemos organizador, time e mesário pelo mesmo
            canal.
          </p>
          <div className="guia__fim-acoes">
            <SuporteLink href={LINK_SUPORTE} className="btn btn--primary">Falar com o suporte</SuporteLink>
            <a className="btn btn--ghost" href="#/planos">Ver planos e preços</a>
            <a className="btn btn--ghost" href="#/instalar">📲 Instalar no celular</a>
          </div>
        </section>
      </div>
    </div>
  )
}
