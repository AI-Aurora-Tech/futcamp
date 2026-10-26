-- ===========================================================================
-- Tabelaço — valor negociado do plano Diamante (colunas)
--
-- A migration 0036 original nunca chegou ao repositório (subiu só no banco).
-- A 0037 e a 0038 dependem destas colunas, então sem elas um banco novo não
-- se monta (a 0038 falha em "column c.negotiated_cents does not exist").
--
-- Esta versão recria SÓ as colunas — a função `set_negotiated_price` que a
-- 0036 tinha é substituída pela 0037 de qualquer forma.
--
-- Idempotente: num banco que já tem a 0036 original, não muda nada.
-- ===========================================================================

alter table public.championships add column if not exists negotiated_cents int;
alter table public.championships add column if not exists negotiated_note  text;
alter table public.championships add column if not exists negotiated_at    timestamptz;

comment on column public.championships.negotiated_cents is
  'Plano Diamante: valor negociado pelo consultor (master), em centavos.';
comment on column public.championships.negotiated_note is
  'Plano Diamante: observação da negociação.';
