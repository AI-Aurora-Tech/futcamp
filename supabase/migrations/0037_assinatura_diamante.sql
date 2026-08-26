-- ===========================================================================
-- Tabelaço — Diamante por assinatura mensal
--
-- O Diamante da 0036 é pagamento único, de um campeonato. Mas o plano promete
-- CAMPEONATOS ILIMITADOS, e cobrar uma vez por campeonato contradiz isso: o
-- cliente que roda quatro competições no ano pagaria quatro vezes o plano que
-- foi vendido como "quantos você quiser".
--
-- A assinatura resolve pelo lado certo: ela é da CONTA do organizador. Ativa,
-- todos os campeonatos Diamante daquele cliente ficam abertos. É uma peça
-- nova, ao lado do pagamento único — que continua valendo para quem prefere
-- fechar um campeonato só.
--
-- Como funciona:
--
--   1. o consultor negocia e registra a proposta no campeonato: mensal ou
--      avulsa, o valor e quantos meses (12, por padrão);
--   2. o cliente lê e ACEITA o contrato — nome, documento e o texto aceito
--      ficam gravados. É o aceite que torna o compromisso exigível: o Asaas
--      não tem fidelidade nem multa, isso é nosso;
--   3. o aceite cria a assinatura como `pending` e é ela que o checkout do
--      Asaas usa (`chargeTypes: RECURRENT`, ciclo mensal, com data de
--      término em 12 meses);
--   4. o Asaas confirma a primeira cobrança, o webhook ativa a assinatura e
--      abre os campeonatos Diamante do cliente;
--   5. todo mês o cartão é debitado. Falhou, a assinatura fica `overdue` com
--      7 DIAS DE CARÊNCIA — o campeonato não cai no meio de uma rodada por
--      causa de um cartão que recusou. Passada a carência, fecha.
--
-- O débito é mensal e recorrente: NÃO consome o limite do cartão como um
-- parcelamento de 12x consumiria. Cada mês é uma cobrança de R$ 200, não uma
-- autorização de R$ 2.400.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A proposta ganha modalidade e prazo.
-- ---------------------------------------------------------------------------
alter table public.championships add column if not exists negotiated_kind   text;
alter table public.championships add column if not exists negotiated_months int;

comment on column public.championships.negotiated_kind is
  'Como o Diamante foi vendido: "avulso" (pagamento único) ou "mensal" (assinatura).';
comment on column public.championships.negotiated_months is
  'Meses de compromisso da assinatura. 12 é o padrão do contrato.';

-- ---------------------------------------------------------------------------
-- 2. A assinatura — da conta, não do campeonato.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users on delete cascade,
  provider      text not null default 'asaas',
  /** Id da assinatura no Asaas. Chega com a confirmação da primeira cobrança. */
  asaas_id      text,
  checkout_id   text,
  plan          text not null default 'diamante',
  /** Valor de CADA mês, em centavos. */
  cents         int  not null,
  cycle         text not null default 'MONTHLY',
  /**
   * pending  — aceita, esperando a primeira cobrança
   * active   — em dia
   * overdue  — cobrança falhou; vale enquanto durar a carência
   * canceled — encerrada (pelo cliente, pelo consultor ou por falta de pagamento)
   * ended    — cumpriu os meses combinados
   */
  status        text not null default 'pending'
                check (status in ('pending', 'active', 'overdue', 'canceled', 'ended')),
  months        int  not null default 12,
  started_at    timestamptz,
  next_due_at   timestamptz,
  ends_at       timestamptz,
  /** Até quando o atraso é tolerado. Fora dele, os campeonatos fecham. */
  grace_until   timestamptz,

  -- O aceite. O Asaas não guarda contrato; quem precisa provar o compromisso
  -- de 12 meses somos nós.
  contract_version  text,
  contract_text     text,
  contract_name     text,
  contract_document text,
  contract_ip       text,
  contract_at       timestamptz,

  /** Campeonato pelo qual a negociação entrou (para o consultor se achar). */
  origin_champ  uuid references public.championships on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists subscriptions_owner_idx on public.subscriptions (owner_id, status);
create unique index if not exists subscriptions_asaas_idx
  on public.subscriptions (asaas_id) where asaas_id is not null;

-- Uma assinatura viva por conta. Encerrada não atrapalha a próxima.
create unique index if not exists subscriptions_viva_idx
  on public.subscriptions (owner_id)
  where status in ('pending', 'active', 'overdue');

alter table public.subscriptions enable row level security;

-- O dono lê a própria; o master lê todas. Escrever, só pelas funções abaixo.
drop policy if exists subscriptions_read on public.subscriptions;
create policy subscriptions_read on public.subscriptions
  for select using (owner_id = auth.uid() or public.is_master());

-- ---------------------------------------------------------------------------
-- 3. A assinatura está valendo?
--
-- Em dia vale. Atrasada vale enquanto durar a carência — é justamente para
-- isso que ela existe. Fora disso, não vale.
-- ---------------------------------------------------------------------------
create or replace function public.assinatura_ativa(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
     where s.owner_id = p_owner
       and (
         s.status = 'active'
         or (s.status = 'overdue' and s.grace_until is not null and now() <= s.grace_until)
       )
  );
$$;

grant execute on function public.assinatura_ativa(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A assinatura manda nos campeonatos Diamante do cliente.
--
-- Uma função só, chamada sempre que a situação da assinatura muda. Abre todos
-- os campeonatos Diamante daquele dono quando ela vale, e fecha quando não
-- vale — menos os que foram pagos avulsos, que já estão quitados por conta
-- própria e não podem ser fechados por causa de uma assinatura alheia a eles.
-- ---------------------------------------------------------------------------
create or replace function public.assinatura_sincronizar(p_owner uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vale boolean;
  v_qtd  int;
begin
  v_vale := public.assinatura_ativa(p_owner);

  perform set_config('tabelaco.liberando', 'on', true);

  if v_vale then
    update public.championships
       set payment_status = 'paid',
           payment_ref = coalesce(payment_ref, 'assinatura Diamante'),
           paid_at = coalesce(paid_at, now())
     where owner_id = p_owner
       and lower(coalesce(plan, '')) = 'diamante'
       and payment_status <> 'paid';
  else
    -- Campeonato quitado à parte (pagamento avulso) não é fechado: o dinheiro
    -- dele entrou, e a assinatura não tem nada a ver com aquele contrato.
    update public.championships
       set payment_status = 'pending'
     where owner_id = p_owner
       and lower(coalesce(plan, '')) = 'diamante'
       and payment_status = 'paid'
       and coalesce(payment_ref, '') = 'assinatura Diamante';
  end if;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke all on function public.assinatura_sincronizar(uuid) from public, anon, authenticated;
grant execute on function public.assinatura_sincronizar(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. O cliente aceita o contrato.
--
-- É o aceite que cria a assinatura — antes dele não há nada a cobrar. Guarda
-- o TEXTO aceito, e não só a versão: contrato é o que a pessoa leu naquele
-- dia, e reconstruí-lo depois a partir de um número de versão é confiar que
-- ninguém mexeu no arquivo.
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
  c      public.championships;
  v_id   uuid;
  v_meses int;
  v_cents int;
begin
  select * into c from public.championships where id = p_champ;
  if c.id is null then
    raise exception 'Campeonato % não encontrado.', p_champ;
  end if;
  if c.owner_id is distinct from auth.uid() then
    raise exception 'Somente o organizador do campeonato aceita o contrato.';
  end if;
  if lower(coalesce(c.negotiated_kind, '')) <> 'mensal' then
    raise exception 'Este campeonato não foi negociado como assinatura mensal.';
  end if;

  v_cents := coalesce(c.negotiated_cents, 0);
  v_meses := greatest(1, coalesce(c.negotiated_months, 12));
  if v_cents <= 0 then
    raise exception 'O consultor ainda não registrou o valor mensal.';
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
-- 6. O Asaas manda notícia (só a service role escreve).
--
-- `p_situacao` é o que a Edge Function concluiu da API do Asaas:
--   'paga'    — cobrança do mês confirmada
--   'atrasada'— cobrança venceu sem pagar
--   'cancelada'
-- ---------------------------------------------------------------------------
create or replace function public.assinatura_atualizar(
  p_owner     uuid,
  p_situacao  text,
  p_asaas_id  text default null,
  p_checkout  text default null,
  p_proxima   timestamptz default null,
  p_carencia_dias int default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s      public.subscriptions;
  v_novo text;
begin
  select * into s
    from public.subscriptions
   where owner_id = p_owner and status in ('pending', 'active', 'overdue')
   order by created_at desc
   limit 1;

  if s.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem assinatura viva para esta conta');
  end if;

  v_novo := case lower(coalesce(p_situacao, ''))
              when 'paga'      then 'active'
              when 'atrasada'  then 'overdue'
              when 'cancelada' then 'canceled'
              else s.status
            end;

  update public.subscriptions
     set status      = v_novo,
         asaas_id    = coalesce(p_asaas_id, asaas_id),
         checkout_id = coalesce(p_checkout, checkout_id),
         started_at  = case when v_novo = 'active' then coalesce(started_at, now()) else started_at end,
         -- O término é contado da PRIMEIRA cobrança: 12 meses de contrato
         -- começam quando o cliente começa a pagar, não quando ele assina.
         ends_at     = case
                         when v_novo = 'active' and ends_at is null
                           then now() + make_interval(months => s.months)
                         else ends_at
                       end,
         next_due_at = coalesce(p_proxima, next_due_at),
         grace_until = case
                         when v_novo = 'overdue'
                           then coalesce(grace_until, now() + make_interval(days => greatest(0, p_carencia_dias)))
                         when v_novo = 'active' then null
                         else grace_until
                       end,
         updated_at  = now()
   where id = s.id;

  perform public.assinatura_sincronizar(p_owner);

  return jsonb_build_object('ok', true, 'status', v_novo, 'id', s.id);
end;
$$;

revoke all on function public.assinatura_atualizar(uuid, text, text, text, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.assinatura_atualizar(uuid, text, text, text, timestamptz, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. A varredura da carência.
--
-- A carência vence pelo RELÓGIO, e relógio nenhum dispara gatilho. Esta
-- função é chamada pelo agendamento (a mesma programação que já entrega os
-- avisos) e fecha o que passou do prazo.
--
-- Também encerra, sem drama, a assinatura que cumpriu os meses combinados.
-- ---------------------------------------------------------------------------
create or replace function public.assinaturas_varrer()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  v_qtd int := 0;
begin
  -- Carência estourada: a assinatura cai e os campeonatos fecham.
  for r in
    select id, owner_id from public.subscriptions
     where status = 'overdue'
       and grace_until is not null
       and now() > grace_until
  loop
    update public.subscriptions
       set status = 'canceled', updated_at = now()
     where id = r.id;
    perform public.assinatura_sincronizar(r.owner_id);
    v_qtd := v_qtd + 1;
  end loop;

  -- Cumpriu o contrato: encerra sem fechar nada à força — quem estava em dia
  -- termina em dia, e a renovação é conversa do consultor.
  for r in
    select id, owner_id from public.subscriptions
     where status = 'active' and ends_at is not null and now() > ends_at
  loop
    update public.subscriptions
       set status = 'ended', updated_at = now()
     where id = r.id;
    perform public.assinatura_sincronizar(r.owner_id);
    v_qtd := v_qtd + 1;
  end loop;

  return v_qtd;
end;
$$;

revoke all on function public.assinaturas_varrer() from public, anon, authenticated;
grant execute on function public.assinaturas_varrer() to service_role;

-- ---------------------------------------------------------------------------
-- 8. A proposta do consultor: mensal ou avulsa.
--
-- Substitui a `set_negotiated_price` da 0036, que só sabia de valor. Agora
-- carrega a modalidade e o prazo — é a diferença entre "R$ 2.500 uma vez" e
-- "R$ 200 por mês durante 12 meses".
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

  perform set_config('tabelaco.liberando', 'on', true);

  update public.championships
     set negotiated_cents  = nullif(v_cents, 0),
         negotiated_note   = nullif(btrim(coalesce(p_nota, '')), ''),
         negotiated_at     = case when v_cents > 0 then now() end,
         negotiated_kind   = case when v_cents > 0 then v_kind end,
         negotiated_months = case when v_cents > 0 and v_kind = 'mensal' then v_meses end,
         -- No mensal, `amount_cents` é a MENSALIDADE. Quem abre o campeonato é
         -- a assinatura, não este número.
         amount_cents      = v_cents,
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

-- A versão de 3 parâmetros da 0036 precisa SAIR: com ela viva, uma chamada
-- com 3 argumentos ficaria ambígua entre as duas.
drop function if exists public.set_negotiated_price(uuid, int, text);

revoke all on function public.set_negotiated_price(uuid, int, text, text, int) from public, anon;
grant execute on function public.set_negotiated_price(uuid, int, text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Cancelar a assinatura (consultor).
--
-- Cancelar no Asaas é assunto da Edge Function; aqui fica o registro e o
-- efeito: os campeonatos que dependiam dela fecham.
-- ---------------------------------------------------------------------------
create or replace function public.assinatura_cancelar(p_owner uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_master() then
    raise exception 'Somente o administrador master cancela uma assinatura.';
  end if;

  update public.subscriptions
     set status = 'canceled',
         contract_version = coalesce(contract_version, ''),
         updated_at = now()
   where owner_id = p_owner and status in ('pending', 'active', 'overdue')
   returning id into v_id;

  if v_id is null then
    raise exception 'Esta conta não tem assinatura ativa.';
  end if;

  perform public.assinatura_sincronizar(p_owner);
  return jsonb_build_object('ok', true, 'id', v_id, 'motivo', p_motivo);
end;
$$;

revoke all on function public.assinatura_cancelar(uuid, text) from public, anon;
grant execute on function public.assinatura_cancelar(uuid, text) to authenticated;
