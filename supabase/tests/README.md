# Testes das regras do banco

As regras que **protegem dinheiro e inscrição** moram no Postgres, não no
navegador: preço do campeonato, quem pode liberar o pagamento, limite de
atletas federados por categoria. Ler o SQL não basta para ter certeza de que
elas funcionam — dois defeitos sérios só apareceram quando as migrations foram
aplicadas num banco de verdade:

- `team_registration` tratava `closed_rounds` (que é `jsonb`) como `int[]`, e a
  função inteira falhava em tempo de execução — o portal do time respondia
  "link inválido" com o link correto;
- o gatilho de preço desfazia a liberação feita pelo master e pela
  `mark_championship_paid` chamada fora da service role. Os dois caminhos
  respondiam sucesso e não liberavam nada.

## Como rodar

Precisa de um PostgreSQL local (16+). Não usa o banco de produção.

```bash
supabase/tests/run.sh
```

O script sobe um cluster temporário, aplica as migrations **na ordem**, cria um
cenário e executa as verificações. Ele falha se qualquer migration não aplicar
ou se alguma regra passar quando deveria recusar.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `00_supabase_stub.sql` | O mínimo do Supabase fora dele: schemas `auth` e `extensions`, papéis e `auth.uid()` / `auth.role()` / `auth.jwt()` |
| `01_cenario.sql` | Um organizador, um campeonato, um time e o convite |
| `02_regras.sql` | As verificações, cada uma dizendo ✅ ou ❌ |

Trocar de usuário dentro do teste é `set request.jwt.claim.sub` / `.role`; é
assim que dá para checar o que o app consegue e o que ele não consegue.
