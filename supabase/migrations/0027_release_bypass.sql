-- ===========================================================================
-- Tabelaço — a liberação do campeonato precisa passar pelo gatilho
--
-- O gatilho `set_championship_price` (0021) desfaz qualquer mexida nos campos
-- de pagamento quando `auth.role()` não é `service_role`. A intenção está
-- certa — o app não pode se liberar sozinho —, mas ele estava barrando também
-- os DOIS caminhos legítimos:
--
--   • `master_release_championship` (0023) roda com a sessão do master, que é
--     `authenticated`. O botão "Liberar sem cobrança" respondia sucesso e o
--     campeonato continuava bloqueado.
--   • `mark_championship_paid` (0021) executada no SQL Editor, onde
--     `auth.role()` não é `service_role`. A liberação manual não fazia nada,
--     em silêncio.
--
-- As duas são SECURITY DEFINER e já conferem quem pode chamá-las. O que
-- faltava era o gatilho saber distinguir "o app tentando se liberar" de "a
-- função autorizada liberando".
--
-- A marca é um `set_config` local: vale só dentro da transação da função e
-- some quando ela termina. Não dá para um cliente ligá-la por conta própria
-- em outra sessão e sair liberando campeonato.
-- ===========================================================================

create or replace function public.set_championship_price()
returns trigger
language plpgsql
as $$
declare
  v_cats int;
  v_cents int;
  v_autorizado boolean;
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

  -- Liberação autorizada: ou é a service role (webhook), ou é uma das funções
  -- de liberação, que marcam a transação antes de escrever.
  v_autorizado :=
    auth.role() = 'service_role'
    or coalesce(current_setting('tabelaco.liberando', true), '') = 'on';

  if not v_autorizado then
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

-- ---------------------------------------------------------------------------
-- Libera pelo pagamento confirmado (webhook e conferência sob demanda).
-- ---------------------------------------------------------------------------
create or replace function public.mark_championship_paid(p_champ uuid, p_payment_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('tabelaco.liberando', 'on', true);

  update public.championships
     set payment_status = 'paid',
         payment_ref = p_payment_ref,
         paid_at = now()
   where id = p_champ;
end;
$$;

revoke all on function public.mark_championship_paid(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Libera na mão (dinheiro, transferência, cortesia) — só o master.
-- ---------------------------------------------------------------------------
create or replace function public.master_release_championship(
  p_champ uuid,
  p_nota text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_master() then
    raise exception 'Somente o administrador master pode liberar um campeonato sem pagamento.';
  end if;

  perform set_config('tabelaco.liberando', 'on', true);

  update public.championships
     set payment_status = 'paid',
         payment_ref = coalesce(nullif(trim(p_nota), ''), 'liberado pelo master'),
         paid_at = now()
   where id = p_champ;

  if not found then
    raise exception 'Campeonato % não encontrado.', p_champ;
  end if;
end;
$$;

revoke all on function public.master_release_championship(uuid, text) from public, anon;
grant execute on function public.master_release_championship(uuid, text) to authenticated;
