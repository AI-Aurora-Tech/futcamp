-- ===========================================================================
-- Tabelaço — o Diamante passa a ser contratado sozinho
--
-- Com o preço na vitrine (R$ 200,00/mês), "a combinar" deixou de fazer
-- sentido: o cliente lê o valor na tabela de planos, escolhe o Diamante e
-- esbarra numa tela dizendo para falar com um consultor. Publicar preço e
-- exigir intermediário para cobrá-lo é pedir para a pessoa desistir no meio.
--
-- A partir daqui o Diamante nasce PRONTO PARA CONTRATAR:
--
--   • modalidade `mensal`, 12 meses, R$ 200,00/mês — o valor de tabela;
--   • o cliente lê e aceita o contrato e assina no cartão, sozinho;
--   • a cobrança é RECURRENT no Asaas, SÓ no cartão de crédito, debitada mês
--     a mês. Não é parcelamento: o limite do cliente não fica preso no total.
--
-- O consultor não sai de cena — ele continua podendo registrar um valor
-- diferente (ou um contrato avulso) para o cliente que negociou. O que muda é
-- que a presença dele deixa de ser OBRIGATÓRIA para o preço de tabela.
--
-- O campeonato continua nascendo FECHADO. Nada aqui afrouxa a trava da 0036:
-- quem não pagou não entra.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A mensalidade de tabela, no banco.
--
-- O valor mostrado ao cliente e o valor cobrado precisam ser o mesmo número, e
-- quem cobra é o servidor. Espelha `monthlyCents` de `src/lib/pricing.ts` —
-- como `plan_price_cents` já espelha os demais preços desde a 0021.
-- ---------------------------------------------------------------------------
create or replace function public.plan_monthly_cents(p_plan text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p_plan, '')) when 'diamante' then 20000 else 0 end;
$$;

comment on function public.plan_monthly_cents(text) is
  'Mensalidade de tabela do plano, em centavos. Só o Diamante é cobrado por mês.';

-- ---------------------------------------------------------------------------
-- 2. Sem negociação, vale a tabela.
--
-- Antes, Diamante sem valor combinado custava zero — e zero deixava o
-- campeonato parado esperando o consultor. Agora ele custa o preço de tabela,
-- e o cliente pode seguir sozinho.
-- ---------------------------------------------------------------------------
create or replace function public.preco_do_campeonato(
  p_plan text, p_cats int, p_negociado int
)
returns int
language sql
immutable
as $$
  select case
    when lower(coalesce(p_plan, '')) = 'diamante'
      then coalesce(nullif(greatest(0, coalesce(p_negociado, 0)), 0),
                    public.plan_monthly_cents(p_plan))
    else public.plan_price_cents(p_plan, p_cats)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. O Diamante nasce mensal.
--
-- A normalização vale para QUALQUER escrita, autorizada ou não, e roda antes
-- de tudo: é o que faz o campeonato criado pelo formulário e o campeonato que
-- virou Diamante numa troca de plano chegarem no mesmo estado.
--
-- Só preenche o que está vazio. O consultor que marcou "avulso" continua com
-- "avulso".
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
begin
  v_cats     := greatest(1, coalesce(jsonb_array_length(new.categories), 1));
  v_diamante := lower(coalesce(new.plan, '')) = 'diamante';

  -- Diamante sem modalidade é Diamante de tabela: mensal, 12 meses.
  if v_diamante then
    if new.negotiated_kind is null then new.negotiated_kind := 'mensal'; end if;
    if new.negotiated_kind = 'mensal' and new.negotiated_months is null then
      new.negotiated_months := 12;
    end if;
  end if;

  -- Liberação autorizada: ou é a service role (webhook), ou é uma das funções
  -- de liberação/negociação, que marcam a transação antes de escrever.
  v_autorizado :=
    auth.role() = 'service_role'
    or coalesce(current_setting('tabelaco.liberando', true), '') = 'on';

  if tg_op = 'INSERT' then
    -- Ninguém combina preço no formulário de criação: o valor é o de tabela
    -- até um consultor dizer outra coisa.
    if v_diamante and not v_autorizado then
      new.negotiated_cents := null;
      new.negotiated_note  := null;
      new.negotiated_at    := null;
    end if;
    v_cents := public.preco_do_campeonato(new.plan, v_cats, new.negotiated_cents);

    new.amount_cents := v_cents;
    -- Diamante é sempre pago. Fica pendente até a assinatura ser confirmada —
    -- e é "pendente" que mantém o campeonato fechado.
    new.payment_status := case
      when v_cents > 0 or v_diamante then 'pending'
      else 'free'
    end;
    new.payment_ref := null;
    new.paid_at := null;
    return new;
  end if;

  if not v_autorizado then
    -- Pagamento e negociação são assunto do servidor. O app não mexe.
    new.payment_status   := old.payment_status;
    new.payment_ref      := old.payment_ref;
    new.paid_at          := old.paid_at;
    new.negotiated_cents := old.negotiated_cents;
    new.negotiated_note  := old.negotiated_note;
    new.negotiated_at    := old.negotiated_at;
    new.negotiated_kind  := coalesce(old.negotiated_kind, new.negotiated_kind);
    new.negotiated_months := coalesce(old.negotiated_months, new.negotiated_months);

    -- Enquanto não está pago, mudar as categorias mexe no valor devido.
    if old.payment_status = 'pending' then
      new.amount_cents := public.preco_do_campeonato(new.plan, v_cats, old.negotiated_cents);
    else
      new.amount_cents := old.amount_cents;
    end if;

    -- Trocar PARA o Diamante pelo app não pode liberar nada: volta a pendente.
    if lower(coalesce(new.plan, '')) = 'diamante'
       and lower(coalesce(old.plan, '')) is distinct from 'diamante'
       and old.payment_status <> 'paid' then
      new.payment_status := 'pending';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. O aceite passa a valer sem consultor.
--
-- A versão da 0037 exigia `negotiated_cents` preenchido — isto é, exigia que
-- alguém tivesse negociado. Agora o valor sai de `preco_do_campeonato`, que
-- cai na tabela quando não há negociação.
-- ---------------------------------------------------------------------------
create or replace function public.assinatura_aceitar(
  p_champ    uuid,
  p_nome     text,
  p_documento text,
  p_versao   text,
  p_texto    text,
  p_ip       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c       public.championships;
  v_id    uuid;
  v_meses int;
  v_cents int;
  v_cats  int;
begin
  select * into c from public.championships where id = p_champ;
  if c.id is null then
    raise exception 'Campeonato % não encontrado.', p_champ;
  end if;
  if c.owner_id is distinct from auth.uid() then
    raise exception 'Somente o organizador do campeonato aceita o contrato.';
  end if;
  if lower(coalesce(c.plan, '')) <> 'diamante' then
    raise exception 'A assinatura mensal é do plano Diamante.';
  end if;
  -- Sem modalidade gravada (campeonato anterior à 0038), vale a de tabela.
  if lower(coalesce(c.negotiated_kind, 'mensal')) <> 'mensal' then
    raise exception 'Este campeonato foi negociado como pagamento único, não como assinatura.';
  end if;

  v_cats  := greatest(1, coalesce(jsonb_array_length(c.categories), 1));
  v_cents := public.preco_do_campeonato(c.plan, v_cats, c.negotiated_cents);
  v_meses := greatest(1, coalesce(c.negotiated_months, 12));
  if v_cents <= 0 then
    raise exception 'Este plano está sem valor definido. Fale com o suporte.';
  end if;
  if coalesce(btrim(p_nome), '') = '' or coalesce(btrim(p_documento), '') = '' then
    raise exception 'Informe o nome e o documento de quem está aceitando.';
  end if;
  if coalesce(btrim(p_texto), '') = '' then
    raise exception 'O contrato aceito precisa ser guardado por inteiro.';
  end if;

  -- Já existe assinatura viva desta conta? O aceite é atualizado, não
  -- duplicado — senão o índice de "uma viva por conta" recusaria.
  select id into v_id
    from public.subscriptions
   where owner_id = c.owner_id and status in ('pending', 'active', 'overdue');

  if v_id is not null then
    update public.subscriptions
       set cents = case when status = 'pending' then v_cents else cents end,
           months = case when status = 'pending' then v_meses else months end,
           contract_version = p_versao,
           contract_text = p_texto,
           contract_name = btrim(p_nome),
           contract_document = btrim(p_documento),
           contract_ip = nullif(btrim(coalesce(p_ip, '')), ''),
           contract_at = now(),
           origin_champ = coalesce(origin_champ, p_champ),
           updated_at = now()
     where id = v_id;
  else
    insert into public.subscriptions (
      owner_id, cents, months, status, origin_champ,
      contract_version, contract_text, contract_name, contract_document, contract_ip, contract_at
    ) values (
      c.owner_id, v_cents, v_meses, 'pending', p_champ,
      p_versao, p_texto, btrim(p_nome), btrim(p_documento),
      nullif(btrim(coalesce(p_ip, '')), ''), now()
    )
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id, 'cents', v_cents, 'months', v_meses);
end;
$$;

revoke all on function public.assinatura_aceitar(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.assinatura_aceitar(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Zerar o valor devolve o plano à tabela.
--
-- "A combinar" deixou de existir: o Diamante tem preço publicado. O consultor
-- que apaga o valor negociado está desfazendo a negociação, e o que sobra é o
-- plano padrão — mensal, 12 meses, R$ 200,00.
-- ---------------------------------------------------------------------------
create or replace function public.set_negotiated_price(
  p_champ  uuid,
  p_cents  int,
  p_nota   text default null,
  p_kind   text default 'avulso',
  p_months int default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ public.championships;
  v_cents int;
  v_kind  text;
  v_meses int;
  v_cats  int;
begin
  if not public.is_master() then
    raise exception 'Somente o administrador master define o valor do plano Diamante.';
  end if;

  select * into v_champ from public.championships where id = p_champ;
  if v_champ.id is null then
    raise exception 'Campeonato % não encontrado.', p_champ;
  end if;
  if lower(coalesce(v_champ.plan, '')) <> 'diamante' then
    raise exception 'O valor negociado é do plano Diamante. Este campeonato é do plano %.',
      coalesce(v_champ.plan, 'grátis');
  end if;
  if v_champ.payment_status = 'paid' then
    raise exception 'Este campeonato já está pago. Mudar o valor agora não teria efeito.';
  end if;

  v_kind := lower(coalesce(nullif(btrim(p_kind), ''), 'avulso'));
  if v_kind not in ('avulso', 'mensal') then
    raise exception 'Modalidade desconhecida: % (use "avulso" ou "mensal").', p_kind;
  end if;

  v_cents := greatest(0, coalesce(p_cents, 0));
  if v_cents > 100000000 then
    raise exception 'Valor acima do limite (R$ 1.000.000,00). Confira o que foi digitado.';
  end if;

  v_meses := greatest(1, coalesce(p_months, 12));
  if v_meses > 60 then
    raise exception 'Prazo acima do limite (60 meses). Confira o que foi digitado.';
  end if;

  -- Sem valor, volta ao plano de tabela — e não a um limbo sem preço.
  if v_cents = 0 then
    v_kind  := 'mensal';
    v_meses := 12;
  end if;

  v_cats := greatest(1, coalesce(jsonb_array_length(v_champ.categories), 1));

  perform set_config('tabelaco.liberando', 'on', true);

  update public.championships
     set negotiated_cents  = nullif(v_cents, 0),
         negotiated_note   = nullif(btrim(coalesce(p_nota, '')), ''),
         negotiated_at     = case when v_cents > 0 then now() end,
         negotiated_kind   = v_kind,
         negotiated_months = case when v_kind = 'mensal' then v_meses end,
         amount_cents      = public.preco_do_campeonato(plan, v_cats, nullif(v_cents, 0)),
         payment_status    = 'pending'
   where id = p_champ
   returning * into v_champ;

  return jsonb_build_object(
    'id', v_champ.id,
    'amount_cents', v_champ.amount_cents,
    'negotiated_cents', v_champ.negotiated_cents,
    'negotiated_kind', v_champ.negotiated_kind,
    'negotiated_months', v_champ.negotiated_months,
    'payment_status', v_champ.payment_status
  );
end;
$$;

revoke all on function public.set_negotiated_price(uuid, int, text, text, int) from public, anon;
grant execute on function public.set_negotiated_price(uuid, int, text, text, int) to authenticated;

grant execute on function public.plan_monthly_cents(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. O que já existe
--
-- Campeonato Diamante criado antes desta migration está sem modalidade e sem
-- valor — parado esperando um consultor que agora não é mais necessário.
-- Passa a valer o plano de tabela.
--
-- Não mexe em situação de pagamento: quem está fechado continua fechado, quem
-- está liberado continua liberado.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('tabelaco.liberando', 'on', true);

  update public.championships
     set negotiated_kind   = 'mensal',
         negotiated_months = coalesce(negotiated_months, 12)
   where lower(coalesce(plan, '')) = 'diamante'
     and negotiated_kind is null;

  update public.championships c
     set amount_cents = public.preco_do_campeonato(
           c.plan,
           greatest(1, coalesce(jsonb_array_length(c.categories), 1)),
           c.negotiated_cents)
   where lower(coalesce(c.plan, '')) = 'diamante'
     and c.payment_status = 'pending'
     and coalesce(c.amount_cents, 0) = 0;
end
$$;
