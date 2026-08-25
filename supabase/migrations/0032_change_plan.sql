-- ===========================================================================
-- Tabelaço — trocar o plano de um campeonato já criado
--
-- O plano era escolhido uma vez, na criação, e ficava. Quem batia no limite de
-- equipes (0031) não tinha saída: era criar outro campeonato do zero e
-- recadastrar times, elencos e tabela. Agora dá para trocar sem perder nada.
--
-- A troca não passa pelo app: o gatilho de preço (0021/0027) recusa qualquer
-- mexida do cliente nos campos de cobrança, e é isso que impede alguém de se
-- promover para Ouro pelo navegador. Quem troca é esta função, SECURITY
-- DEFINER, que confere o dono e recalcula o valor no servidor.
--
-- Duas situações, tratadas de forma diferente:
--
--   • SUBIR de plano (o novo valor passa do que já foi pago): o campeonato
--     volta para `pending` com a diferença a pagar. Nada é apagado — times,
--     elencos, tabela e súmulas continuam onde estão; o painel é que fica
--     fechado até o Asaas confirmar, exatamente como na criação.
--
--   • DESCER de plano, ou trocar por outro do mesmo valor: vale na hora e o
--     campeonato continua liberado. Não há devolução — quem pagou Ouro e
--     desceu para Bronze não recebe troco, e isso é dito na tela.
--
-- Para a troca não virar uma armadilha, o plano anterior fica guardado em
-- `plan_change` enquanto o pagamento não sai. Se o organizador se arrepender,
-- `revert_championship_plan` devolve o campeonato ao que era — plano, valor e
-- liberação — sem cobrar nada.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.championships add column if not exists plan_change jsonb;

comment on column public.championships.plan_change is
  'Estado anterior do plano enquanto um upgrade não é pago. NULL = nada pendente.';

-- ---------------------------------------------------------------------------
-- Quem pode mexer no plano deste campeonato?
-- ---------------------------------------------------------------------------
create or replace function public.can_change_plan(p_champ uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.championships c
     where c.id = p_champ
       and (c.owner_id = auth.uid() or public.is_master())
  );
$$;

-- ---------------------------------------------------------------------------
-- Troca o plano.
-- ---------------------------------------------------------------------------
create or replace function public.change_championship_plan(p_champ uuid, p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c            public.championships%rowtype;
  v_plan       text := lower(trim(coalesce(p_plan, '')));
  v_cats       int;
  v_novo       int;
  v_ja_pago    int;
  v_sobe       boolean;
begin
  if v_plan not in ('gratis', 'bronze', 'prata', 'ouro', 'diamante') then
    raise exception 'Plano desconhecido: %', p_plan;
  end if;

  if not public.can_change_plan(p_champ) then
    raise exception 'Somente o organizador do campeonato pode trocar o plano.';
  end if;

  select * into c from public.championships where id = p_champ;
  if not found then
    raise exception 'Campeonato % não encontrado.', p_champ;
  end if;

  if lower(coalesce(c.plan, 'gratis')) = v_plan then
    raise exception 'O campeonato já está no plano %.', public.plan_tier(v_plan);
  end if;

  v_cats := greatest(1, coalesce(jsonb_array_length(c.categories), 1));
  v_novo := public.plan_price_cents(v_plan, v_cats);

  -- O que já entrou: o valor do plano atual, se ele estiver quitado. Campeonato
  -- ainda pendente não pagou nada, mesmo tendo um valor calculado.
  v_ja_pago := case
    when c.payment_status in ('paid', 'free') then coalesce(c.amount_cents, 0)
    else 0
  end;

  v_sobe := v_novo > v_ja_pago;

  -- A marca deixa o gatilho de preço saber que a mexida vem daqui, e não do
  -- navegador de alguém (mesma trava da 0027). Vale só nesta transação.
  perform set_config('tabelaco.liberando', 'on', true);

  if v_sobe then
    update public.championships
       set plan_change = coalesce(plan_change, jsonb_build_object(
             'plan', c.plan,
             'amount_cents', c.amount_cents,
             'payment_status', c.payment_status,
             'payment_ref', c.payment_ref,
             'paid_at', c.paid_at
           )),
           plan = v_plan,
           amount_cents = v_novo,
           payment_status = 'pending',
           payment_ref = null,
           paid_at = null
     where id = p_champ;
  else
    update public.championships
       set plan_change = null,
           plan = v_plan,
           amount_cents = v_novo,
           payment_status = case when v_novo > 0 then coalesce(c.payment_status, 'free') else 'free' end,
           payment_ref = case when v_novo > 0 then c.payment_ref else null end,
           paid_at = case when v_novo > 0 then c.paid_at else null end
     where id = p_champ;
  end if;

  return jsonb_build_object(
    'plan', v_plan,
    'tier', public.plan_tier(v_plan),
    'amount_cents', v_novo,
    'cobra', v_sobe,
    'a_pagar', case when v_sobe then v_novo else 0 end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Desfaz um upgrade que ainda não foi pago.
-- ---------------------------------------------------------------------------
create or replace function public.revert_championship_plan(p_champ uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.championships%rowtype;
  v jsonb;
begin
  if not public.can_change_plan(p_champ) then
    raise exception 'Somente o organizador do campeonato pode desfazer a troca de plano.';
  end if;

  select * into c from public.championships where id = p_champ;
  if c.plan_change is null then
    raise exception 'Não há troca de plano pendente neste campeonato.';
  end if;
  if c.payment_status = 'paid' then
    raise exception 'Este upgrade já foi pago e não pode ser desfeito por aqui.';
  end if;

  v := c.plan_change;
  perform set_config('tabelaco.liberando', 'on', true);

  update public.championships
     set plan = v->>'plan',
         amount_cents = nullif(v->>'amount_cents', '')::int,
         payment_status = v->>'payment_status',
         payment_ref = v->>'payment_ref',
         paid_at = nullif(v->>'paid_at', '')::timestamptz,
         plan_change = null
   where id = p_champ;

  return jsonb_build_object('plan', v->>'plan', 'tier', public.plan_tier(v->>'plan'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Pagamento confirmado encerra a troca pendente.
--
-- Sem isto, `plan_change` ficaria para trás e o botão "desfazer" continuaria
-- na tela depois de o upgrade estar pago — oferecendo desfazer o que já foi
-- cobrado.
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
         paid_at = now(),
         plan_change = null
   where id = p_champ;
end;
$$;

revoke all on function public.mark_championship_paid(uuid, text) from public, anon, authenticated;

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
         paid_at = now(),
         plan_change = null
   where id = p_champ;

  if not found then
    raise exception 'Campeonato % não encontrado.', p_champ;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
revoke all on function public.change_championship_plan(uuid, text) from public, anon;
revoke all on function public.revert_championship_plan(uuid) from public, anon;
revoke all on function public.master_release_championship(uuid, text) from public, anon;

grant execute on function public.can_change_plan(uuid)                  to authenticated;
grant execute on function public.change_championship_plan(uuid, text)   to authenticated;
grant execute on function public.revert_championship_plan(uuid)         to authenticated;
grant execute on function public.master_release_championship(uuid, text) to authenticated;
