# Supabase — Tabelaço

Backend do Tabelaço: autenticação de organizadores + banco Postgres com RLS.

## Estrutura

| Arquivo | Descrição |
|---|---|
| `migrations/0001_init.sql` | Tabelas: `profiles`, `championships`, `teams`, `players`, `matches`, `match_events` + trigger de criação de perfil. |
| `migrations/0002_rls.sql` | Row Level Security: leitura pública, escrita restrita ao dono do campeonato. |
| `migrations/0003_team_registration.sql` | Link de inscrição de times: tabela `team_invites` + RPCs `SECURITY DEFINER` (o time inclui escudo/atletas via token, sem login). |
| `migrations/0004_categories_and_accounts.sql` | Público-alvo + categorias no campeonato, CPF/categoria no atleta, e conta do time (usuário/senha bcrypt via pgcrypto) + RPCs de inscrição. |
| `migrations/0005_deadline_roles_live.sql` | Prazo de inscrição no campeonato, papel do atleta (atleta/comissão) e RPCs com prazo + partidas do time. |
| `migrations/0006_officials.sql` | Mesários (`officials`), `matches.official_id` e RPCs de login/escrita do mesário (SECURITY DEFINER). |
| `migrations/0007_closed_rounds.sql` | Encerramento manual de inscrições por rodada (`championships.closed_rounds`) + RPC atualizada. |
| `migrations/0008_sumula_details.sql` | Súmula detalhada: substituição/motivo nos eventos (`player_in_id`, `detail`) e `matches.incidents` + RPCs do mesário. |
| `migrations/0009_teams_per_group.sql` | Meta opcional de times por grupo (`championships.teams_per_group`). |
| `migrations/0010_referees_venues_sponsors.sql` | Árbitros, campos e patrocinadores do campeonato. |
| `migrations/0011_team_managers_and_create_link.sql` | 2º gestor do time e link público de criação de time. |
| `migrations/0012_team_responsavel_phone.sql` | Telefone do responsável pelo time. |
| `migrations/0013_password_reset.sql` | Recuperação de senha de times e mesários. |
| `migrations/0014_qualifiers_and_lineup.sql` | Classificados por grupo/liga e presença (escalação) da partida. |
| `migrations/0015_master_admin_and_bracket.sql` | **Administrador master** (`master_admins`, `is_master()`, exclusão de campeonato só para o master) + **mata-mata automático**: critérios de desempate, chaveamento, disputa de 3º lugar e as funções `ensure_knockout_stage` / `advance_bracket`. |
| `migrations/0016_group_stages.sql` | **Fases de grupos múltiplas** (`championships.group_stages`, `matches.stage`) e **classificados por grupo** (`advance_by_group`), com a função `ensure_group_stage` e o `ensure_knockout_stage` ciente do nº de fases. |
| `migrations/0017_one_cpf_one_team.sql` | **Um CPF, um time** no campeonato: índice único por (campeonato, CPF, categoria) e gatilho que impede o mesmo CPF em duas equipes — vale para todos os caminhos de inscrição. |
| `migrations/0018_push_notifications.sql` | **Notificações push**: `push_subscriptions`, fila `push_outbox` e gatilhos (gol → times do grupo; alteração de time → organizador) + RPCs `push_subscribe`/`push_unsubscribe`. |
| `migrations/0019_penalty_shootout.sql` | **Disputa por pênaltis**: colunas `matches.penalty_home`/`penalty_away`, `match_winner()` ciente das cobranças (o vencedor dos pênaltis avança em `advance_bracket`) e `mesa_update_match` com os dois novos parâmetros. |
| `migrations/0020_finished_at.sql` | **Campeão em cartaz**: `championships.finished_at` carimbado por gatilho no encerramento — a vitrine pública mantém o campeonato (e o campeão) por 10 dias. |
| `migrations/0021_payments.sql` | **Cobrança do campeonato**: `plan`, `payment_status`, `amount_cents`, `payment_ref`, `paid_at` em `championships`, a função de preço `plan_price_cents()` e o gatilho `set_championship_price()` (o valor é calculado no banco — o cliente não escolhe quanto paga), tabela `payments` e a RPC `mark_championship_paid()` restrita ao `service_role`. |
| `migrations/0022_asaas.sql` | **Troca do provedor de pagamento** (Mercado Pago → Asaas): `payments.provider` e `payments.checkout_id`. O histórico antigo fica marcado como `mercadopago`. |
| `migrations/0025_federated_athletes.sql` | **Atletas federados** (infantil): `championships.allow_federated` / `max_federated`, `players.federated` / `federated_in`, e o limite conferido no banco (`assert_federated_allowed`) dentro das RPCs de inscrição — validar só no navegador do time seria pedir para burlar. A `team_registration` passa a devolver também as regras do campeonato, para o time baixar o regulamento (lista fechada de campos: nada de dono, cobrança ou token). |
| `migrations/0026_federated_per_category.sql` | **Federados viram regra de categoria**: a permissão e o limite passam para dentro de `championships.categories` (jsonb) e as colunas da 0025 saem — o valor delas é copiado para as categorias antes. `assert_federated_allowed` passa a receber a categoria e contar só os federados dela. **Roda sozinha e pode ser repetida**: a cópia só acontece se as colunas da 0025 existirem, e as colunas do atleta são criadas com `if not exists`. |
| `functions/asaas-checkout/` | Cria o Checkout no Asaas e devolve o link (Pix, boleto ou cartão). Confere o dono do campeonato internamente, refaz o pedido sem Pix quando a conta não tem chave cadastrada, e grava o vínculo do checkout em `championships.payment_ref` (`checkout:<id>`) além da tabela `payments`. Secrets: `ASAAS_API_KEY`, `ASAAS_ENV`, `APP_URL`, `ASAAS_BILLING_TYPES` (opcional). Publique com `--no-verify-jwt`. |
| `migrations/0023_master_release.sql` | **Liberação manual pelo master**: `master_release_championship()`, a única exceção à trava de pagamento — e ela exige `is_master()`, verificado no banco. Para quando o pagamento entra por fora (dinheiro, transferência, cortesia). |
| `migrations/0024_push_outbox_cascade.sql` | **Corrige a exclusão de campeonato**: o gatilho de avisos disparava na cascata (times e atletas removidos junto) e tentava enfileirar notificação de um campeonato que já não existia — a chave estrangeira recusava e a exclusão inteira falhava. Agora o gatilho confere se o campeonato ainda existe antes de enfileirar. |
| `functions/asaas-status/` | Pergunta ao Asaas se o campeonato já foi pago e libera na hora — é o que o botão "Já paguei" chama. Rede de segurança para quando o webhook falha. Um `GET ?championshipId=…` mostra onde a busca parou. Secrets: `ASAAS_API_KEY`, `ASAAS_ENV`. Publique com `--no-verify-jwt`. |
| `functions/asaas-webhook/` | Recebe a notificação do Asaas, reconsulta o pagamento na API oficial e libera o campeonato quando confirmado. Secrets: `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`. Publique com `--no-verify-jwt`. |
| `functions/send-push/` | Entrega a fila `push_outbox` por Web Push (VAPID). Secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. |
| `functions/validate-athlete/` | Edge Function que valida CPF e confere CPF × data de nascimento (ver `SETUP.md`). |
| `seed.sql` | Dados de exemplo (opcional). Requer um `owner_id` válido. |
| `config.toml` | Configuração do Supabase CLI (dev local). |

## Como aplicar

### Opção A — Painel do Supabase (mais simples)

1. Crie um projeto em <https://supabase.com>.
2. Vá em **SQL Editor** e execute, nesta ordem:
   - `migrations/0001_init.sql`
   - `migrations/0002_rls.sql`
   - `migrations/0003_team_registration.sql`
   - `migrations/0004_categories_and_accounts.sql`
   - `migrations/0005_deadline_roles_live.sql`
   - `migrations/0006_officials.sql`
   - `migrations/0007_closed_rounds.sql`
   - `migrations/0008_sumula_details.sql`
   - `migrations/0009_teams_per_group.sql`
   - `migrations/0010_referees_venues_sponsors.sql`
   - `migrations/0011_team_managers_and_create_link.sql`
   - `migrations/0012_team_responsavel_phone.sql`
   - `migrations/0013_password_reset.sql`
   - `migrations/0014_qualifiers_and_lineup.sql`
   - `migrations/0015_master_admin_and_bracket.sql`
   - `migrations/0016_group_stages.sql`
   - `migrations/0017_one_cpf_one_team.sql`
   - `migrations/0018_push_notifications.sql`
   - `migrations/0019_penalty_shootout.sql`
   - `migrations/0020_finished_at.sql`
   - `migrations/0021_payments.sql`
   - `migrations/0022_asaas.sql`
   - `migrations/0023_master_release.sql`
   - `migrations/0024_push_outbox_cascade.sql`
   - `migrations/0025_federated_athletes.sql`
   - `migrations/0026_federated_per_category.sql`
   Depois da `0015`, cadastre o administrador master:
   ```sql
   insert into public.master_admins (email) values ('master@exemplo.com');
   ```
3. Em **Project Settings → API**, copie a `Project URL` e a `anon public key`.
4. Preencha o arquivo `.env` na raiz do projeto:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
5. (Opcional) Crie um usuário em **Authentication → Users**, copie o UID,
   cole em `seed.sql` (`v_owner`) e execute o seed.

### Opção B — Supabase CLI (dev local)

```bash
supabase start
supabase db reset      # aplica as migrations e o seed
```

## Pagamento do campeonato (Asaas)

O valor é **calculado no banco**: o gatilho `set_championship_price()` roda o
`plan_price_cents(plan, nº de categorias)` a cada inserção e grava
`amount_cents` + `payment_status`. Um cliente adulterado não consegue criar um
campeonato pago por R$ 0 nem marcar-se como pago: fora do `service_role`, o
gatilho restaura os campos de pagamento em qualquer `update`.

1. **Secrets** (Project Settings → Edge Functions → Secrets, ou pelo CLI):
   ```bash
   supabase secrets set ASAAS_API_KEY="$aact_..." \
                        ASAAS_ENV="producao" \
                        ASAAS_WEBHOOK_TOKEN="uma-senha-sua" \
                        APP_URL="https://seu-app.com.br"
   ```
   A chave **nunca** vai para o `.env` do front nem para a Vercel: tudo que
   começa com `VITE_` é embutido no JavaScript e fica visível para qualquer
   visitante. Use `ASAAS_ENV=sandbox` para testar (a chave de homologação, com
   `hmlg` no meio, também é detectada sozinha).
2. **Publique as funções**:
   ```bash
   supabase functions deploy asaas-checkout --no-verify-jwt
   supabase functions deploy asaas-webhook  --no-verify-jwt
   supabase functions deploy asaas-status   --no-verify-jwt
   ```
   O `--no-verify-jwt` é obrigatório nas duas: no webhook porque quem chama é
   o Asaas, sem sessão de usuário; na cobrança porque o portão do Supabase
   devolve `401 Invalid credentials` sem explicação em projetos com chave de
   API do formato novo (`sb_publishable_...`) ou com as chaves legadas
   desativadas. A `asaas-checkout` confere o dono do campeonato dentro da
   própria função, com `auth.getUser()` — a autorização não some, só muda de
   lugar.
3. **Chave Pix**: cadastre uma no painel do Asaas (**Pix → Minhas chaves**).
   Sem ela o Asaas recusa a cobrança inteira, não só a forma Pix. A função
   contorna sozinha (refaz o pedido só com boleto e cartão), e o secret
   opcional `ASAAS_BILLING_TYPES="BOLETO,CREDIT_CARD"` fixa as formas aceitas.
4. **Notificações**: no painel do Asaas (Integrações → Webhooks), aponte para
   `https://<project-ref>.supabase.co/functions/v1/asaas-webhook`, marque os
   eventos de **Cobranças** (`PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`) e
   informe no campo de token o mesmo valor de `ASAAS_WEBHOOK_TOKEN`.

   > ⚠️ Os dois tokens precisam bater **exatamente**. Se o secret existir no
   > Supabase e o painel do Asaas mandar outro (ou nenhum), a função responde
   > `401` a cada notificação — e o Asaas **pausa a fila** depois de algumas
   > falhas seguidas. Sintoma: pagamento confirmado no painel e nada acontece
   > no app, com o log da função vazio ou cheio de 401. Na dúvida, apague o
   > secret `ASAAS_WEBHOOK_TOKEN`: sem ele a verificação é desligada e nada
   > fica menos seguro do que já é — a liberação depende da reconsulta à API
   > do Asaas, não do que chegou na notificação. Marque
   também os eventos de **Checkout** (`CHECKOUT_PAID`) — o webhook entende os
   dois formatos, e ter os dois cobre o caso de a cobrança nascer sem o
   `externalReference` do checkout.

   **O webhook não é o único caminho.** A `asaas-status` pergunta ao Asaas sob
   demanda: o app chama a cada 20 s enquanto a tela de cobrança está aberta, e
   também quando o organizador clica em "Já paguei". Isso evita que uma
   entrega perdida deixe alguém que pagou travado — mas configure o webhook
   assim mesmo, porque ele libera quem já fechou o navegador.

**Fluxo:** o organizador escolhe o plano → cria o campeonato (nasce
`pending`) → `asaas-checkout` cria o Checkout e devolve o `link` → ele paga por
Pix, boleto ou cartão → o Asaas avisa a `asaas-webhook`, que **reconsulta**
`GET /payments/<id>` (a notificação sozinha não é prova de nada), confere se o
valor cobre o devido e chama `mark_championship_paid()`. O campeonato passa a
`paid` e o painel abre.

O CPF do pagador é pedido pelo Asaas, na página dele: por isso a integração usa
o **Checkout hospedado** e não a cobrança direta, que exigiria `cpfCnpj` na
chamada da API — o Tabelaço não coleta nem guarda dado fiscal do organizador.

## Modelo de acesso (RLS)

- **Qualquer visitante** pode *ler* campeonatos, times, jogadores, partidas e
  eventos — é o que alimenta as páginas públicas.
- **Somente o organizador dono** do campeonato pode criar/editar/excluir seus
  dados (validado por `owns_championship()`).

## Solução de problemas

**Portal do time diz "Link inválido ou expirado" com o link certo** — o time é
criado normalmente, mas a página de inscrição recusa. Quase sempre é a
`team_registration` quebrada por migration aplicada pela metade: se a `0026`
parou depois de remover `championships.allow_federated` e antes de recriar a
função, a versão que ficou no banco aponta para uma coluna que não existe mais.

Conferir:

```sql
select public.team_registration(
  (select id from public.teams order by created_at desc limit 1),
  (select token from public.team_invites order by created_at desc limit 1)
);
```

Se o erro citar uma coluna inexistente, **rode a `0026` de novo** — ela é
idempotente e recria a função. A tela do time também passou a mostrar o motivo
técnico da recusa, em vez de só "link inválido".

**`ERROR: function crypt(text, text) does not exist`** — o `pgcrypto` no Supabase
fica no schema `extensions`. As funções que usam `crypt`/`gen_salt`/`gen_random_bytes`
já declaram `set search_path = public, extensions` para encontrá-lo. Se você
aplicou uma versão anterior e viu esse erro, basta **re-executar** os arquivos
`0003_team_registration.sql`, `0004_categories_and_accounts.sql` e
`0006_officials.sql` (são `create or replace`, seguros para rodar de novo).

## Modo demo (sem Supabase)

Se o `.env` não estiver preenchido, o Tabelaço roda em **modo demo**: os dados
ficam no `localStorage` do navegador e o login é simulado. Ideal para testar a
interface sem configurar backend.
