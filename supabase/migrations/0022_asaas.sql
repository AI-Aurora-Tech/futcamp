-- ===========================================================================
-- Tabelaço — troca do provedor de pagamento: Mercado Pago → Asaas
--
-- A regra de negócio não muda: o preço continua sendo calculado pelo gatilho
-- da migration 0021 e o campeonato continua só sendo liberado pela
-- `mark_championship_paid`, chamada com a service role. O que muda é quem
-- avisa que o pagamento entrou.
--
-- O histórico do Mercado Pago é preservado (as linhas antigas ficam marcadas
-- como `provider = 'mercadopago'`).
-- ===========================================================================

alter table public.payments add column if not exists provider text;
alter table public.payments add column if not exists checkout_id text;

-- Tudo que existia antes desta migration veio do Mercado Pago.
update public.payments
   set provider = case when preference_id is not null or payment_id is not null
                       then 'mercadopago' else 'asaas' end
 where provider is null;

alter table public.payments alter column provider set default 'asaas';

-- O checkout do Asaas faz o papel da "preference" do Mercado Pago: é o que o
-- webhook usa para reencontrar o campeonato quando o evento não traz o
-- `externalReference`.
create unique index if not exists payments_checkout_id_idx
  on public.payments (checkout_id) where checkout_id is not null;

create index if not exists payments_provider_idx on public.payments (provider, created_at desc);
