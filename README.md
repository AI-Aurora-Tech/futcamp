# ⚽ FutCamp

**Plataforma de gestão de campeonatos esportivos** — inspirada no [iFut](https://www.ifut.com.br/).

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
2. No **SQL Editor**, rode as migrations em `supabase/migrations/` na ordem:
   `0001_init.sql` e depois `0002_rls.sql`.
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

_Projeto inspirado no iFut, desenvolvido como aplicação de demonstração._
