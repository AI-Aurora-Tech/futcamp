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
- 💳 **Planos com pagamento**: o organizador escolhe o plano, o sistema soma as categorias adicionais e gera a cobrança no **Asaas** (Pix, boleto ou cartão). Confirmado o pagamento, o campeonato é liberado sozinho — nenhuma credencial fica no navegador.
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

O master administra **em qualquer situação**: rascunho, em andamento,
encerrado — e também campeonato com **pagamento pendente**, que para o
organizador dono fica fechado na tela de cobrança. Ele abre o painel completo,
edita as informações e exclui normalmente; um aviso 🔒 no topo lembra que a
cobrança ainda não foi confirmada.

> Os dois cadastros precisam bater. Se o e-mail estiver só no
> `VITE_MASTER_ADMINS` e não na tabela `master_admins`, o app mostra os botões
> de master mas o banco recusa a escrita — o app agora avisa isso em vez de
> fingir que salvou.

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

A home mostra os **5 campeonatos em andamento mais recentes** e os **5
encerrados mais recentes**, em blocos separados — ela é a porta de entrada do
app, não um catálogo. Encerrado ordena pela data de **encerramento**, não pela
de criação: quem terminou por último aparece primeiro. A busca por nome ou
temporada levanta esse teto, porque quem digitou um nome quer achar aquele
campeonato.

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

## 💳 Pagamentos (Asaas)

A página **Planos e preços** (`#/planos`) é o começo do caminho: o organizador
escolhe o plano, cai no formulário de criação já com ele marcado, e o sistema
**soma o plano com as categorias adicionais** antes de gerar o link de
pagamento.

| Plano | Valor | Categoria adicional | Equipes por categoria |
|---|---|---|---|
| Grátis | R$ 0,00 | — | 8 (1 categoria, 1 campeonato) |
| Bronze | R$ 59,90 | + R$ 39,90 | 16 |
| Prata | R$ 79,90 | + R$ 49,90 | 32 |
| Ouro | R$ 109,90 | + R$ 59,90 | ilimitadas |
| Diamante | **R$ 200,00/mês** | — | ilimitadas |

O valor já inclui a primeira categoria. Ex.: Ouro com 3 categorias =
`109,90 + 2 × 59,90 = R$ 229,70`.

O **Diamante é o único cobrado por mês**, e da **conta** — não do campeonato:
R$ 200,00/mês dão campeonatos, categorias e equipes ilimitados, com
compromisso de 12 meses, no **cartão de crédito** (débito recorrente, não
parcelamento). O cliente contrata sozinho; o consultor só entra para fechar
condição diferente do padrão.

A tabela vive em [`src/lib/pricing.ts`](src/lib/pricing.ts) — e é espelhada em
SQL na função `plan_price_cents()` da migration `0021_payments.sql`, que é
**quem manda**: o preço é recalculado por gatilho no banco a cada campeonato
criado, então um cliente adulterado não consegue pagar menos nem se marcar como
pago (fora do `service_role`, o gatilho restaura os campos de pagamento).

### Fluxo

1. **Criou** — o campeonato nasce com `payment_status = 'pending'` e fica
   **bloqueado**: na lista aparece com 🔒 *pagamento pendente* e, ao abrir,
   mostra só a cobrança.
2. **Pagou** — a Edge Function `asaas-checkout` cria um **Checkout** no Asaas e
   devolve o link; o app abre a página do Asaas em outra aba, onde o pagador
   escolhe **Pix, boleto ou cartão** e informa os próprios dados. O app fica
   conferindo o campeonato a cada 5 s.
3. **Confirmou** — o Asaas chama a Edge Function `asaas-webhook`, que
   **reconsulta o pagamento na API oficial** (a notificação sozinha não prova
   nada), confere o valor e libera o campeonato. O painel abre sozinho.

Webhook falha — não configurado, evento não marcado, entrega perdida. Por isso
existe a `asaas-status`, que **pergunta ao Asaas sob demanda**: o app consulta a
cada 20 s enquanto a tela de cobrança está aberta, e na hora quando o
organizador clica em "Já paguei". Quem decide continua sendo a API do Asaas; o
app nunca diz que pagou.

Plano **Grátis** não passa por cobrança nenhuma (`payment_status = 'free'`), e
**Diamante** (R$ 200,00/mês, assinatura recorrente no cartão) é contratado
pelo próprio cliente; o link do consultor no **WhatsApp** fica como segunda
opção, já com a mensagem escrita — `wa.me` abre o aplicativo no celular e o WhatsApp Web no
computador. O número está em `src/components/Plans.tsx` e pode ser trocado sem
mexer no código, por `VITE_WHATSAPP` no `.env`. No **modo demo** (sem Supabase) o pagamento é simulado na hora, para
dar para testar o fluxo inteiro sem backend.

> O CPF do pagador é pedido pelo Asaas, na página dele — o Tabelaço não coleta
> nem guarda dado fiscal de ninguém. Foi por isso que a integração usa o
> Checkout hospedado, e não a cobrança direta (que exigiria `cpfCnpj` na API).

### Configuração

```bash
supabase secrets set ASAAS_API_KEY="$aact_..." \
                     ASAAS_ENV="producao" \
                     ASAAS_WEBHOOK_TOKEN="uma-senha-sua" \
                     APP_URL="https://tabelaco.auroratech.app.br"
supabase functions deploy asaas-checkout --no-verify-jwt
supabase functions deploy asaas-webhook  --no-verify-jwt
supabase functions deploy asaas-status   --no-verify-jwt
```

E no painel do Asaas (**Integrações → Webhooks**) aponte para
`https://<project-ref>.supabase.co/functions/v1/asaas-webhook`, marque os
eventos de **Cobranças** (`PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`) e informe o
mesmo `ASAAS_WEBHOOK_TOKEN` no campo de token de autenticação.

Para testar sem dinheiro real, use a chave de sandbox e `ASAAS_ENV=sandbox`.

> **Forma de pagamento indisponível derruba a cobrança inteira.** Se a conta
> não tem chave Pix cadastrada, ou o boleto ainda não foi liberado, o Asaas
> recusa o pedido todo — nem cartão passa. A `asaas-checkout` tenta a lista
> completa, depois vai tirando uma forma de cada vez, até uma combinação ser
> aceita; o log diz qual funcionou. Para fixar de vez, use o secret opcional
> `ASAAS_BILLING_TYPES="PIX,CREDIT_CARD"`.

### Conferir o que está publicado

A função responde a `GET` dizendo a própria versão e como está configurada —
sem revelar a chave:

```bash
curl -s https://SEU_REF.supabase.co/functions/v1/asaas-checkout | jq
# { "versao": "3", "chave": "$aact_YTU5…(164 caracteres)",
#   "ambiente": "https://api.asaas.com/v3", "appUrl": "https://…",
#   "formas": [["PIX","BOLETO","CREDIT_CARD"], ...] }
```

Se a `versao` não for a esperada, o deploy não pegou — republique antes de
investigar qualquer outra coisa. A versão também aparece no fim de toda
mensagem de erro que o app mostra.

**Saída de emergência.** O administrador master libera qualquer campeonato sem
cobrança — em *Ajustes → Pagamento*, ou no próprio painel de cobrança. Serve
para pagamento em dinheiro, transferência direta, cortesia, ou uma confirmação
que o Asaas não entregou. O motivo fica registrado em `payment_ref`. Quem
valida é o banco (`master_release_championship`, migration `0023`): o navegador
não decide isso.

**Pagou e não liberou?** A `asaas-status` conta onde a procura parou:

```bash
curl -s "https://SEU_REF.supabase.co/functions/v1/asaas-status?championshipId=<uuid-do-campeonato>"
```

> O vínculo entre o checkout e o campeonato é gravado em **dois** lugares: na
> tabela `payments` e em `championships.payment_ref` (`checkout:<id>`). O
> segundo existe porque o primeiro depende da migration `0022`: sem ela o
> registro falha em silêncio e o pagamento fica órfão, impossível de
> reencontrar. Um vínculo só, numa coluna que pode não existir, é um vínculo
> que se perde.

A resposta mostra, em ordem: o que o banco guardou (`registroLocal` — se vier
`ERRO`, a migration `0022` não foi aplicada), o que o Asaas devolve para
`payments?externalReference`, para `checkouts?externalReference` e para cada
checkout guardado. Acrescentando `&token=<ASAAS_WEBHOOK_TOKEN>` ela também
lista as últimas cobranças da conta — é a parte que mostra movimento alheio ao
campeonato, por isso pede o token.

### ◆ Plano Diamante — R$ 200,00/mês

O Diamante é **contratado pelo próprio cliente**, como qualquer outro plano:
ele escolhe na tabela, lê e aceita o contrato de 12 meses e assina no cartão.
A cobrança é **recorrente e só no cartão de crédito** — R$ 200,00 debitados
mês a mês, e não um parcelamento, então o limite dele não fica preso no total.

O consultor continua no jogo, mas como **exceção e não como porta**: em
*Ajustes* ele registra um valor diferente do padrão (mensal ou avulso) para o
cliente que negociou. Apagar essa negociação devolve o campeonato ao plano de
tabela. Isso **não** significa criar a cobrança na mão no
painel do Asaas — o app faz o link, e é ele que amarra o pagamento ao
campeonato.

O caminho é este:

1. O cliente cria o campeonato escolhendo **Diamante**. Ele nasce **fechado**,
   já com o valor de tabela e a modalidade mensal de 12 meses.
2. Na tela de cobrança ele lê o contrato, **aceita** (nome, documento — e o
   texto integral fica gravado) e clica em *Assinar com cartão de crédito*.
   O contrato inclui o **uso exclusivo da conta**: o login é pessoal e
   intransferível, e vender, emprestar ou compartilhar o acesso — ou usar a
   conta para revender o Tabelaço a terceiros — permite suspender ou encerrar
   a conta sem devolução, com as mensalidades do período ainda devidas.
3. O Asaas confirma a primeira cobrança, o webhook ativa a assinatura e abre
   **todos** os campeonatos Diamante daquela conta.
4. *(Opcional)* Se o cliente negociou condição diferente, o **master** entra
   antes do passo 2, em **Ajustes** → *"◆ Plano Diamante — valor negociado"*, e
   registra o valor — mensal ou avulso. Quem valida é o banco
   (`set_negotiated_price`); só o master enxerga o bloco.

O valor combinado mora em `championships.negotiated_cents`, e não em
`amount_cents`, porque o gatilho de preço recalcula `amount_cents` a cada
alteração do campeonato enquanto ele está pendente — guardado ali, o combinado
sumiria assim que o cliente acrescentasse uma categoria.

#### Mensal ou avulso

O consultor escolhe a modalidade na hora de registrar a proposta:

| | **◆ Assinatura mensal** | **◆ Valor único** |
|---|---|---|
| Cobrança | R$ X **por mês** no cartão de crédito, pelo Asaas (`chargeTypes: RECURRENT`) | Uma vez, Pix/boleto/cartão |
| Limite do cartão | **Não compromete** — cada mês é uma cobrança de R$ X, não uma autorização do total | — |
| Vale para | A **conta** do organizador: todos os campeonatos Diamante dele | Aquele campeonato |
| Contrato | O cliente aceita antes de assinar; nome, documento, data e o **texto integral** ficam gravados | — |
| Atraso | 7 dias de carência, depois os campeonatos fecham (nada é apagado) | — |

O Asaas **não tem fidelidade nem multa por cancelamento** — a assinatura dele
recorre até alguém parar. O compromisso de 12 meses existe no **aceite**
(`subscriptions`, migration 0037), que guarda o contrato inteiro: um número de
versão sozinho seria confiar que ninguém mexeu no modelo depois.

A assinatura é da **conta**, e não de um campeonato, porque o Diamante promete
campeonatos ilimitados — cobrar por campeonato contradiz o que foi vendido.
Ativa, todos os campeonatos Diamante daquele cliente abrem; encerrada, fecham
— menos os que foram pagos avulsos, que já estão quitados por conta própria.

> ⏰ **Agende a função `assinaturas-varrer` uma vez por dia.** A carência de 7
> dias vence pelo relógio, e relógio nenhum dispara gatilho no banco. Sem o
> agendamento, quem parou de pagar continua com os campeonatos abertos — a
> assinatura cancelada para de gerar cobrança, então nenhum webhook chega para
> avisar.

> **Precisa mesmo cobrar por fora?** Se a cobrança for criada no painel do
> Asaas, preencha a **Referência externa** (`externalReference`) com o **id do
> campeonato** — é por ele que o webhook reencontra o campeonato. Um dígito
> errado e o dinheiro entra sem liberar nada; por isso o caminho de cima é o
> recomendado. Para recebimento fora do Asaas (transferência, dinheiro), use
> **👑 Liberar sem cobrança**, que registra o motivo no campeonato.

> ⚠️ **Antes da migration `0036`, escolher Diamante liberava o campeonato de
> graça, na hora.** O preço zero de "sob consulta" caía no mesmo ramo do plano
> Grátis. Para ver quem entrou por essa porta:
> ```sql
> select id, name, created_at from public.championships
>  where lower(plan) = 'diamante' and payment_status = 'free'
>  order by created_at desc;
> ```
> A migration não mexe nesses campeonatos de propósito — pode haver contrato
> de verdade no meio, e fechar o campeonato de um cliente no meio da temporada
> é pior do que o problema.

### Onde vai cada credencial

| Credencial | Onde | Por quê |
|---|---|---|
| **Chave de API do Asaas** (`$aact_...`) | **Nunca** no front. Só como secret de servidor: Supabase → *Project Settings → Edge Functions → Secrets* → `ASAAS_API_KEY` | Tudo que começa com `VITE_` é embutido no JavaScript e fica visível para qualquer visitante. A chave movimenta a sua conta — ela só é lida no servidor, com `Deno.env.get('ASAAS_API_KEY')`. |
| **Token do webhook** | Secret `ASAAS_WEBHOOK_TOKEN` + o mesmo valor no painel do Asaas | Garante que a notificação veio mesmo do Asaas. É opcional, mas sem ele qualquer um que descubra a URL pode tentar um "pagou" falso — que ainda assim não libera nada, porque a função reconsulta a API antes. |

## 🎽 Atletas federados (base)

Em campeonato **infantil**, cada **categoria** decide se aceita **atletas
federados** (campo/futsal) e **quantos por time**. A permissão é da categoria,
não do campeonato: o mesmo torneio costuma proibir no Sub-11 e liberar dois no
Sub-15.

No link de inscrição o time vê a regra de todas as categorias, uma por linha:

> ✅ **Sub-13**: aceita até 2 atleta(s) federado(s) por time. Marcados: **2** de 2.
> ⛔ **Sub-11**: não aceita atletas federados (campo ou futsal).

O time marca cada atleta federado e escolhe a modalidade (campo, futsal ou
ambos); na lista do elenco eles ficam com a etiqueta `FEDERADO`. O
**organizador** tem a mesma marcação ao inscrever pela aba *Elencos* — ele
também cadastra atletas, e a regra vale igual. Na
**importação por planilha** vale uma coluna **Federado** — `sim`, `x` ou `1`
marcam o atleta, e quem passar do limite da categoria é recusado com o motivo,
sem entrar pela metade. Trocar o
atleta para uma categoria que não aceita **desmarca** a federação — a regra
acompanha a categoria escolhida, não o atleta.

Quando as vagas de uma categoria acabam, a caixa fica desabilitada com o
motivo — e lotar o Sub-13 não trava o Sub-15. Mas quem **barra de verdade** é
o banco: `assert_federated_allowed` (migration `0026`) roda dentro da RPC de
inscrição. O portal do time é uma página aberta no navegador de quem se
inscreve — validar só lá seria pedir para burlar.

## 📄 Regulamento em PDF

O organizador não escreve regulamento: ele é **montado a partir do que já está
cadastrado** — formato, categorias e faixas de idade, pontuação, ordem de
desempate, prazo de inscrição, mata-mata e atletas federados. Baixam o PDF:

- o **organizador**, em *Ajustes → Regulamento*;
- os **times**, pelo próprio link de inscrição.

O documento carimba a data de emissão, porque é derivado do cadastro: mudou uma
regra no app, o próximo download já sai diferente.

O gerador é próprio ([`src/lib/pdf.ts`](src/lib/pdf.ts), ~250 linhas) em vez de
uma biblioteca. As bibliotecas de PDF pesam centenas de KB — mais que o app
inteiro — para produzir um documento de texto. Aqui é Helvetica, normal e
negrito, com acentuação por WinAnsiEncoding. Sem imagens e sem tabelas: se um
dia o regulamento precisar disso, aí vale reconsiderar.

## 📈 Analytics (Vercel)

Contagem de acessos pelo **Vercel Web Analytics** — sem cookie e sem dado
pessoal. O componente entra uma vez, em [`src/main.tsx`](src/main.tsx):

```tsx
import { Analytics } from '@vercel/analytics/react'
```

> O caminho é `/react`, **não** `/next`: `@vercel/analytics/next` é do Next.js
> e não existe neste projeto (Vite + React) — importá-lo quebra o build.

Em desenvolvimento o pacote não envia nada, só registra no console. Em
produção ele carrega `/_vercel/insights/script.js` do próprio domínio, o que
também o livra da maioria dos bloqueadores de anúncio.

**Uma limitação para conhecer:** o pacote conta uma visualização a cada
`pushState`, e o Tabelaço navega trocando o `location.hash`. Na prática, cada
**acesso** é contado (visitas e visitantes ficam corretos, que é o objetivo),
e o endereço registrado é o da carga da página — quem abre direto o link
público de um campeonato aparece com aquele endereço, mas quem navega entre as
telas dentro do app não gera visualizações adicionais.

## 🔔 Notificações push

Ligados por quem quer recebê-los, dispositivo por dispositivo.

**Responsável do time** — no portal de inscrição, liga *"Avisos do meu time"*:

| Aviso | Quando chega |
| --- | --- |
| 📅 **Jogo marcado ou remarcado** | O organizador define (ou muda) data, hora ou local. Vai com os três. |
| ⏰ **Falta 2 dias** | 48 horas antes do jogo. |
| ⚽ **Gol** | A cada gol da partida, com o **nome de quem fez** e o placar do momento. |
| 🟥 **Atleta suspenso** | Fim do jogo em que o atleta levou vermelho ou completou os amarelos da categoria. Só o time dele recebe. |
| 🏆 **Resultado e resumo** | Fim do jogo. Um aviso por equipe: o título traz vitória, empate ou derrota; o corpo traz os gols dos seus atletas, os cartões e o próximo compromisso. |
| 📊 **Classificação** | Quando o último jogo da rodada encerra, com os três primeiros. |

**Organizador** — em *Ajustes*, liga *"Avisos de alterações dos times"*:
recebe quando um time inscreve, edita ou remove atletas, ou muda os próprios
dados. Alterações seguidas do mesmo time são agrupadas em um aviso só (uma
importação de 30 atletas não vira 30 notificações).

Tudo é recortado por **categoria**: cada categoria é uma competição, e quem
cuida do Sub-11 não recebe a classificação do Sub-17.

Os avisos nascem de **gatilhos no banco** (`push_outbox`), então valem para
qualquer caminho — painel, portal do mesário e link de inscrição. O único que
não nasce de gatilho é o lembrete de 2 dias: ninguém escreve no banco quando o
relógio passa das 48 horas, então ele é gerado pela própria Edge Function
(`push_gerar_lembretes`) a cada execução agendada.

### Como habilitar

1. Gere o par de chaves VAPID:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. **App** — coloque a chave pública no `.env` e faça um novo build/deploy:
   ```bash
   VITE_VAPID_PUBLIC_KEY=BEl...   # chave pública
   ```
3. **Banco** — rode as migrations `0018_push_notifications.sql` e
   `0035_avisos_da_equipe.sql`.
4. **Edge Function** — publique a função de entrega e configure os secrets:
   ```bash
   supabase functions deploy send-push
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
     VAPID_SUBJECT="mailto:voce@exemplo.com"
   ```
5. **Agende a função a cada 15 minutos** (Supabase → Edge Functions →
   Schedules, ou `pg_cron`). Este passo **não é opcional**: é ele que faz o
   lembrete de 2 dias existir, e é a rede de segurança para qualquer aviso que
   tenha ficado pendente. Os demais avisos o app já entrega na hora, chamando a
   função logo depois do gol, do encerramento e do agendamento dos jogos.

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
| `supabase/tests/run.sh` | Aplica as migrations num Postgres temporário e testa as regras do banco. |
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
