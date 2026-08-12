# Supabase — FutCamp

Backend do FutCamp: autenticação de organizadores + banco Postgres com RLS.

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

Se o `.env` não estiver preenchido, o FutCamp roda em **modo demo**: os dados
ficam no `localStorage` do navegador e o login é simulado. Ideal para testar a
interface sem configurar backend.
