# Regras do projeto

## Listas do Supabase: nunca deixar o servidor cortar linhas

O Supabase (PostgREST) devolve no máximo `max_rows` linhas por resposta e corta
o resto sem avisar. Isso já fez atletas inscritos sumirem do app.

- Toda consulta que devolve uma LISTA (atletas, clubes, partidas, eventos,
  campeonatos, mesários, inscrições...) usa `selectAll` de `src/lib/selectAll.ts`,
  com `select(cols, { count: 'exact' })` e uma ordem estável terminando em `.order('id')`.
- Nunca usar `.select()` direto para listas, nem `.limit()` para "resolver" volume.
- Nas Edge Functions (`supabase/functions`), listas que podem crescer também são
  lidas em páginas com `.range()` até vir uma página vazia.
- Filas processadas em lotes (`push_outbox`, `whatsapp_outbox`) podem usar `.limit()`:
  o resto é processado na próxima execução, nada se perde.
