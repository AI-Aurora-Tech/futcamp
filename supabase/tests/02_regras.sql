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
-- Conta do gestor do time por e-mail (0028)
--
-- A conta nasce do link do organizador; depois de criada, o e-mail e a senha
-- entram pela página inicial, sem link nenhum.
-- ===========================================================================
select pg_temp.checa('e-mail plausível',      public.email_plausivel('joao@email.com'));
select pg_temp.checa('usuário não é e-mail',  not public.email_plausivel('leoes.fc'));
select pg_temp.checa('espaço no meio recusa', not public.email_plausivel('joao @email.com'));
select pg_temp.checa('sem domínio recusa',    not public.email_plausivel('joao@email'));

select pg_temp.recusa('conta de time sem e-mail é recusada',
  $q$ select public.create_team_account('33333333-3333-3333-3333-333333333333','tok123','leoes.fc','segredo') $q$,
  'e-mail válido');

select pg_temp.recusa('conta de time exige o link certo',
  $q$ select public.create_team_account('33333333-3333-3333-3333-333333333333','ERRADO','joao@email.com','segredo') $q$,
  'Link inválido');

select public.create_team_account('33333333-3333-3333-3333-333333333333','tok123','  Joao@Email.COM  ','segredo');
select pg_temp.checa('e-mail guardado em minúsculas e sem espaços',
  (select username from team_invites where team_id = '33333333-3333-3333-3333-333333333333') = 'joao@email.com');

select pg_temp.checa('login pelo link ignora a caixa do e-mail',
  public.team_login('33333333-3333-3333-3333-333333333333','tok123','JOAO@email.com','segredo'));
select pg_temp.checa('login pelo link recusa a senha errada',
  not public.team_login('33333333-3333-3333-3333-333333333333','tok123','joao@email.com','outra'));

-- --- página inicial: só e-mail e senha ---
select pg_temp.checa('login por e-mail acha o time',
  jsonb_array_length(public.team_login_email('joao@email.com','segredo')) = 1);
select pg_temp.checa('e devolve o token do portal',
  public.team_login_email('joao@email.com','segredo')->0->>'token' = 'tok123');
select pg_temp.checa('com o nome do time e do campeonato',
  public.team_login_email('joao@email.com','segredo')->0->>'team_name' = 'Time A');
select pg_temp.checa('login por e-mail aceita caixa diferente',
  jsonb_array_length(public.team_login_email('  JOAO@Email.com ','segredo')) = 1);
select pg_temp.checa('senha errada não abre nada',
  jsonb_array_length(public.team_login_email('joao@email.com','chute')) = 0);
select pg_temp.checa('e-mail desconhecido não abre nada',
  jsonb_array_length(public.team_login_email('ninguem@email.com','segredo')) = 0);
select pg_temp.checa('senha vazia não abre nada',
  jsonb_array_length(public.team_login_email('joao@email.com','')) = 0);

-- Duas contas com o mesmo e-mail no mesmo time: não faz sentido.
select pg_temp.recusa('mesmo e-mail duas vezes no time',
  $q$ select public.create_team_account('33333333-3333-3333-3333-333333333333','tok123','JOAO@email.com','outra') $q$,
  'já é gestor');

-- 2º gestor entra normalmente, e o time já tem os dois.
select public.create_team_account('33333333-3333-3333-3333-333333333333','tok123','maria@email.com','segredo2');
select pg_temp.checa('2º gestor entra pela página inicial',
  public.team_login_email('maria@email.com','segredo2')->0->>'team_id' = '33333333-3333-3333-3333-333333333333');
select pg_temp.recusa('3º gestor é recusado',
  $q$ select public.create_team_account('33333333-3333-3333-3333-333333333333','tok123','pedro@email.com','segredo3') $q$,
  '2 gestores');

-- Senha zerada pelo administrador: some da página inicial (a nova senha só
-- pode ser criada pelo link, para ninguém entrar sabendo só o e-mail).
update public.team_invites set password_hash = ''
 where team_id = '33333333-3333-3333-3333-333333333333';
select pg_temp.checa('senha zerada não entra pela página inicial',
  jsonb_array_length(public.team_login_email('joao@email.com','segredo')) = 0);
select pg_temp.checa('mas o link reconhece o estado zerado',
  public.team_needs_password('33333333-3333-3333-3333-333333333333','tok123','JOAO@email.com'));
select pg_temp.checa('e aceita a nova senha',
  public.team_set_password('33333333-3333-3333-3333-333333333333','tok123','joao@email.com','nova'));
select pg_temp.checa('com a nova senha volta a entrar pela página inicial',
  jsonb_array_length(public.team_login_email('joao@email.com','nova')) = 1);

-- ===========================================================================
-- Regras de jogo (0029)
-- ===========================================================================
update public.championships set bench_size = 7
 where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.checa('banco de reservas gravado',
  (select bench_size from championships where id = '22222222-2222-2222-2222-222222222222') = 7);

-- A penalidade da expulsão deixou de ser coluna do campeonato (0030): cada
-- categoria é um caso, e a regra passou para dentro do jsonb.
select pg_temp.checa('coluna send_off_policy não existe mais',
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'championships'
                 and column_name = 'send_off_policy'));

-- A 0030 tem de LEVAR a penalidade antiga para dentro das categorias, não
-- apagá-la junto com a coluna. Aqui o estado anterior é recriado e a migration
-- roda de novo — é o único jeito de provar que quem já tinha configurado não
-- perdeu nada.
alter table public.championships add column send_off_policy text;
update public.championships set send_off_policy = 'substitui'
 where id = '44444444-4444-4444-4444-444444444444';
\i :raiz/supabase/migrations/0030_send_off_per_category.sql
select pg_temp.checa('penalidade antiga foi copiada para todas as categorias',
  (select bool_and(cat->>'sendOffPolicy' = 'substitui')
     from championships c, lateral jsonb_array_elements(c.categories) cat
    where c.id = '44444444-4444-4444-4444-444444444444'));
select pg_temp.checa('e a coluna saiu de novo',
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'championships'
                 and column_name = 'send_off_policy'));

-- As regras por categoria viajam dentro do jsonb: nenhuma coluna nova.
update public.championships
   set categories = '[{"id":"cat1","name":"Sub-13","periodMinutes":25,"periods":2,
                       "substitutionMode":"limitada","maxSubstitutions":5,
                       "yellowAccumulates":true,"yellowsForSuspension":3,
                       "sendOffPolicy":"menos_um","qualifiers":8,
                       "refereeFeeCents":18000,"refereePix":"copa@pix.com"},
                      {"id":"cat2","name":"Sub-11","sendOffPolicy":"substitui","qualifiers":4}]'::jsonb
 where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.checa('expulsão é regra da categoria',
  (select categories->0->>'sendOffPolicy' from championships
    where id = '22222222-2222-2222-2222-222222222222') = 'menos_um');
select pg_temp.checa('e cada categoria pode ser diferente',
  (select categories->1->>'sendOffPolicy' from championships
    where id = '22222222-2222-2222-2222-222222222222') = 'substitui');
select pg_temp.checa('classificados por categoria',
  (select (categories->0->>'qualifiers')::int from championships
    where id = '22222222-2222-2222-2222-222222222222') = 8);
select pg_temp.checa('tempo de jogo guardado na categoria',
  (select (categories->0->>'periodMinutes')::int from championships
    where id = '22222222-2222-2222-2222-222222222222') = 25);
select pg_temp.checa('arbitragem guardada na categoria',
  (select categories->0->>'refereePix' from championships
    where id = '22222222-2222-2222-2222-222222222222') = 'copa@pix.com');

-- O portal do time precisa receber as regras: é o mesmo regulamento dos dois lados.
select pg_temp.checa('portal entrega o banco de reservas',
  (public.team_registration('33333333-3333-3333-3333-333333333333','tok123')->'championship'->>'bench_size')::int = 7);
select pg_temp.checa('portal entrega a expulsão dentro da categoria',
  public.team_registration('33333333-3333-3333-3333-333333333333','tok123')
    ->'championship'->'categories'->1->>'sendOffPolicy' = 'substitui');
select pg_temp.checa('e não sobrou campo antigo no campeonato',
  not (public.team_registration('33333333-3333-3333-3333-333333333333','tok123')
        ->'championship' ? 'send_off_policy'));
select pg_temp.checa('portal entrega os classificados da categoria',
  (public.team_registration('33333333-3333-3333-3333-333333333333','tok123')
     ->'championship'->'categories'->0->>'qualifiers')::int = 8);
select pg_temp.checa('portal entrega as regras da categoria',
  (public.team_registration('33333333-3333-3333-3333-333333333333','tok123')
     ->'championship'->'categories'->0->>'maxSubstitutions')::int = 5);
select pg_temp.checa('e continua sem dado de cobrança',
  not (public.team_registration('33333333-3333-3333-3333-333333333333','tok123')->'championship' ? 'payment_status'));

-- ===========================================================================
-- Limite de equipes por plano (0031)
-- ===========================================================================
select pg_temp.checa('grátis: 8 equipes',      plan_max_teams('gratis') = 8);
select pg_temp.checa('bronze: 16',             plan_max_teams('bronze') = 16);
select pg_temp.checa('prata: 32',              plan_max_teams('prata') = 32);
select pg_temp.checa('ouro: ilimitado',        plan_max_teams('ouro') is null);
select pg_temp.checa('diamante: ilimitado',    plan_max_teams('diamante') is null);
select pg_temp.checa('plano nulo cai no grátis', plan_max_teams(null) = 8);

-- Campeonato no plano Grátis: enche até 8 e a 9ª tem de bater na trave.
insert into public.championships (id, owner_id, name, sport, format, season, plan, categories)
values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
        'Copa Limite', 'futebol', 'league', '2026', 'gratis', '[{"id":"c1","name":"A"}]'::jsonb);

insert into public.teams (championship_id, name)
select '55555555-5555-5555-5555-555555555555', 'Time ' || i from generate_series(1, 7) i;

select pg_temp.checa('7 equipes cadastradas',
  (select count(*) from teams where championship_id = '55555555-5555-5555-5555-555555555555') = 7);

-- A 8ª ainda cabe (o limite é 8, não 7).
insert into public.teams (championship_id, name)
values ('55555555-5555-5555-5555-555555555555', 'Time 8');
select pg_temp.checa('a 8ª equipe entra',
  (select count(*) from teams where championship_id = '55555555-5555-5555-5555-555555555555') = 8);

select pg_temp.recusa('a 9ª equipe é recusada no plano Grátis',
  $q$ insert into public.teams (championship_id, name)
      values ('55555555-5555-5555-5555-555555555555', 'Time 9') $q$,
  'permite até 8 equipe');

-- O link público de criação de time passa pelo MESMO gatilho.
select public.ensure_champ_team_invite('55555555-5555-5555-5555-555555555555') as _;
select pg_temp.recusa('o link público também respeita o limite',
  $q$ select public.create_team_via_invite(
        '55555555-5555-5555-5555-555555555555',
        (select token from champ_team_invites where championship_id = '55555555-5555-5555-5555-555555555555'),
        'Time do Link', null, null, null, null, null, null) $q$,
  'permite até 8 equipe');

-- Trocar para um plano maior libera na hora.
update public.championships set plan = 'bronze'
 where id = '55555555-5555-5555-5555-555555555555';
insert into public.teams (championship_id, name)
values ('55555555-5555-5555-5555-555555555555', 'Time 9');
select pg_temp.checa('o Bronze aceita a 9ª equipe',
  (select count(*) from teams where championship_id = '55555555-5555-5555-5555-555555555555') = 9);

-- Ouro não tem teto.
update public.championships set plan = 'ouro'
 where id = '55555555-5555-5555-5555-555555555555';
insert into public.teams (championship_id, name)
select '55555555-5555-5555-5555-555555555555', 'Extra ' || i from generate_series(1, 40) i;
select pg_temp.checa('Ouro não tem teto',
  (select count(*) from teams where championship_id = '55555555-5555-5555-5555-555555555555') = 49);

-- Voltar para um plano menor NÃO apaga equipe nenhuma — só impede a próxima.
update public.championships set plan = 'gratis'
 where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.checa('rebaixar o plano não apaga equipes',
  (select count(*) from teams where championship_id = '55555555-5555-5555-5555-555555555555') = 49);
select pg_temp.recusa('mas trava a próxima',
  $q$ insert into public.teams (championship_id, name)
      values ('55555555-5555-5555-5555-555555555555', 'Nao cabe') $q$,
  'permite até 8 equipe');

-- Vagas, para a tela avisar antes.
select pg_temp.checa('vagas: zero quando estourou',
  (public.champ_team_slots('55555555-5555-5555-5555-555555555555')->>'restantes')::int = 0);
update public.championships set plan = 'ouro'
 where id = '55555555-5555-5555-5555-555555555555';
select pg_temp.checa('vagas: nulo quando o plano é ilimitado',
  public.champ_team_slots('55555555-5555-5555-5555-555555555555')->>'restantes' is null);

-- ===========================================================================
-- Troca de plano com o campeonato já criado (0032)
-- ===========================================================================
-- Campeonato do organizador logado, no Grátis, com equipes e um atleta — para
-- provar que nada é perdido na troca.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.championships (id, owner_id, name, sport, format, season, plan, categories)
values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
        'Copa da Troca', 'futebol', 'league', '2026', 'gratis', '[{"id":"c1","name":"A"}]'::jsonb);
insert into public.teams (id, championship_id, name)
values ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'Time da Troca');
insert into public.players (team_id, championship_id, name, cpf)
values ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', 'Atleta', '52998224725');

select pg_temp.checa('nasce grátis e liberado',
  (select payment_status from championships where id = '66666666-6666-6666-6666-666666666666') = 'free');

-- --- SUBIR de plano cobra e bloqueia, sem apagar nada ---------------------
select pg_temp.checa('subir para Ouro cobra',
  (public.change_championship_plan('66666666-6666-6666-6666-666666666666', 'ouro')->>'cobra')::boolean);
select pg_temp.checa('valor recalculado no servidor',
  (select amount_cents from championships where id = '66666666-6666-6666-6666-666666666666') = 10990);
select pg_temp.checa('campeonato fica pendente até pagar',
  (select payment_status from championships where id = '66666666-6666-6666-6666-666666666666') = 'pending');
select pg_temp.checa('o time continua lá',
  (select count(*) from teams where championship_id = '66666666-6666-6666-6666-666666666666') = 1);
select pg_temp.checa('o atleta continua lá',
  (select count(*) from players where championship_id = '66666666-6666-6666-6666-666666666666') = 1);
select pg_temp.checa('o plano anterior fica guardado',
  (select plan_change->>'plan' from championships where id = '66666666-6666-6666-6666-666666666666') = 'gratis');

-- --- Desfazer devolve tudo ao que era ------------------------------------
select public.revert_championship_plan('66666666-6666-6666-6666-666666666666') as _;
select pg_temp.checa('desfazer volta ao plano anterior',
  (select plan from championships where id = '66666666-6666-6666-6666-666666666666') = 'gratis');
select pg_temp.checa('e volta a ficar liberado',
  (select payment_status from championships where id = '66666666-6666-6666-6666-666666666666') = 'free');
select pg_temp.checa('sem sobra de troca pendente',
  (select plan_change from championships where id = '66666666-6666-6666-6666-666666666666') is null);
select pg_temp.recusa('não dá para desfazer o que não existe',
  $q$ select public.revert_championship_plan('66666666-6666-6666-6666-666666666666') $q$,
  'Não há troca de plano pendente');

-- --- Pagar encerra a troca pendente --------------------------------------
select public.change_championship_plan('66666666-6666-6666-6666-666666666666', 'prata') as _;
select pg_temp.checa('prata com 1 categoria custa 7990',
  (select amount_cents from championships where id = '66666666-6666-6666-6666-666666666666') = 7990);
select public.mark_championship_paid('66666666-6666-6666-6666-666666666666', 'pay_123');
select pg_temp.checa('pago libera',
  (select payment_status from championships where id = '66666666-6666-6666-6666-666666666666') = 'paid');
select pg_temp.checa('e limpa a troca pendente',
  (select plan_change from championships where id = '66666666-6666-6666-6666-666666666666') is null);
select pg_temp.recusa('upgrade pago não se desfaz por aqui',
  $q$ select public.revert_championship_plan('66666666-6666-6666-6666-666666666666') $q$,
  'Não há troca de plano pendente');

-- --- DESCER vale na hora, sem devolução e sem bloquear -------------------
select pg_temp.checa('descer para Bronze não cobra',
  (public.change_championship_plan('66666666-6666-6666-6666-666666666666', 'bronze')->>'cobra')::boolean = false);
select pg_temp.checa('continua liberado',
  (select payment_status from championships where id = '66666666-6666-6666-6666-666666666666') = 'paid');
select pg_temp.checa('o limite de equipes acompanha o novo plano',
  plan_max_teams((select plan from championships where id = '66666666-6666-6666-6666-666666666666')) = 16);
select pg_temp.checa('nada foi perdido',
  (select count(*) from players where championship_id = '66666666-6666-6666-6666-666666666666') = 1);

select pg_temp.recusa('não dá para trocar pelo plano que já está valendo',
  $q$ select public.change_championship_plan('66666666-6666-6666-6666-666666666666', 'bronze') $q$,
  'já está no plano');
select pg_temp.recusa('plano inventado é recusado',
  $q$ select public.change_championship_plan('66666666-6666-6666-6666-666666666666', 'platina') $q$,
  'Plano desconhecido');

-- Campeonato de OUTRO dono: nem trocar.
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'outro@teste.com')
  on conflict do nothing;
insert into public.championships (id, owner_id, name, sport, format, season, plan, categories)
values ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999',
        'Copa Alheia', 'futebol', 'league', '2026', 'gratis', '[{"id":"c1","name":"A"}]'::jsonb);
select pg_temp.recusa('não dá para trocar o plano de campeonato alheio',
  $q$ select public.change_championship_plan('88888888-8888-8888-8888-888888888888', 'ouro') $q$,
  'Somente o organizador');
select pg_temp.checa('e o campeonato alheio não mudou',
  (select plan from championships where id = '88888888-8888-8888-8888-888888888888') = 'gratis');

-- E o app, sozinho, continua sem conseguir se promover.
update public.championships set plan = 'ouro', payment_status = 'paid'
 where id = '66666666-6666-6666-6666-666666666666';
select pg_temp.checa('o app não se promove escrevendo direto na tabela',
  (select payment_status from championships where id = '66666666-6666-6666-6666-666666666666') = 'paid'
  and (select amount_cents from championships where id = '66666666-6666-6666-6666-666666666666') = 5990);
reset request.jwt.claim.sub;

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
