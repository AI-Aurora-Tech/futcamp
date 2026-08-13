# ⚽ Tabelaço

**Plataforma completa de gestão de campeonatos esportivos amadores.**

Crie e administre competições amadoras de ponta a ponta: cadastre times e
elencos, gere a tabela de jogos automaticamente, registre resultados com gols
e cartões, e acompanhe a **classificação** e as **estatísticas** atualizadas em
tempo real. Cada campeonato tem uma **página pública** compartilhável.

> Feito com **React + Vite + TypeScript** e **Supabase** (Postgres + Auth).
> Roda também em **modo demo**, 100% no navegador, sem precisar de backend.

---

## ✨ Funcionalidades

- 🏆 **Campeonatos** em três formatos: **pontos corridos**, **grupos + mata-mata** e **mata-mata**.
- 🛡️ **Times** com escudo (emoji ou cor), sigla e técnico.
- 👥 **Elencos** com número, posição e jogadores por time.
- 📅 **Geração automática de rodadas** (todos contra todos) com turno e returno opcional.
- ⚽ **Registro de resultados** com eventos por jogador (gols, gols contra, assistências, cartões).
- 📊 **Classificação automática** com critérios de desempate (pontos, saldo, gols pró, vitórias).
- 🏅 **Rankings**: artilharia, assistências e cartões.
- 🔗 **Página pública** por campeonato (`#/c/<id>`), somente leitura, para compartilhar com torcedores.
- 📨 **Link de inscrição por time** (`#/t/<id>?k=<token>`): o organizador envia o link, o responsável **cria usuário/senha** e inscreve os atletas (nome completo, CPF, data de nascimento e foto).
- 🧒🧑 **Infantil ou Adulto** com **categorias** e regra de **ano de nascimento** (+ exceções por time no adulto) — o sistema barra atletas fora da faixa.
- 🛂 **API de validação do atleta** (Edge Function `validate-athlete`): valida o **CPF** e confere **CPF × data de nascimento** (via provedor configurável), com fallback local.
- ⏱️ **Prazo de inscrição por partida**: as inscrições de um time encerram X horas antes do jogo e **reabrem** após a partida ser finalizada.
- 🔢 **Limites por categoria**: máximo de **atletas** e de **comissão técnica** por time.
- 📄 **Súmula**: gere e exporte (imprimir/PDF ou HTML) a súmula do jogo quando as inscrições encerram.
- 🔴 **Ao vivo**: o organizador lança gols/cartões durante o jogo e a **classificação e estatísticas** atualizam em tempo real.
- 🧑‍⚖️ **Mesários**: logins próprios (vários mesários) que lançam os dados **em tempo real**; o administrador define **quais jogos** cada mesário pode preencher. Portal em `#/mesa/<id>`.
- 📄 **Importar atletas por .txt**: uma linha por atleta no formato `NOME - CPF - DATA DE NASCIMENTO`, com prévia e validação (CPF, idade, limites) antes de importar.
- 🚫 **Suspensão automática**: alerta quando um atleta acumula **3 amarelos** na fase de grupos / pontos corridos ou leva **cartão vermelho** (qualquer fase).
- 🎲 **Sorteio automático dos grupos**: distribui os times nos grupos de forma equilibrada com um clique.
- 🧑‍⚖️🏟️ **Cadastro de árbitros e campos**: escale o árbitro e informe o local de cada jogo (aparecem na súmula e no calendário).
- 📆 **Calendário de jogos**: agenda das partidas por data, com horário, local e árbitro.
- 🤝 **Patrocinadores e parceiros**: cadastre logotipos e links exibidos na página pública do campeonato.
- 🔎 **Página inicial pública** com busca e lista dos campeonatos em andamento, abertos a qualquer visitante.
- 🌐 **SEO otimizado**: metadados, Open Graph, dados estruturados (Schema.org), `robots.txt` e `sitemap.xml`.
- 📱 **100% responsivo**: layout adaptado para celular, tablet e desktop.
- 🔐 **Autenticação de organizadores** via Supabase, com **RLS** garantindo que cada um edite apenas os próprios campeonatos.

## 🚀 Começando

```bash
npm install
npm run dev
```

Abra <http://localhost:5173>. Sem configurar o Supabase, o app entra em
**modo demo**: clique em *“Entrar no modo demonstração”* para explorar com um
campeonato de exemplo já criado. Os dados ficam salvos no `localStorage`.

### Conectando ao Supabase (backend real)

1. Crie um projeto em <https://supabase.com>.
2. No **SQL Editor**, rode as migrations em `supabase/migrations/` na ordem
   numérica (`0001_init.sql`, `0002_rls.sql`, … até a mais recente).
3. Copie `Project URL` e `anon key` (Project Settings → API) para um `.env`:
   ```bash
   cp .env.example .env
   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
   ```
4. Reinicie o `npm run dev`. Agora o cadastro/login e os dados usam a nuvem.

Detalhes do banco e do modelo de segurança em [`supabase/README.md`](supabase/README.md).

## 📁 Estrutura

```
src/
  lib/          # supabase client, geração de tabela (fixtures), classificação, estatísticas
  services/     # camada de dados (Supabase + fallback demo em localStorage)
  context/      # AuthContext (organizador logado)
  components/   # UI: landing, dashboard, gestão do campeonato, página pública
  types.ts      # modelos de domínio
supabase/
  migrations/   # schema + RLS
  seed.sql      # dados de exemplo (opcional)
```

## ▲ Deploy na Vercel

O projeto já vem com [`vercel.json`](vercel.json) configurado (framework Vite,
build `npm run build`, saída `dist`, e *rewrite* de SPA para o `index.html`).

1. Em <https://vercel.com>, clique em **Add New → Project** e importe o
   repositório do GitHub. A Vercel detecta o Vite automaticamente.
2. (Opcional) Em **Settings → Environment Variables**, adicione as variáveis do
   Supabase para usar o backend real (sem elas o app sobe em **modo demo**):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   > ⚠️ Variáveis `VITE_*` são lidas **no build** — após alterá-las, faça um
   > *redeploy* para que passem a valer.
3. Clique em **Deploy**. Cada `push` na branch de produção gera um novo deploy.

### Via CLI (opcional)

```bash
npm i -g vercel
vercel        # preview
vercel --prod # produção
```

## 🛠️ Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Vite). |
| `npm run build` | Type-check + build de produção. |
| `npm run preview` | Pré-visualiza a build. |
| `npm run lint` | Verificação de tipos (`tsc --noEmit`). |

## 🧭 Como usar

1. **Crie um campeonato** escolhendo o formato e a pontuação.
2. **Cadastre os times** (e defina os grupos, no formato de grupos).
3. **Monte os elencos** de cada time.
4. Em **Partidas**, clique em **“Gerar tabela de jogos”** — as rodadas são criadas automaticamente.
5. Clique em uma partida para **lançar o placar** e os **eventos** (gols/cartões).
6. Acompanhe **classificação** e **estatísticas** — e compartilhe o **link público**.

---

_Tabelaço — gestão de campeonatos esportivos amadores._
