# Edge Function — `validate-athlete`

Valida os dados do atleta na inscrição: **CPF** (dígitos verificadores) e, se um
provedor de consulta estiver configurado, a **coerência entre CPF e a data de
nascimento** — tudo no servidor, sem expor chaves no navegador.

## Deploy

```bash
supabase functions deploy validate-athlete --no-verify-jwt
```

> `--no-verify-jwt` permite que a página pública de inscrição (sem login) chame
> a função. A função em si não escreve nada no banco.

## Contrato

**Requisição** `POST` JSON:
```json
{ "cpf": "11144477735", "birthdate": "2015-05-10" }
```

**Resposta** JSON:
```json
{ "ok": true, "status": "valid", "message": "…", "name": "opcional" }
```

`status`: `valid` · `unverified` · `invalid_cpf` · `invalid_birthdate` ·
`mismatch` · `error`. O app bloqueia a inscrição quando `ok = false`
(`invalid_cpf` / `mismatch`).

## Provedor externo (opcional)

Sem provedor, a função valida apenas o CPF e responde `unverified`. Para
conferir **CPF × data de nascimento** oficialmente, configure os *secrets*
(Project Settings → Edge Functions → Secrets):

| Secret | Descrição | Padrão |
|---|---|---|
| `CPF_API_URL` | URL do provedor (recebe `POST` JSON com `cpf` e `birthdate`/`dataNascimento`). | — |
| `CPF_API_TOKEN` | Token/chave do provedor. | — |
| `CPF_API_AUTH_HEADER` | Header de autenticação. | `Authorization` |
| `CPF_API_AUTH_PREFIX` | Prefixo do valor do header. | `Bearer ` |

```bash
supabase secrets set CPF_API_URL="https://api.exemplo.com/consulta-cpf" \
                     CPF_API_TOKEN="seu_token"
```

A função é tolerante a diferentes formatos de resposta: reconhece campos como
`valid`/`match`, `status`/`situacao` (ex.: "regular"/"ativa") e, quando o
provedor devolve a data de nascimento (`nascimento`/`dataNascimento`), confirma
que ela bate com a informada. Ajuste `queryProvider()` em `index.ts` caso seu
provedor use outro contrato.

## Alternativa sem Supabase

O cliente também aceita uma URL direta via `VITE_VALIDATION_URL` (mesmo contrato
de requisição/resposta acima). Sem Supabase e sem essa URL, a validação roda só
localmente (CPF + data plausível).
