# Supabase — FutCamp

Backend do FutCamp: autenticação de organizadores + banco Postgres com RLS.

## Estrutura

| Arquivo | Descrição |
|---|---|
| `migrations/0001_init.sql` | Tabelas: `profiles`, `championships`, `teams`, `players`, `matches`, `match_events` + trigger de criação de perfil. |
| `migrations/0002_rls.sql` | Row Level Security: leitura pública, escrita restrita ao dono do campeonato. |
| `migrations/0003_team_registration.sql` | Link de inscrição de times: tabela `team_invites` + RPCs `SECURITY DEFINER` (o time inclui escudo/atletas via token, sem login). |
| `migrations/0004_categories_and_accounts.sql` | Público-alvo + categorias no campeonato, CPF/categoria no atleta, e conta do time (usuário/senha bcrypt via pgcrypto) + RPCs de inscrição. |
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

## Modo demo (sem Supabase)

Se o `.env` não estiver preenchido, o FutCamp roda em **modo demo**: os dados
ficam no `localStorage` do navegador e o login é simulado. Ideal para testar a
interface sem configurar backend.
