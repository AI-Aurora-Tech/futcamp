# Edge Function — `validate-athlete`

Consulta **CPF + data de nascimento na Receita Federal** (por um provedor) e
devolve o **nome oficial** do atleta. Usada na tela de inscrição do time:

1. O time digita CPF e data de nascimento e toca em **Consultar na Receita**.
2. Deu certo → o nome vem preenchido (travado) e o atleta fica **✓ VALIDADO**.
3. Algo errado (não confere, Receita fora do ar, consulta não configurada) →
   a tela pergunta se o time quer **cadastrar manualmente**. O atleta é salvo
   normalmente, só que sem o selo.

A marcação `players.cpf_verified` é decidida pelo banco (migration `0058`): a
função grava a consulta confirmada em `cpf_verifications` e um gatilho em
`players` só marca o atleta se CPF + nascimento + nome baterem com ela. O
navegador não consegue forjar o selo, e trocar nome/CPF/data depois o remove.

## Sem provedor pago (gratuito)

Sem `CPF_PROVIDER`, a função responde `unverified` e a tela vai direto para o
cadastro manual. O organizador valida depois no painel de atletas: botão 🔎
**Conferir na Receita** → abre o site oficial "Situação Cadastral do CPF"
(captcha resolvido por uma pessoa) → **Validar atleta** (migration `0059`).

## Deploy

```bash
supabase functions deploy validate-athlete --no-verify-jwt
```

Aplique também a migration `0058_atleta_validado_na_receita.sql`.

## Provedor (secrets)

A Receita não tem API pública gratuita — a consulta passa por um provedor pago.
Configure em *Project Settings → Edge Functions → Secrets*:

| Secret | Descrição |
|---|---|
| `CPF_PROVIDER` | `infosimples`, `mock` (teste) ou `generic`. |
| `CPF_API_TOKEN` | Token do provedor (`infosimples` / `generic`). |
| `CPF_API_URL` | Só `generic`: URL que recebe `POST` JSON com `cpf` e `birthdate`/`dataNascimento`. |
| `CPF_API_AUTH_HEADER` / `CPF_API_AUTH_PREFIX` | Só `generic` (padrão `Authorization` / `Bearer `). |

### Para testar sem contratar nada — `mock`

```bash
supabase secrets set CPF_PROVIDER=mock
```

Confirma qualquer CPF válido e devolve o nome `ATLETA TESTE <4 últimos dígitos>`.
Para ver a recusa (e a pergunta do cadastro manual), use um atleta nascido em
**1º de janeiro**. **Não use em produção**: marca atletas como validados sem
consulta real.

### Receita de verdade — Infosimples

Consulta `receita-federal/cpf` (CPF + data de nascimento; cobrada por consulta).

```bash
supabase secrets set CPF_PROVIDER=infosimples CPF_API_TOKEN="seu_token"
```

## Contrato

**Requisição** `POST` JSON: `{ "cpf": "11144477735", "birthdate": "2015-05-10" }`

**Resposta** JSON: `{ "ok": true, "status": "valid", "message": "…", "name": "NOME" }`

`status`: `valid` · `unverified` (sem provedor) · `invalid_cpf` ·
`invalid_birthdate` · `mismatch` · `error`. Só `valid` com `name` conta como
validado; nos demais a tela oferece o cadastro manual (exceto CPF/data
inválidos, que basta corrigir).
