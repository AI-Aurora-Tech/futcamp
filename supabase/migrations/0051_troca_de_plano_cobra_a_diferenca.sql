-- ===========================================================================
-- Tabelaço — subir de plano cobra só a DIFERENÇA
--
-- A tela e o guia diziam "subir de plano cobra a diferença", mas o banco
-- gravava o preço CHEIO do plano novo e o checkout cobrava esse valor: quem
-- tinha pago o Bronze (R$ 59,90) e passava para o Prata (R$ 79,90) pagava
-- R$ 79,90 outra vez, em vez de R$ 20,00.
--
-- `amount_cents` continua sendo o valor TOTAL do plano (é o que o gatilho de
-- preço recalcula e o que conta como "já pago" na próxima troca). A novidade é
-- `due_cents`: o que falta pagar AGORA. Nulo = vale o `amount_cents` inteiro
-- (campeonato novo, ainda sem pagamento). O checkout e a conferência do
-- webhook passam a ler `coalesce(due_cents, amount_cents)`.
--
-- Também corrige, na mesma função, a troca PARA o Diamante: ela saía de graça
-- (valor 0, campeonato liberado). O Diamante é assinatura mensal — vai para
-- pendente e a cobrança é a da assinatura, sem abatimento do plano anterior.
--
-- E fecha um furo antigo: o plano era editável por UPDATE direto do
-- navegador, sem pagar. Agora só muda pela função de troca.
--
-- Campeonatos existentes não são alterados: `due_cents` nasce nulo.
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.championships add column if not exists due_cents int;

comment on column public.championships.due_cents is
  'Valor a cobrar AGORA, em centavos (upgrade de plano: só a diferença). NULL = amount_cents inteiro.';

-- ---------------------------------------------------------------------------
-- O gatilho de preço protege `due_cents` e o refaz quando as categorias mudam
-- durante um upgrade pendente. Quem pagou menos não pode virar "devido menor":
-- o app nunca escreve nele.
-- ---------------------------------------------------------------------------
create or replace function public.set_championship_price()
returns trigger
language plpgsql
as $$
declare
  v_cats       int;
  v_cents      int;
  v_diamante   boolean;
  v_autorizado boolean;
  v_base       int;
begin
  v_cats     := greatest(1, coalesce(jsonb_array_length(new.categories), 1));
  v_diamante := lower(coalesce(new.plan, '')) = 'diamante';

  if v_diamante then
    if new.negotiated_kind is null then new.negotiated_kind := 'mensal'; end if;
    if new.negotiated_kind = 'mensal' and new.negotiated_months is null then
      new.negotiated_months := 12;
    end if;
  end if;

  v_autorizado :=
    auth.role() = 'service_role'
    or coalesce(current_setting('tabelaco.liberando', true), '') = 'on';

  if tg_op = 'INSERT' then
    if v_diamante and not v_autorizado then
      new.negotiated_cents := null;
      new.negotiated_note  := null;
      new.negotiated_at    := null;
    end if;
    v_cents := public.preco_do_campeonato(new.plan, v_cats, new.negotiated_cents);

    new.amount_cents := v_cents;
    new.due_cents := null;
    new.payment_status := case
      when v_cents > 0 or v_diamante then 'pending'
      else 'free'
    end;
    new.payment_ref := null;
    new.paid_at := null;
    return new;
  end if;

  if not v_autorizado then
    -- O plano só muda por `change_championship_plan`, que cobra a diferença. Um
    -- UPDATE direto do navegador (o organizador tem a chave e a sessão) trocaria
    -- o Bronze pago por Ouro sem pagar nada.
    new.plan             := old.plan;
    new.payment_status   := old.payment_status;
    new.payment_ref      := old.payment_ref;
    new.paid_at          := old.paid_at;
    new.negotiated_cents := old.negotiated_cents;
    new.negotiated_note  := old.negotiated_note;
    new.negotiated_at    := old.negotiated_at;
    new.negotiated_kind  := coalesce(old.negotiated_kind, new.negotiated_kind);
    new.negotiated_months := coalesce(old.negotiated_months, new.negotiated_months);
    new.due_cents        := old.due_cents;

    if old.payment_status = 'pending' then
      new.amount_cents := public.preco_do_campeonato(new.plan, v_cats, old.negotiated_cents);
      -- Upgrade pendente: o devido é o novo total menos o que já tinha sido pago.
      if old.plan_change is not null and lower(coalesce(new.plan, '')) <> 'diamante' then
        v_base := case
          when old.plan_change ->> 'payment_status' in ('paid', 'free')
            then coalesce(nullif(old.plan_change ->> 'amount_cents', '')::int, 0)
          else 0
        end;
        new.due_cents := greatest(0, new.amount_cents - v_base);
      end if;
    else
      new.amount_cents := old.amount_cents;
    end if;

    if lower(coalesce(new.plan, '')) = 'diamante'
       and lower(coalesce(old.plan, '')) is distinct from 'diamante'
       and old.payment_status <> 'paid' then
      new.payment_status := 'pending';
    end if;
  end if;

  -- Liberado (pago ou grátis) não deve nada.
  if new.payment_status in ('paid', 'free') then
    new.due_cents := null;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trocar de plano.
-- ---------------------------------------------------------------------------
create or replace function public.change_championship_plan(p_champ uuid, p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c         public.championships%rowtype;
  v_plan    text := lower(trim(coalesce(p_plan, '')));
  v_cats    int;
  v_novo    int;
  v_origem  jsonb;
  v_base    int;
  v_sobe    boolean;
  v_deve    int;
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
  v_novo := public.preco_do_campeonato(
    v_plan, v_cats, case when v_plan = 'diamante' then c.negotiated_cents end
  );

  -- A ORIGEM da troca: se já há um upgrade pendente, é o estado de antes dele.
  -- Assim, quem trocou duas vezes sem pagar não perde o abatimento do que pagou.
  v_origem := coalesce(c.plan_change, jsonb_build_object(
    'plan', c.plan,
    'amount_cents', c.amount_cents,
    'payment_status', c.payment_status,
    'payment_ref', c.payment_ref,
    'paid_at', c.paid_at
  ));

  -- O que já foi pago do plano de origem. Pendente nunca pagou nada.
  v_base := case
    when v_origem ->> 'payment_status' in ('paid', 'free')
      then coalesce(nullif(v_origem ->> 'amount_cents', '')::int, 0)
    else 0
  end;

  -- O Diamante é assinatura mensal: sempre vai para pendente e a cobrança é a
  -- da assinatura, sem abater o plano anterior.
  v_sobe := v_plan = 'diamante' or v_novo > v_base;
  v_deve := case
    when v_plan = 'diamante' then null
    when v_sobe then v_novo - v_base
    else null
  end;

  perform set_config('tabelaco.liberando', 'on', true);

  if v_sobe then
    update public.championships
       set plan_change = v_origem,
           plan = v_plan,
           amount_cents = v_novo,
           due_cents = v_deve,
           payment_status = 'pending',
           payment_ref = null,
           paid_at = null
     where id = p_champ;
  else
    -- Descer (ou valor igual): vale na hora e volta ao estado de origem, já
    -- pago. Não há devolução.
    update public.championships
       set plan_change = null,
           plan = v_plan,
           amount_cents = v_novo,
           due_cents = null,
           payment_status = case
             when v_novo = 0 then 'free'
             else coalesce(nullif(v_origem ->> 'payment_status', ''), 'free')
           end,
           payment_ref = case when v_novo > 0 then v_origem ->> 'payment_ref' else null end,
           paid_at = case when v_novo > 0 then nullif(v_origem ->> 'paid_at', '')::timestamptz else null end
     where id = p_champ;
  end if;

  return jsonb_build_object(
    'plan', v_plan,
    'tier', public.plan_tier(v_plan),
    'amount_cents', v_novo,
    'cobra', v_sobe,
    'ja_pago', v_base,
    'a_pagar', case when v_sobe then coalesce(v_deve, v_novo) else 0 end
  );
end;
$$;

-- Desfazer o upgrade pendente: volta ao estado de antes, sem dívida.
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
         due_cents = null,
         payment_status = v->>'payment_status',
         payment_ref = v->>'payment_ref',
         paid_at = nullif(v->>'paid_at', '')::timestamptz,
         plan_change = null
   where id = p_champ;

  return jsonb_build_object('plan', v->>'plan', 'tier', public.plan_tier(v->>'plan'));
end;
$$;

-- Pagamento confirmado: quita o devido e encerra a troca pendente. O
-- `amount_cents` (total do plano) fica — é a base da próxima troca.
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
         due_cents = null,
         plan_change = null
   where id = p_champ;
end;
$$;

revoke all on function public.mark_championship_paid(uuid, text) from public, anon, authenticated;
revoke all on function public.change_championship_plan(uuid, text) from public, anon;
revoke all on function public.revert_championship_plan(uuid) from public, anon;
grant execute on function public.change_championship_plan(uuid, text) to authenticated;
grant execute on function public.revert_championship_plan(uuid) to authenticated;
