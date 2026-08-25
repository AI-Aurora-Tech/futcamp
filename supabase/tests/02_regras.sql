\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function pg_temp.checa(rotulo text, ok boolean) returns void language plpgsql as $$
begin
  raise notice '%  %', case when ok then '✅' else '❌ FALHOU' end, rotulo;
end $$;

-- Espera que o comando FALHE, e confere a mensagem.
create or replace function pg_temp.recusa(rotulo text, sql text, trecho text) returns void language plpgsql as $$
begin
  execute sql;
  raise notice '❌ FALHOU  % (deixou passar)', rotulo;
exception when others then
  if position(lower(trecho) in lower(sqlerrm)) > 0 then
    raise notice '✅ %', rotulo;
  else
    raise notice '❌ FALHOU  % — erro inesperado: %', rotulo, sqlerrm;
  end if;
end $$;

-- ===========================================================================
-- Preço do campeonato (0021): o valor é do banco, não do navegador.
-- ===========================================================================
select pg_temp.checa('grátis não cobra',            plan_price_cents('gratis', 1) = 0);
select pg_temp.checa('bronze 1 categoria',          plan_price_cents('bronze', 1) = 5990);
select pg_temp.checa('bronze 4 categorias',         plan_price_cents('bronze', 4) = 5990 + 3*3990);
select pg_temp.checa('prata 3 categorias',          plan_price_cents('prata', 3) = 7990 + 2*4990);
select pg_temp.checa('ouro 3 categorias',           plan_price_cents('ouro', 3) = 10990 + 2*5990);
select pg_temp.checa('diamante é sob consulta',     plan_price_cents('diamante', 3) = 0);
select pg_temp.checa('plano nulo cai no grátis',    plan_price_cents(null, 3) = 0);

-- O gatilho recalcula na inserção: mandar amount_cents = 0 não adianta.
insert into public.championships (id, owner_id, name, sport, format, season, plan, amount_cents, categories)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
        'Copa Paga', 'futebol', 'league', '2026', 'ouro', 0,
        '[{"id":"c1","name":"A"},{"id":"c2","name":"B"},{"id":"c3","name":"C"}]'::jsonb);

select pg_temp.checa('preço calculado pelo banco, não pelo cliente',
  (select amount_cents from championships where id = '44444444-4444-4444-4444-444444444444') = 10990 + 2*5990);
select pg_temp.checa('nasce bloqueado',
  (select payment_status from championships where id = '44444444-4444-4444-4444-444444444444') = 'pending');

-- Cliente tentando se liberar sozinho.
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub  = '11111111-1111-1111-1111-111111111111';
update public.championships set payment_status = 'paid', amount_cents = 1
 where id = '44444444-4444-4444-4444-444444444444';
select pg_temp.checa('app não consegue se marcar como pago',
  (select payment_status from championships where id = '44444444-4444-4444-4444-444444444444') = 'pending');
select pg_temp.checa('nem baixar o valor devido',
  (select amount_cents from championships where id = '44444444-4444-4444-4444-444444444444') = 10990 + 2*5990);

-- O webhook (service role) consegue.
select public.mark_championship_paid('44444444-4444-4444-4444-444444444444', 'pay_123');
select pg_temp.checa('a RPC do servidor libera',
  (select payment_status from championships where id = '44444444-4444-4444-4444-444444444444') = 'paid');

-- ===========================================================================
-- Federados por categoria (0026)
-- ===========================================================================
update public.championships
   set audience = 'infantil',
       categories = '[{"id":"cat1","name":"Sub-13","allowFederated":true,"maxFederated":2},
                      {"id":"cat2","name":"Sub-11"}]'::jsonb
 where id = '22222222-2222-2222-2222-222222222222';

select pg_temp.checa('lê a regra da categoria que aceita',
  (category_federated_rule('22222222-2222-2222-2222-222222222222','cat1')->>'maxFederated')::int = 2);
select pg_temp.checa('categoria sem a marcação não aceita',
  coalesce((category_federated_rule('22222222-2222-2222-2222-222222222222','cat2')->>'allowFederated')::boolean, false) = false);

select public.reg_add_player('33333333-3333-3333-3333-333333333333','tok123','Ana','52998224725','2012-01-01',null,null,null,'cat1','atleta', true, 'campo');
select public.reg_add_player('33333333-3333-3333-3333-333333333333','tok123','Bia','11144477735','2012-01-01',null,null,null,'cat1','atleta', true, 'futsal');
select pg_temp.checa('dois federados no Sub-13', count_federated('33333333-3333-3333-3333-333333333333','cat1') = 2);

select pg_temp.recusa('terceiro federado no Sub-13 é recusado',
  $q$ select public.reg_add_player('33333333-3333-3333-3333-333333333333','tok123','Carla','39053344705','2012-01-01',null,null,null,'cat1','atleta', true, 'campo') $q$,
  'Limite de 2');

select pg_temp.recusa('federado no Sub-11 é recusado',
  $q$ select public.reg_add_player('33333333-3333-3333-3333-333333333333','tok123','Dora','16899535009','2014-01-01',null,null,null,'cat2','atleta', true, 'campo') $q$,
  'não aceita atletas federados');

-- Lotar o Sub-13 não pode travar outra categoria.
update public.championships
   set categories = '[{"id":"cat1","name":"Sub-13","allowFederated":true,"maxFederated":2},
                      {"id":"cat2","name":"Sub-11","allowFederated":true,"maxFederated":1}]'::jsonb
 where id = '22222222-2222-2222-2222-222222222222';
select public.reg_add_player('33333333-3333-3333-3333-333333333333','tok123','Eva','16899535009','2014-01-01',null,null,null,'cat2','atleta', true, 'campo');
select pg_temp.checa('Sub-13 lotado não impede o Sub-11', count_federated('33333333-3333-3333-3333-333333333333','cat2') = 1);

select pg_temp.recusa('link errado não inscreve ninguém',
  $q$ select public.reg_add_player('33333333-3333-3333-3333-333333333333','TOKEN-ERRADO','X','52998224725','2012-01-01',null,null,null,'cat1','atleta', false, null) $q$,
  'Link inválido');

-- ===========================================================================
-- Portal do time (0026) — o que quebrou
-- ===========================================================================
select pg_temp.checa('portal responde', public.team_registration('33333333-3333-3333-3333-333333333333','tok123') is not null);
select pg_temp.checa('portal recusa token errado', public.team_registration('33333333-3333-3333-3333-333333333333','errado') is null);
select pg_temp.checa('portal traz as regras do campeonato',
  public.team_registration('33333333-3333-3333-3333-333333333333','tok123') ? 'championship');
select pg_temp.checa('e NÃO traz dado de cobrança',
  not (public.team_registration('33333333-3333-3333-3333-333333333333','tok123')->'championship' ? 'payment_status'));
select pg_temp.checa('nem o dono do campeonato',
  not (public.team_registration('33333333-3333-3333-3333-333333333333','tok123')->'championship' ? 'owner_id'));

-- ===========================================================================
-- Exclusão de campeonato com notificações (0024)
-- ===========================================================================
insert into public.push_outbox (championship_id, audience, title, body)
values ('22222222-2222-2222-2222-222222222222', 'organizer', 'teste', 'teste');
delete from public.championships where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.checa('campeonato com avisos e atletas é excluído',
  not exists (select 1 from championships where id = '22222222-2222-2222-2222-222222222222'));

-- ===========================================================================
-- Liberação pelo master (0023)
-- ===========================================================================
select pg_temp.recusa('quem não é master não libera',
  $q$ select public.master_release_championship('44444444-4444-4444-4444-444444444444', 'na mão') $q$,
  'Somente o administrador master');

insert into public.master_admins (email) values ('org@teste.com') on conflict do nothing;
set request.jwt.claims = '{"email":"org@teste.com"}';
update public.championships set payment_status = 'pending' where id = '44444444-4444-4444-4444-444444444444';
select public.master_release_championship('44444444-4444-4444-4444-444444444444', 'recebido em dinheiro');
select pg_temp.checa('master libera e registra o motivo',
  (select payment_ref from championships where id = '44444444-4444-4444-4444-444444444444') = 'recebido em dinheiro');
