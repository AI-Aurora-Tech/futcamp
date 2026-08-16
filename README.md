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
- 🛡️ **Times** com escudo (imagem ou cor), responsável e telefone, além de busca por nome/responsável/grupo.
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
- 🪪 **Um CPF, um time**: inscrito por uma equipe, o atleta **não** pode ser inscrito por outra do mesmo campeonato — em nenhuma categoria. Pela **mesma** equipe ele pode entrar em outra categoria, desde que se enquadre nela. A regra vale no painel, no link de inscrição e na importação, e é garantida também no banco (índice + gatilho).
- 📄 **Súmula**: gere e exporte (imprimir/PDF ou HTML) a súmula do jogo quando as inscrições encerram.
- 🔴 **Ao vivo**: o organizador lança gols/cartões durante o jogo e a **classificação e estatísticas** atualizam em tempo real.
- 🧑‍⚖️ **Mesários**: logins próprios (vários mesários) que lançam os dados **em tempo real**; o administrador define **quais jogos** cada mesário pode preencher. Portal em `#/mesa/<id>`.
- 📊 **Importar atletas por planilha**: arquivo `.xlsx` ou `.csv` (também `.tsv`, `.txt` ou colar direto do Excel) com as colunas **Nome**, **CPF** e **Data de nascimento** — cabeçalho reconhecido em qualquer ordem, datas do Excel convertidas sozinhas, prévia e validação (CPF, idade, limites) antes de importar, e um modelo pronto para baixar.
- 🚫 **Suspensão automática**: alerta quando um atleta acumula **3 amarelos** na fase de grupos / pontos corridos ou leva **cartão vermelho** (qualquer fase).
- 🎲 **Sorteio automático dos grupos**: distribui os times nos grupos de forma equilibrada com um clique.
- 🧑‍⚖️🏟️ **Cadastro de árbitros e campos**: escale o árbitro e informe o local de cada jogo (aparecem na súmula e no calendário).
- 📆 **Calendário de jogos**: agenda das partidas por data, com horário, local e árbitro.
- 🤝 **Patrocinadores e parceiros**: cadastre logotipos e links exibidos na página pública do campeonato.
- 🔎 **Página inicial pública** com busca e lista dos campeonatos em andamento **e dos campeões recentes** — o campeonato encerrado fica na vitrine por **10 dias**, com o campeão em destaque.
- 🌐 **SEO otimizado**: metadados, Open Graph, dados estruturados (Schema.org), `robots.txt` e `sitemap.xml`.
- 🏆 **Equipe campeã sinalizada**: ao fim do campeonato, o campeão aparece em destaque — com vice e 3º lugar — na visão geral do organizador **e** na página pública, além do troféu na linha da tabela. A página pública mantém o **placar da final** (mata-mata) ou os **pontos do campeão** (pontos corridos).
- 🥅 **Disputa por pênaltis**: nos jogos de mata-mata, a partida ao vivo tem o placar das cobranças — quem vence nos pênaltis avança automaticamente no chaveamento e o placar aparece na lista de jogos, na súmula e na faixa de campeão.
- 🔔 **Notificações push**: o responsável do time recebe aviso de **gol no grupo em que seu time joga**; o organizador recebe aviso quando **um time altera o elenco** ou os próprios dados.
- 📱 **100% responsivo**: layout adaptado para celular, tablet e desktop.
- 🔐 **Autenticação de organizadores** via Supabase, com **RLS** garantindo que cada um edite apenas os próprios campeonatos.
- 👑 **Administrador master**: perfil único que administra **qualquer** campeonato e é o **único que pode excluir** um campeonato — nem mesmo o dono pode.
- 🟩 **Jogo encerrado muda de cor** na lista do administrador e no portal do mesário.
- 🔒 **Tabela protegida**: com jogos já encerrados, **regerar a tabela fica bloqueado** — placares, gols, cartões e súmulas não se perdem por engano.
- 🔢 **Classificados por grupo**: cada grupo tem o **seu** número de vagas (grupo A classificam 3, grupo B classifica 1…) — feito para grupos com quantidades diferentes de times.
- 🪜 **Mais de uma fase de grupos**: os classificados da 1ª fase são redistribuídos em novos grupos na 2ª fase (e assim por diante) antes do mata-mata.
- 🏆 **Mata-mata automático**: definidos na criação do campeonato os **critérios de desempate**, os **classificados por grupo** e o **chaveamento** (quem pega quem até a final), o sistema **cria a fase eliminatória e insere as equipes** assim que o último jogo da primeira fase é encerrado — e leva o vencedor de cada confronto para a fase seguinte.

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

## 👑 Administrador master

O **master** é o único perfil que enxerga e administra **todos** os campeonatos
da plataforma — e o **único que pode excluir um campeonato**. O dono do
campeonato continua administrando o que é dele (times, elencos, jogos,
mesários), mas **não consegue excluí-lo**: o botão fica bloqueado e a regra é
garantida também no banco, pela RLS.

Como definir quem é master:

1. **No app** — variável de ambiente com os e-mails, separados por vírgula:
   ```bash
   VITE_MASTER_ADMINS=fulano@exemplo.com,outro@exemplo.com
   ```
2. **No banco** (obrigatório com Supabase, é o que trava a exclusão de verdade)
   — rode a migration `0015_master_admin_and_bracket.sql` e cadastre o e-mail:
   ```sql
   insert into public.master_admins (email) values ('fulano@exemplo.com');
   ```

No **modo demo** basta entrar com um e-mail da lista `VITE_MASTER_ADMINS`
(padrão: `master@tabelaco.app`) para navegar como master.

## 🏆 Equipe campeã

Assim que o título é decidido, a equipe campeã aparece:

- **no cabeçalho** do campeonato (visível em qualquer aba) e **na página
  pública**, com um selo `🏆 Campeão: <time>`;
- **na visão geral**, numa faixa dourada com o campeão, o **vice** e o **3º
  lugar** (quando há disputa de terceiro);
- **na tabela**, com o troféu na linha do campeão (pontos corridos).

O campeão vem do **resultado**, não do status do campeonato:

| Formato | Quem é o campeão | O que fica registrado |
|---|---|---|
| Mata-mata (inclusive após fase de grupos) | Vencedor da **final**; vice é o perdedor e o 3º sai da disputa de terceiro | **Placar da final** — `Alfa 1 × 1 Beta · 4 × 2 nos pênaltis` |
| Pontos corridos | **Líder da tabela**, depois que todos os jogos são encerrados (ou quando o organizador marca o campeonato como *encerrado*) | **Pontos do campeão** — `Campeão com 32 ponto(s) em 14 jogo(s)` |

Esses dados **continuam na página pública** depois que o campeonato é
encerrado: quem abrir o link vê o campeão e como o título foi decidido.

### Campeão em cartaz por 10 dias

Encerrar o campeonato não o tira do ar. Ele continua na **vitrine da página
inicial** por **10 dias** (`PUBLIC_FINISHED_DAYS`), num cartão dourado com
`🏆 Campeão: <time>` e o placar da final (ou os pontos do líder), contando
quantos dias ainda faltam. Depois desse prazo o campeonato sai da vitrine,
mas **o link direto continua funcionando** — e ainda mostra o campeão.

A contagem começa no momento em que o organizador marca o status como
*Encerrado* (`championships.finished_at`, carimbado por gatilho). Reabrir o
campeonato limpa a data e ele volta a aparecer como *em andamento*.

Empate na final sem classificado definido não coroa ninguém — informe os
**pênaltis** (ou o classificado por W.O.) na partida e o campeão aparece.

## 🥅 Disputa por pênaltis

Nas partidas de **mata-mata**, a tela da partida ao vivo traz o bloco
**Disputa por pênaltis** com o placar das cobranças. Ele fica destacado
quando o jogo está empatado, e o organizador **ou o mesário** pode preenchê-lo.

- Quem vence nas cobranças **avança sozinho** no chaveamento (o app e o banco
  usam a mesma regra: classificado manual → pênaltis → placar do jogo).
- O placar aparece na lista de jogos (`4 × 2 pên`), na **súmula** e na faixa
  de campeão quando a decisão é a final.
- Pênaltis empatados não decidem nada — o confronto continua pendente.

## 🔔 Notificações push

Dois avisos automáticos, cada um ligado por quem quer recebê-lo (por
dispositivo):

- **Responsável do time** — no portal de inscrição, liga *"Avisos de gol do meu
  grupo"*: recebe uma notificação a cada gol nas partidas do **mesmo grupo e da
  mesma fase** em que o time dele joga.
- **Organizador** — em *Ajustes*, liga *"Avisos de alterações dos times"*:
  recebe quando um time inscreve, edita ou remove atletas, ou muda os próprios
  dados. Alterações seguidas do mesmo time são agrupadas em um aviso só (uma
  importação de 30 atletas não vira 30 notificações).

Os avisos nascem de **gatilhos no banco** (`push_outbox`), então valem para
qualquer caminho — painel, portal do mesário e link de inscrição.

### Como habilitar

1. Gere o par de chaves VAPID:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **App** — coloque a chave pública no `.env` e faça um novo build/deploy:
   ```bash
   VITE_VAPID_PUBLIC_KEY=BEl...   # chave pública
   ```
3. **Banco** — rode a migration `0018_push_notifications.sql`.
4. **Edge Function** — publique a função de entrega e configure os secrets:
   ```bash
   supabase functions deploy send-push
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
     VAPID_SUBJECT="mailto:voce@exemplo.com"
   ```
5. (Opcional, recomendado) Agende a função para rodar a cada minuto — ela
   entrega o que por acaso tenha ficado pendente. O app já chama a função logo
   após cada gol e cada alteração, então o agendamento é só a rede de segurança.

Sem esses passos o recurso aparece desligado e explicado na interface — nada
quebra. No **modo demo** (sem Supabase) não há push: não existe servidor para
enviar.

> iPhone/iPad: o push só funciona com o app **adicionado à tela de início**
> (PWA instalado), exigência do próprio iOS.

## 🏆 Da fase de grupos ao mata-mata (automático)

Na criação do campeonato (formato **grupos + mata-mata**, ou **pontos corridos**
com classificados) você define:

- **Critérios de desempate**, na ordem — a pontuação é sempre o 1º critério e
  os demais (vitórias, saldo, gols pró, confronto direto, cartões, sorteio) são
  ordenados por você;
- As **fases de grupos**: quantas forem necessárias. Cada fase tem seus grupos
  e, em cada grupo, o **seu** número de classificados — `Grupo A: 3`,
  `Grupo B: 1` — o que resolve o caso de grupos com quantidades diferentes de
  times. Os classificados de uma fase são distribuídos automaticamente nos
  grupos da fase seguinte (em serpentina, evitando reencontros do mesmo grupo);
  da **última** fase saem as vagas do mata-mata;
- O **chaveamento**: quem pega quem na primeira fase eliminatória
  (ex.: `1º do grupo A × 2º do grupo B`). As fases seguintes saem daí — o
  vencedor do **Jogo 1** enfrenta o do **Jogo 2**, e assim por diante **até a
  final** —, com opção de **disputa de 3º lugar**.

Quando o **último jogo de uma fase é encerrado**, o sistema monta sozinho a fase
seguinte — a próxima fase de grupos ou, se aquela era a última, o **mata-mata**
— **já com as equipes classificadas**. A cada confronto eliminatório encerrado,
o vencedor é levado para a fase seguinte. Empate em jogo eliminatório? Abra a
partida e informe o **classificado** (pênaltis/W.O.) — o chaveamento segue
sozinho a partir daí.

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
   - `VITE_MASTER_ADMINS` (e-mails do administrador master, separados por vírgula)

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
   Depois que o primeiro jogo for **encerrado**, a opção de **regerar** a tabela é bloqueada
   (só o administrador master consegue forçar, confirmando a perda dos resultados).
5. Clique em uma partida para **lançar o placar** e os **eventos** (gols/cartões).
   Ao **encerrar**, o jogo muda de cor na lista (para o administrador e o mesário).
6. Acompanhe **classificação** e **estatísticas** — e compartilhe o **link público**.
7. Encerrada a **primeira fase**, o **mata-mata** aparece pronto na aba Partidas,
   com as equipes classificadas pelo chaveamento que você configurou.

> 📄 **Súmula**: pode ser baixada/impressa **antes do jogo** (partida agendada)
> e, depois, **somente quando a partida for encerrada** — durante o jogo ao vivo
> ela fica bloqueada.

---

_Tabelaço — gestão de campeonatos esportivos amadores._
