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
-- Categoria como competição (0033)
-- ===========================================================================
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- A CONVERSÃO. As migrations rodam antes do cenário, então aqui o estado
-- "antes" é recriado de propósito e a migration roda de novo — é o único jeito
-- de provar que um campeonato que já existia não fica para trás.
insert into public.matches (id, championship_id, round, home_team_id)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 1,
        '33333333-3333-3333-3333-333333333333');
update public.matches set category_id = null
 where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
delete from public.team_categories
 where team_id = '33333333-3333-3333-3333-333333333333';

\i :raiz/supabase/migrations/0033_categoria_como_competicao.sql

select pg_temp.checa('partida antiga ganhou a 1ª categoria',
  (select category_id from matches where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = 'cat1');
select pg_temp.checa('clube antigo foi inscrito na 1ª categoria',
  exists (select 1 from team_categories
           where team_id = '33333333-3333-3333-3333-333333333333'
             and category_id = 'cat1'));
select pg_temp.checa('e rodar a migration de novo não duplica inscrição',
  (select count(*) from team_categories
    where team_id = '33333333-3333-3333-3333-333333333333') = 1);

-- Campeonato de três categorias, do organizador logado.
insert into public.championships (id, owner_id, name, sport, format, season, plan, status, categories)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
        'Copa de Base', 'futebol', 'league', '2026', 'ouro', 'active',
        '[{"id":"s11","name":"Sub-11"},{"id":"s13","name":"Sub-13"},{"id":"s15","name":"Sub-15"}]'::jsonb);

insert into public.teams (id, championship_id, name)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Leões FC');

-- O MESMO clube em duas categorias, em grupos diferentes.
insert into public.team_categories (team_id, championship_id, category_id, "group") values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11', 'A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's15', 'C');

select pg_temp.checa('um clube, duas inscrições',
  (select count(*) from team_categories
    where team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 2);
select pg_temp.checa('e grupos diferentes em cada categoria',
  (select "group" from team_categories
    where team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and category_id = 's11') = 'A'
  and (select "group" from team_categories
        where team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and category_id = 's15') = 'C');
select pg_temp.recusa('a mesma inscrição não entra duas vezes',
  $q$ insert into public.team_categories (team_id, championship_id, category_id)
      values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11') $q$,
  'duplicate key');

-- O clube conta UMA vez no limite do plano, jogue em quantas categorias for.
select pg_temp.checa('o limite do plano conta clubes, não inscrições',
  (select count(*) from teams where championship_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 1);

-- Partidas separadas por categoria.
insert into public.matches (championship_id, category_id, round, home_team_id, away_team_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11', 1, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11', 2, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's15', 1, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null);
select pg_temp.checa('a tabela do Sub-11 tem 2 jogos',
  (select count(*) from matches
    where championship_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and category_id = 's11') = 2);
select pg_temp.checa('e a do Sub-15 tem 1, sem se misturarem',
  (select count(*) from matches
    where championship_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and category_id = 's15') = 1);

-- Situação por categoria: começam e terminam em datas diferentes.
select pg_temp.checa('categoria herda a situação do campeonato',
  public.categoria_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11') = 'active');
select public.set_categoria_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11', 'finished') as _;
select pg_temp.checa('encerrar o Sub-11 vale só para ele',
  public.categoria_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11') = 'finished');
select pg_temp.checa('o Sub-15 continua em andamento',
  public.categoria_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's15') = 'active');
select pg_temp.checa('e o encerramento fica datado',
  (select cat->>'finishedAt' is not null
     from championships c, lateral jsonb_array_elements(c.categories) cat
    where c.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and cat->>'id' = 's11'));

-- Mexer numa categoria não pode apagar as regras das outras.
select public.set_categoria_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's13', 'active') as _;
select pg_temp.checa('as três categorias continuam lá, na ordem',
  (select string_agg(cat->>'id', ',' order by ord)
     from championships c,
          lateral jsonb_array_elements(c.categories) with ordinality as t(cat, ord)
    where c.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 's11,s13,s15');

select pg_temp.recusa('situação inventada é recusada',
  $q$ select public.set_categoria_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11', 'pausado') $q$,
  'Situação desconhecida');
select pg_temp.recusa('campeonato alheio não muda de situação',
  $q$ select public.set_categoria_status('88888888-8888-8888-8888-888888888888', 'c1', 'finished') $q$,
  'Somente o organizador');

-- Reabrir volta a situação e limpa a data.
select public.set_categoria_status('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 's11', 'active') as _;
select pg_temp.checa('reabrir limpa a data de encerramento',
  (select cat->>'finishedAt' is null
     from championships c, lateral jsonb_array_elements(c.categories) cat
    where c.id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and cat->>'id' = 's11'));

-- Excluir o clube leva junto as inscrições dele.
delete from public.teams where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
select pg_temp.checa('excluir o clube apaga as inscrições',
  (select count(*) from team_categories
    where team_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 0);
reset request.jwt.claim.sub;

-- ===========================================================================
-- Links de inscrição com escopo de categoria (0034)
-- ===========================================================================
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.championships (id, owner_id, name, sport, format, season, plan, categories)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111',
        'Copa dos Links', 'futebol', 'league', '2026', 'ouro',
        '[{"id":"s11","name":"Sub-11"},{"id":"s13","name":"Sub-13"},{"id":"s15","name":"Sub-15"}]'::jsonb);

-- Os links são criados ANTES de serem consultados, de propósito:
-- `champ_invite_scope` é `stable` e, dentro de um mesmo comando, não enxerga a
-- linha que a função volátil acabou de inserir. No app são duas idas ao
-- servidor, então isso não aparece — mas o teste precisa respeitar a regra.
select public.ensure_champ_team_invite('dddddddd-dddd-dddd-dddd-dddddddddddd') as _;
select public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s13']) as _;

select pg_temp.checa('link aberto libera as três categorias',
  jsonb_array_length(public.champ_invite_scope(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    (select token from champ_team_invites
      where championship_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' and categories is null))) = 3);

select pg_temp.checa('pedir o link aberto duas vezes devolve o mesmo',
  public.ensure_champ_team_invite('dddddddd-dddd-dddd-dddd-dddddddddddd')
  = public.ensure_champ_team_invite('dddddddd-dddd-dddd-dddd-dddddddddddd'));

-- O link DIRECIONADO libera só a sua.
select pg_temp.checa('link do Sub-13 libera só o Sub-13',
  public.champ_invite_scope(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    (select token from champ_team_invites
      where championship_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' and categories = array['s13']))
  = '["s13"]'::jsonb);

select pg_temp.checa('o mesmo escopo devolve sempre o mesmo link',
  public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s13'])
  = public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s13']));

select pg_temp.checa('a ordem das categorias não cria link novo',
  public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s11','s15'])
  = public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s15','s11']));

select pg_temp.checa('e o link aberto é diferente do direcionado',
  public.ensure_champ_team_invite('dddddddd-dddd-dddd-dddd-dddddddddddd')
  <> public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s13']));

select pg_temp.recusa('não dá para criar link de categoria que não existe',
  $q$ select public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s99']) $q$,
  'Categoria inexistente');

-- Criar time pelo link direcionado inscreve SÓ naquela categoria.
select public.create_team_via_invite(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s13']),
  'Time do Sub-13', null, null, null, null, null, null, null) as _;
select pg_temp.checa('time do link direcionado entra só no Sub-13',
  (select array_agg(tc.category_id) from team_categories tc
     join teams t on t.id = tc.team_id
    where t.name = 'Time do Sub-13') = array['s13']);

-- Pelo link aberto, o responsável escolhe.
select public.create_team_via_invite(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  public.ensure_champ_team_invite('dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'Time de Duas', null, null, null, null, null, null, array['s11','s15']) as _;
select pg_temp.checa('pelo link aberto o time entra nas que escolheu',
  (select count(*) from team_categories tc join teams t on t.id = tc.team_id
    where t.name = 'Time de Duas') = 2);

-- Sem escolha, o link aberto inscreve em todas.
select public.create_team_via_invite(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  public.ensure_champ_team_invite('dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'Time de Todas', null, null, null, null, null, null, null) as _;
select pg_temp.checa('sem escolher, o link aberto inscreve em todas',
  (select count(*) from team_categories tc join teams t on t.id = tc.team_id
    where t.name = 'Time de Todas') = 3);

-- A trava que importa: o escopo do link não pode ser furado pelo navegador.
select pg_temp.recusa('link do Sub-13 não inscreve no Sub-17',
  $q$ select public.create_team_via_invite(
        'dddddddd-dddd-dddd-dddd-dddddddddddd',
        public.ensure_champ_category_invite('dddddddd-dddd-dddd-dddd-dddddddddddd', array['s13']),
        'Time Espertinho', null, null, null, null, null, null, array['s15']) $q$,
  'não dá acesso a essa categoria');
select pg_temp.checa('e o time espertinho não foi criado',
  not exists (select 1 from teams where name = 'Time Espertinho'));

select pg_temp.recusa('token inventado não cria time',
  $q$ select public.create_team_via_invite('dddddddd-dddd-dddd-dddd-dddddddddddd',
        'token-falso', 'Fantasma', null, null, null, null, null, null, null) $q$,
  'Link de criação inválido');

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

-- ===========================================================================
-- Avisos que a equipe recebe (0035)
--
-- Um campeonato próprio, com duas categorias, para conferir que o recorte por
-- categoria vale e que cada aviso vai só para quem tem que receber.
-- ===========================================================================
\set av 'aa000000-0000-0000-0000-000000000001'
\set leo '5a000000-0000-0000-0000-000000000001'
\set tig '5a000000-0000-0000-0000-000000000002'
\set agu '5a000000-0000-0000-0000-000000000003'
\set gav '5a000000-0000-0000-0000-000000000004'

insert into public.championships (id, owner_id, name, sport, format, season, plan, categories)
values (:'av', '11111111-1111-1111-1111-111111111111', 'Copa dos Avisos', 'futebol', 'league',
        '2026', 'gratis',
        '[{"id":"s11","name":"Sub-11","yellowsForSuspension":3},{"id":"s15","name":"Sub-15"}]'::jsonb);

insert into public.teams (id, championship_id, name) values
  (:'leo', :'av', 'Leões'), (:'tig', :'av', 'Tigres'),
  (:'agu', :'av', 'Águias'), (:'gav', :'av', 'Gaviões');

-- Leões e Tigres jogam o Sub-11; Águias e Gaviões, o Sub-15.
insert into public.team_categories (team_id, championship_id, category_id) values
  (:'leo', :'av', 's11'), (:'tig', :'av', 's11'),
  (:'agu', :'av', 's15'), (:'gav', :'av', 's15');

insert into public.players (id, team_id, championship_id, name) values
  ('5b000000-0000-0000-0000-000000000001', :'leo', :'av', 'João'),
  ('5b000000-0000-0000-0000-000000000002', :'leo', :'av', 'Pedro'),
  ('5b000000-0000-0000-0000-000000000003', :'tig', :'av', 'Rafael');

-- --------------------------------------------------------------------------
-- Aviso 1 — jogo marcado
-- --------------------------------------------------------------------------
-- Nasce SEM data, como na geração da tabela: não pode avisar nada ainda.
insert into public.matches (id, championship_id, category_id, round, phase, home_team_id, away_team_id)
values ('5c000000-0000-0000-0000-000000000001', :'av', 's11', 1, 'group', :'leo', :'tig');

select pg_temp.checa('tabela gerada sem data não avisa',
  not exists (select 1 from push_outbox where dedupe_key = 'jogo:5c000000-0000-0000-0000-000000000001'));

update public.matches
   set scheduled_at = '2026-09-12 18:00:00+00', venue = 'Campo do Bairro'
 where id = '5c000000-0000-0000-0000-000000000001';

select pg_temp.checa('marcar o jogo avisa os dois times',
  (select target_teams from push_outbox where dedupe_key = 'jogo:5c000000-0000-0000-0000-000000000001')
   @> array[:'leo', :'tig']::uuid[]);
select pg_temp.checa('  com categoria, data, hora e local',
  (select body from push_outbox where dedupe_key = 'jogo:5c000000-0000-0000-0000-000000000001')
   = 'Sub-11 · Leões × Tigres · sáb 12/09 às 15:00 · Campo do Bairro');
select pg_temp.checa('  e carimba a categoria no aviso',
  (select category_id from push_outbox where dedupe_key = 'jogo:5c000000-0000-0000-0000-000000000001') = 's11');

-- Remarcar antes da entrega não vira um segundo aviso.
update public.matches set scheduled_at = '2026-09-13 14:00:00+00'
 where id = '5c000000-0000-0000-0000-000000000001';
select pg_temp.checa('remarcar antes da entrega não duplica',
  (select count(*) from push_outbox where dedupe_key = 'jogo:5c000000-0000-0000-0000-000000000001') = 1);
select pg_temp.checa('  e o aviso passa a dizer "remarcado"',
  (select title from push_outbox where dedupe_key = 'jogo:5c000000-0000-0000-0000-000000000001')
   = '📅 Jogo remarcado');

-- Mexer no que não interessa (placar parcial) não avisa de novo.
update public.matches set incidents = 'chuva' where id = '5c000000-0000-0000-0000-000000000001';
select pg_temp.checa('mudança irrelevante não gera aviso',
  (select count(*) from push_outbox where dedupe_key = 'jogo:5c000000-0000-0000-0000-000000000001') = 1);

-- --------------------------------------------------------------------------
-- Aviso 2 — faltam 2 dias
-- --------------------------------------------------------------------------
insert into public.matches (id, championship_id, category_id, round, phase,
                            home_team_id, away_team_id, scheduled_at, venue)
values ('5c000000-0000-0000-0000-000000000002', :'av', 's11', 2, 'group', :'tig', :'leo',
        now() + interval '30 hours', 'Ginásio');
insert into public.matches (id, championship_id, category_id, round, phase,
                            home_team_id, away_team_id, scheduled_at)
values ('5c000000-0000-0000-0000-000000000003', :'av', 's15', 1, 'group', :'agu', :'gav',
        now() + interval '10 days');

select pg_temp.checa('lembrete só do jogo dentro das 48h',
  public.push_gerar_lembretes() = 1);
select pg_temp.checa('  e é o jogo certo',
  exists (select 1 from push_outbox
           where dedupe_key = 'lembrete:5c000000-0000-0000-0000-000000000002'
             and title = '⏰ Seu jogo é daqui a 2 dias'));
select pg_temp.checa('rodar de novo não repete o lembrete',
  public.push_gerar_lembretes() = 0);

-- --------------------------------------------------------------------------
-- Aviso 6 — gol com o autor, e o placar contado dos eventos
-- --------------------------------------------------------------------------
insert into public.match_events (match_id, championship_id, team_id, player_id, type, minute)
values ('5c000000-0000-0000-0000-000000000001', :'av', :'leo',
        '5b000000-0000-0000-0000-000000000001', 'goal', 12);

select pg_temp.checa('o gol nomeia quem fez e conta o placar dos eventos',
  (select body from push_outbox where title like '⚽ Gol%' order by id desc limit 1)
   = 'Leões 1 × 0 Tigres — gol de João 12''');
select pg_temp.checa('  e vai só para os dois times em campo',
  (select array_length(target_teams, 1) from push_outbox where title like '⚽ Gol%' order by id desc limit 1) = 2);

insert into public.match_events (match_id, championship_id, team_id, player_id, type, minute)
values ('5c000000-0000-0000-0000-000000000001', :'av', :'tig',
        '5b000000-0000-0000-0000-000000000003', 'goal', 40);
select pg_temp.checa('o segundo gol atualiza o placar',
  (select body from push_outbox where title like '⚽ Gol%' order by id desc limit 1)
   = 'Leões 1 × 1 Tigres — gol de Rafael 40''');

-- --------------------------------------------------------------------------
-- Avisos 3, 5 e 7 — suspensão, resultado e resumo
-- --------------------------------------------------------------------------
-- João leva o 3º amarelo (todos nesta partida) e Rafael, vermelho.
insert into public.match_events (match_id, championship_id, team_id, player_id, type)
select '5c000000-0000-0000-0000-000000000001', :'av', :'leo',
       '5b000000-0000-0000-0000-000000000001', 'yellow_card'
  from generate_series(1, 3);
insert into public.match_events (match_id, championship_id, team_id, player_id, type)
values ('5c000000-0000-0000-0000-000000000001', :'av', :'tig',
        '5b000000-0000-0000-0000-000000000003', 'red_card');

update public.matches set home_score = 2, away_score = 1, status = 'finished'
 where id = '5c000000-0000-0000-0000-000000000001';

select pg_temp.checa('vermelho suspende e avisa o time do atleta',
  exists (select 1 from push_outbox
           where title = '🟥 Suspensão automática'
             and body = 'Rafael levou cartão vermelho e não joga a próxima partida.'
             and target_teams = array[:'tig']::uuid[]));
select pg_temp.checa('3º amarelo suspende e avisa o time do atleta',
  exists (select 1 from push_outbox
           where title = '🟨 Suspensão por cartões'
             and body = 'João completou 3 amarelos e não joga a próxima partida.'
             and target_teams = array[:'leo']::uuid[]));

select pg_temp.checa('o resumo sai um para cada equipe',
  (select count(*) from push_outbox where dedupe_key like 'resumo:5c000000-0000-0000-0000-000000000001:%') = 2);
select pg_temp.checa('  para quem ganhou, vitória',
  (select title from push_outbox
    where dedupe_key = 'resumo:5c000000-0000-0000-0000-000000000001:' || :'leo')
   = '🏆 Vitória — Leões 2 × 1 Tigres');
select pg_temp.checa('  para quem perdeu, derrota',
  (select title from push_outbox
    where dedupe_key = 'resumo:5c000000-0000-0000-0000-000000000001:' || :'tig')
   = '🏁 Derrota — Tigres 1 × 2 Leões');
select pg_temp.checa('  com os gols da própria equipe e os cartões',
  (select body from push_outbox
    where dedupe_key = 'resumo:5c000000-0000-0000-0000-000000000001:' || :'leo')
   like 'Sub-11 · Gols: João (12'') · 3 amarelo(s) · Próximo:%');
select pg_temp.checa('  e o próximo compromisso da equipe',
  (select body from push_outbox
    where dedupe_key = 'resumo:5c000000-0000-0000-0000-000000000001:' || :'leo')
   like '%contra Tigres');

-- --------------------------------------------------------------------------
-- Aviso 4 — classificação quando a rodada fecha
-- --------------------------------------------------------------------------
select pg_temp.checa('rodada 1 do Sub-11 fechou e a classificação saiu',
  exists (select 1 from push_outbox
           where dedupe_key = 'classif:' || :'av' || ':s11:1'
             and title = '📊 Rodada 1 encerrada · Sub-11'
             and body = 'Classificação: 1º Leões (3 pts) · 2º Tigres (0 pts)'));
select pg_temp.checa('  e foi para os clubes do Sub-11, não os do Sub-15',
  (select target_teams from push_outbox where dedupe_key = 'classif:' || :'av' || ':s11:1')
   @> array[:'leo', :'tig']::uuid[]
  and not ((select target_teams from push_outbox where dedupe_key = 'classif:' || :'av' || ':s11:1')
   && array[:'agu', :'gav']::uuid[]));

-- A rodada 2 tem jogo em aberto: nada de classificação ainda.
select pg_temp.checa('rodada com jogo em aberto não fecha a classificação',
  not exists (select 1 from push_outbox where dedupe_key = 'classif:' || :'av' || ':s11:2'));

-- Nenhum aviso do Sub-11 chegou a quem só disputa o Sub-15.
select pg_temp.checa('nada do Sub-11 vaza para o Sub-15',
  not exists (select 1 from push_outbox
               where category_id = 's11'
                 and target_teams && array[:'agu', :'gav']::uuid[]));

-- Campeonato de categoria única: o aviso não pode carregar um prefixo vazio.
\set uni 'aa000000-0000-0000-0000-000000000009'
insert into public.championships (id, owner_id, name, sport, format, season, plan, categories)
values (:'uni', '11111111-1111-1111-1111-111111111111', 'Copa Única', 'futebol', 'league',
        '2026', 'gratis', '[{"id":"c1","name":"Adulto"}]'::jsonb);
insert into public.teams (id, championship_id, name) values
  ('ab000000-0000-0000-0000-000000000001', :'uni', 'Alfa'),
  ('ab000000-0000-0000-0000-000000000002', :'uni', 'Beta');
insert into public.matches (id, championship_id, round, phase, home_team_id, away_team_id)
values ('ac000000-0000-0000-0000-000000000001', :'uni', 1, 'group',
        'ab000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000002');
update public.matches set scheduled_at = '2026-09-12 18:00:00+00'
 where id = 'ac000000-0000-0000-0000-000000000001';

select pg_temp.checa('categoria única não vira prefixo vazio',
  (select body from push_outbox where dedupe_key = 'jogo:ac000000-0000-0000-0000-000000000001')
   = 'Alfa × Beta · sáb 12/09 às 15:00');
select pg_temp.checa('  e a partida sem categoria cai na primeira',
  (select category_id from push_outbox where dedupe_key = 'jogo:ac000000-0000-0000-0000-000000000001') = 'c1');

-- ===========================================================================
-- Plano Diamante com valor negociado (0036)
--
-- O Diamante não tem preço de tabela. Antes desta migration, "sem preço"
-- virava "de graça": escolher Diamante liberava o campeonato na hora.
-- ===========================================================================
\set dia 'dd000000-0000-0000-0000-000000000001'
reset request.jwt.claims;
reset request.jwt.claim.sub;

insert into public.championships (id, owner_id, name, sport, format, season, plan, categories)
values (:'dia', '11111111-1111-1111-1111-111111111111', 'Copa Diamante', 'futebol', 'league',
        '2026', 'diamante', '[{"id":"a","name":"A"},{"id":"b","name":"B"}]'::jsonb);

select pg_temp.checa('Diamante nasce BLOQUEADO, não de graça',
  (select payment_status from championships where id = :'dia') = 'pending');
select pg_temp.checa('  e com valor a combinar',
  (select amount_cents from championships where id = :'dia') = 0
  and (select negotiated_cents from championships where id = :'dia') is null);

-- Nem tentando gravar o valor na marra pelo caminho do app.
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub  = '11111111-1111-1111-1111-111111111111';
update public.championships set negotiated_cents = 100, payment_status = 'free' where id = :'dia';
select pg_temp.checa('o app não combina o próprio preço',
  (select negotiated_cents from championships where id = :'dia') is null
  and (select payment_status from championships where id = :'dia') = 'pending');

select pg_temp.recusa('quem não é master não define o valor',
  $q$ select public.set_negotiated_price('dd000000-0000-0000-0000-000000000001', 250000) $q$,
  'Somente o administrador master');

-- O consultor registra o que foi negociado.
set request.jwt.claims = '{"email":"org@teste.com"}';
select public.set_negotiated_price(:'dia', 250000, 'contrato anual 2026') as _;
select pg_temp.checa('o master registra o valor negociado',
  (select amount_cents from championships where id = :'dia') = 250000);
select pg_temp.checa('  e o campeonato continua fechado até pagar',
  (select payment_status from championships where id = :'dia') = 'pending');
select pg_temp.checa('  com a anotação da negociação',
  (select negotiated_note from championships where id = :'dia') = 'contrato anual 2026');

-- Mexer no campeonato não pode apagar o valor combinado — era o motivo de ele
-- morar em coluna própria, e não em `amount_cents`.
set request.jwt.claims = '';
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub  = '11111111-1111-1111-1111-111111111111';
update public.championships
   set categories = '[{"id":"a","name":"A"},{"id":"b","name":"B"},{"id":"c","name":"C"}]'::jsonb
 where id = :'dia';
select pg_temp.checa('acrescentar categoria não apaga o valor combinado',
  (select amount_cents from championships where id = :'dia') = 250000);

-- Pago: o webhook libera pelo caminho normal.
select public.mark_championship_paid(:'dia', 'pay_diamante_1') as _;
select pg_temp.checa('pagamento confirmado libera o Diamante',
  (select payment_status from championships where id = :'dia') = 'paid');

set request.jwt.claims = '{"email":"org@teste.com"}';
select pg_temp.recusa('depois de pago o valor não muda mais',
  $q$ select public.set_negotiated_price('dd000000-0000-0000-0000-000000000001', 10) $q$,
  'já está pago');
select pg_temp.recusa('valor negociado só vale para o Diamante',
  $q$ select public.set_negotiated_price('44444444-4444-4444-4444-444444444444', 10) $q$,
  'plano Diamante');

-- --------------------------------------------------------------------------
-- Trocar para o Diamante também não pode liberar nada (o furo da 0032)
-- --------------------------------------------------------------------------
\set gra 'dd000000-0000-0000-0000-000000000002'
set request.jwt.claims = '';
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.championships (id, owner_id, name, sport, format, season, plan, categories)
values (:'gra', '11111111-1111-1111-1111-111111111111', 'Copa Grátis', 'futebol', 'league',
        '2026', 'gratis', '[{"id":"a","name":"A"}]'::jsonb);
select pg_temp.checa('campeonato grátis nasce liberado',
  (select payment_status from championships where id = :'gra') = 'free');

select pg_temp.checa('subir do Grátis para o Diamante cobra',
  (public.change_championship_plan(:'gra', 'diamante')->>'cobra')::boolean);
select pg_temp.checa('  e fecha o campeonato até o pagamento',
  (select payment_status from championships where id = :'gra') = 'pending');
select pg_temp.checa('  com o valor ainda a combinar',
  (select amount_cents from championships where id = :'gra') = 0);

-- ===========================================================================
-- Diamante por assinatura mensal (0037)
--
-- A assinatura é da CONTA: ativa, abre TODOS os campeonatos Diamante daquele
-- organizador. É o que faz "campeonatos ilimitados" ser verdade.
-- ===========================================================================
-- Um organizador SÓ deste bloco: os testes contam campeonatos por dono, e o
-- organizador padrão já carrega Diamantes de blocos anteriores.
\set dono 'ee999999-9999-9999-9999-999999999999'
insert into auth.users (id, email) values (:'dono', 'assinante@teste.com') on conflict do nothing;
\set as1  'ee000000-0000-0000-0000-000000000001'
\set as2  'ee000000-0000-0000-0000-000000000002'
\set as3  'ee000000-0000-0000-0000-000000000003'

reset request.jwt.claims;
set request.jwt.claim.sub = :'dono';

insert into public.championships (id, owner_id, name, sport, format, season, plan, categories) values
  (:'as1', :'dono', 'Liga Aurora',  'futebol', 'league', '2026', 'diamante', '[{"id":"a","name":"A"}]'::jsonb),
  (:'as2', :'dono', 'Copa Aurora',  'futebol', 'league', '2026', 'diamante', '[{"id":"a","name":"A"}]'::jsonb),
  (:'as3', :'dono', 'Torneio Solto','futebol', 'league', '2026', 'diamante', '[{"id":"a","name":"A"}]'::jsonb);

-- O terceiro foi vendido avulso e já está quitado: a assinatura não manda nele.
select public.mark_championship_paid(:'as3', 'pay_avulso_1') as _;

-- --------------------------------------------------------------------------
-- O consultor registra a proposta MENSAL
-- --------------------------------------------------------------------------
select pg_temp.recusa('sem contrato aceito não há assinatura',
  $q$ select public.assinatura_aceitar('ee000000-0000-0000-0000-000000000001',
        'Fulano', '52998224725', 'v1', 'texto') $q$,
  'não foi negociado como assinatura mensal');

set request.jwt.claims = '{"email":"org@teste.com"}';
select public.set_negotiated_price(:'as1', 20000, 'Diamante mensal', 'mensal', 12) as _;
select pg_temp.checa('proposta mensal registrada',
  (select negotiated_kind from championships where id = :'as1') = 'mensal'
  and (select negotiated_cents from championships where id = :'as1') = 20000
  and (select negotiated_months from championships where id = :'as1') = 12);
select pg_temp.checa('  e o campeonato segue fechado — ninguém pagou ainda',
  (select payment_status from championships where id = :'as1') = 'pending');

select pg_temp.recusa('modalidade inventada é recusada',
  $q$ select public.set_negotiated_price('ee000000-0000-0000-0000-000000000001', 20000, null, 'trimestral') $q$,
  'Modalidade desconhecida');

-- --------------------------------------------------------------------------
-- O cliente aceita o contrato
-- --------------------------------------------------------------------------
set request.jwt.claims = '';
set request.jwt.claim.sub = :'dono';
select pg_temp.recusa('aceite sem nome e documento é recusado',
  $q$ select public.assinatura_aceitar('ee000000-0000-0000-0000-000000000001',
        '', '', 'v1', 'texto do contrato') $q$,
  'nome e o documento');

select public.assinatura_aceitar(:'as1', 'Fulano de Tal', '529.982.247-25', 'diamante-v1',
  'Contrato Diamante — 12 meses, R$ 200,00/mês.') as _;

select pg_temp.checa('o aceite cria a assinatura, ainda pendente',
  (select status from subscriptions where owner_id = :'dono') = 'pending');
select pg_temp.checa('  com o valor mensal e os 12 meses',
  (select cents from subscriptions where owner_id = :'dono') = 20000
  and (select months from subscriptions where owner_id = :'dono') = 12);
select pg_temp.checa('  e o contrato guardado por inteiro',
  (select contract_text from subscriptions where owner_id = :'dono')
    = 'Contrato Diamante — 12 meses, R$ 200,00/mês.'
  and (select contract_name from subscriptions where owner_id = :'dono') = 'Fulano de Tal');
select pg_temp.checa('assinatura pendente ainda não vale',
  not public.assinatura_ativa(:'dono'));
select pg_temp.checa('  e os campeonatos continuam fechados',
  (select count(*) from championships
    where owner_id = :'dono' and plan = 'diamante' and payment_status = 'pending') = 2);

-- Contrato de campeonato alheio.
insert into auth.users (id, email) values ('ef000000-0000-0000-0000-000000000009', 'outro@teste.com')
  on conflict do nothing;
set request.jwt.claim.sub = 'ef000000-0000-0000-0000-000000000009';
select pg_temp.recusa('ninguém aceita contrato de campeonato alheio',
  $q$ select public.assinatura_aceitar('ee000000-0000-0000-0000-000000000001',
        'Intruso', '52998224725', 'v1', 'texto') $q$,
  'Somente o organizador');
set request.jwt.claim.sub = :'dono';

-- --------------------------------------------------------------------------
-- O Asaas confirma a primeira cobrança
-- --------------------------------------------------------------------------
select public.assinatura_atualizar(:'dono', 'paga', 'sub_asaas_1', 'chk_1', now() + interval '30 days') as _;

select pg_temp.checa('primeira cobrança ativa a assinatura',
  (select status from subscriptions where owner_id = :'dono') = 'active');
select pg_temp.checa('  e os 12 meses passam a contar da primeira cobrança',
  (select ends_at from subscriptions where owner_id = :'dono') > now() + interval '360 days');
select pg_temp.checa('a assinatura abre TODOS os campeonatos Diamante da conta',
  (select count(*) from championships
    where owner_id = :'dono' and plan = 'diamante' and payment_status = 'paid') = 3);

-- --------------------------------------------------------------------------
-- O cartão falha: carência de 7 dias
-- --------------------------------------------------------------------------
select public.assinatura_atualizar(:'dono', 'atrasada') as _;
select pg_temp.checa('cobrança atrasada não derruba na hora',
  (select status from subscriptions where owner_id = :'dono') = 'overdue'
  and public.assinatura_ativa(:'dono'));
select pg_temp.checa('  e os campeonatos seguem abertos durante a carência',
  (select count(*) from championships
    where owner_id = :'dono' and plan = 'diamante' and payment_status = 'paid') = 3);
select pg_temp.checa('  a varredura não fecha nada antes do prazo',
  public.assinaturas_varrer() = 0);

-- Passou a carência.
update public.subscriptions set grace_until = now() - interval '1 hour' where owner_id = :'dono';
select pg_temp.checa('passada a carência, a varredura encerra a assinatura',
  public.assinaturas_varrer() = 1);
select pg_temp.checa('  e fecha os campeonatos que dependiam dela',
  (select count(*) from championships
    where owner_id = :'dono' and plan = 'diamante' and payment_status = 'pending') = 2);
select pg_temp.checa('  mas NÃO fecha o que foi pago avulso',
  (select payment_status from championships where id = :'as3') = 'paid');

-- --------------------------------------------------------------------------
-- O cliente regulariza
-- --------------------------------------------------------------------------
update public.subscriptions set status = 'overdue', grace_until = now() + interval '2 days'
 where owner_id = :'dono';
select public.assinatura_atualizar(:'dono', 'paga') as _;
select pg_temp.checa('regularizou: volta a valer e reabre os campeonatos',
  (select status from subscriptions where owner_id = :'dono') = 'active'
  and (select count(*) from championships
        where owner_id = :'dono' and plan = 'diamante' and payment_status = 'paid') = 3);
select pg_temp.checa('  e a carência é zerada',
  (select grace_until from subscriptions where owner_id = :'dono') is null);

-- --------------------------------------------------------------------------
-- Cancelamento pelo consultor
-- --------------------------------------------------------------------------
select pg_temp.recusa('quem não é master não cancela assinatura',
  $q$ select public.assinatura_cancelar('ee999999-9999-9999-9999-999999999999') $q$,
  'Somente o administrador master');

set request.jwt.claims = '{"email":"org@teste.com"}';
select public.assinatura_cancelar(:'dono', 'a pedido do cliente') as _;
select pg_temp.checa('o consultor cancela e os campeonatos fecham',
  (select status from subscriptions where owner_id = :'dono') = 'canceled'
  and not public.assinatura_ativa(:'dono')
  and (select count(*) from championships
        where owner_id = :'dono' and plan = 'diamante' and payment_status = 'pending') = 2);
