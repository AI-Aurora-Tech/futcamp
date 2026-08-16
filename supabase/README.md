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

## Modelo de acesso (RLS)

- **Qualquer visitante** pode *ler* campeonatos, times, jogadores, partidas e
  eventos — é o que alimenta as páginas públicas.
- **Somente o organizador dono** do campeonato pode criar/editar/excluir seus
  dados (validado por `owns_championship()`).

## Solução de problemas

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
