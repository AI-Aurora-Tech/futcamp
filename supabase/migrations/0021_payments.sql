-- ===========================================================================
-- Tabelaço — cobrança do campeonato (Mercado Pago)
--
-- Regra: ao criar o campeonato, o valor é plano + categorias adicionais. O
-- campeonato nasce BLOQUEADO (`pending`) e só é liberado quando o pagamento
-- é confirmado pela Edge Function `mp-webhook`.
--
-- Duas travas importantes:
--   1. o PREÇO é calculado no banco (gatilho), não no navegador — o cliente
--      pode mandar o que quiser em `amount_cents` que o valor é recalculado;
--   2. `payment_status` só muda por `mark_championship_paid`, chamada com a
--      service role; um gatilho rejeita a troca vinda do app.
-- ===========================================================================

alter table public.championships add column if not exists plan text;
alter table public.championships add column if not exists payment_status text;
alter table public.championships add column if not exists amount_cents int;
alter table public.championships add column if not exists payment_ref text;
alter table public.championships add column if not exists paid_at timestamptz;

-- Campeonatos criados antes da cobrança continuam liberados.
update public.championships
   set payment_status = 'free'
 where payment_status is null;

-- ---------------------------------------------------------------------------
-- Tabela de preços — espelha `src/lib/pricing.ts`.
-- Ao mudar um valor, mude nos DOIS lugares.
-- ---------------------------------------------------------------------------
create or replace function public.plan_price_cents(p_plan text, p_categories int)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p_plan, 'gratis'))
    when 'bronze' then 5990 + greatest(0, coalesce(p_categories, 1) - 1) * 3990
    when 'prata'  then 7990 + greatest(0, coalesce(p_categories, 1) - 1) * 4990
    when 'ouro'   then 10990 + greatest(0, coalesce(p_categories, 1) - 1) * 5990
    else 0  -- grátis e diamante (sob consulta) não cobram pelo app
  end;
$$;

-- ---------------------------------------------------------------------------
-- Ao inserir: calcula o valor e decide se nasce bloqueado.
-- Ao atualizar: impede o app de mexer na situação do pagamento.
-- ---------------------------------------------------------------------------
create or replace function public.set_championship_price()
returns trigger
language plpgsql
as $$
declare
  v_cats int;
  v_cents int;
begin
  v_cats := greatest(1, coalesce(jsonb_array_length(new.categories), 1));
  v_cents := public.plan_price_cents(new.plan, v_cats);

  if tg_op = 'INSERT' then
    new.amount_cents := v_cents;
    new.payment_status := case when v_cents > 0 then 'pending' else 'free' end;
    new.payment_ref := null;
    new.paid_at := null;
    return new;
  end if;

  -- UPDATE: pagamento é assunto do servidor. Quem chega pelo app (authenticated
  -- ou anon) não muda situação, referência nem data do pagamento.
  if auth.role() is distinct from 'service_role' then
    new.payment_status := old.payment_status;
    new.payment_ref := old.payment_ref;
    new.paid_at := old.paid_at;
    -- Enquanto não está pago, mudar as categorias mexe no valor devido.
    if old.payment_status = 'pending' then
      new.amount_cents := v_cents;
    else
      new.amount_cents := old.amount_cents;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists championships_price on public.championships;
create trigger championships_price
before insert or update on public.championships
for each row execute function public.set_championship_price();

-- ---------------------------------------------------------------------------
-- Histórico de cobranças (uma linha por tentativa/pagamento).
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships on delete cascade,
  preference_id text,
  payment_id text,
  amount_cents int not null default 0,
  status text not null default 'pending',
  raw jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists payments_payment_id_idx on public.payments (payment_id) where payment_id is not null;
create unique index if not exists payments_preference_id_idx on public.payments (preference_id) where preference_id is not null;
create index if not exists payments_champ_idx on public.payments (championship_id, created_at desc);

alter table public.payments enable row level security;

-- O organizador enxerga as cobranças do próprio campeonato; ninguém escreve
-- pelo app (só a service role, que ignora RLS).
drop policy if exists payments_read_own on public.payments;
create policy payments_read_own on public.payments
  for select using (
    exists (
      select 1 from public.championships c
       where c.id = payments.championship_id
         and (c.owner_id = auth.uid() or public.is_master())
    )
  );

-- ---------------------------------------------------------------------------
-- Libera o campeonato — chamada pelo webhook com a service role.
-- ---------------------------------------------------------------------------
create or replace function public.mark_championship_paid(p_champ uuid, p_payment_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.championships
     set payment_status = 'paid',
         payment_ref = p_payment_ref,
         paid_at = now()
   where id = p_champ;
end;
$$;

revoke all on function public.mark_championship_paid(uuid, text) from public, anon, authenticated;

create index if not exists championships_payment_status_idx on public.championships (payment_status);
