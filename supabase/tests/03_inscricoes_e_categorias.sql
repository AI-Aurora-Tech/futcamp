-- Inscrições do campeonato (0043), login do mesário por e-mail e fases por categoria.
-- Roda depois do 01_cenario.sql e do 02_regras.sql, com organizador e ids próprios.
\set ON_ERROR_STOP 0
-- O 02 reaplica migrations antigas (0033) para testar idempotência, e isso
-- volta a `team_registration` à versão dela. Reaplicar a 0043 aqui restaura a
-- versão atual — e de quebra prova que a 0043 também é idempotente.
\i :raiz/supabase/migrations/0043_inscricoes_do_campeonato.sql
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c then raise notice '✅ %', msg; else raise notice '❌ FALHOU %', msg; end if; end $$;
create or replace function pg_temp.falha(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;

-- organizador próprio (o 02 deixa o organizador do cenário como master)
insert into auth.users (id, email) values ('c4300000-0000-0000-0000-000000000099', 'org43@teste.com')
  on conflict do nothing;

-- campeonato com 2 categorias
insert into public.championships (id, owner_id, name, sport, format, season, categories)
values ('c4300000-0000-0000-0000-000000000043', 'c4300000-0000-0000-0000-000000000099',
        'Copa Cat', 'futebol', 'knockout', '2026',
        '[{"id":"s11","name":"Sub-11"},{"id":"s15","name":"Sub-15"}]'::jsonb);
insert into public.teams (id, championship_id, name) values
 ('c4300000-0000-0000-0000-000000000101','c4300000-0000-0000-0000-000000000043','T1'),
 ('c4300000-0000-0000-0000-000000000102','c4300000-0000-0000-0000-000000000043','T2'),
 ('c4300000-0000-0000-0000-000000000103','c4300000-0000-0000-0000-000000000043','T3'),
 ('c4300000-0000-0000-0000-000000000104','c4300000-0000-0000-0000-000000000043','T4');
insert into public.team_invites (team_id, championship_id, token)
values ('c4300000-0000-0000-0000-000000000101','c4300000-0000-0000-0000-000000000043','tk43');

set request.jwt.claims = '{"role":"authenticated","email":"org43@teste.com"}';
set request.jwt.claim.sub = 'c4300000-0000-0000-0000-000000000099';

-- inscrições abertas: organizador inscreve
select pg_temp.ok(not pg_temp.falha($q$insert into public.players (team_id, championship_id, name, cpf, category_id) values ('c4300000-0000-0000-0000-000000000101','c4300000-0000-0000-0000-000000000043','Ana','111','s11')$q$), 'aberto: organizador inscreve');

update public.championships set registrations_closed = true where id = 'c4300000-0000-0000-0000-000000000043';
select pg_temp.ok(pg_temp.falha($q$insert into public.players (team_id, championship_id, name, category_id) values ('c4300000-0000-0000-0000-000000000101','c4300000-0000-0000-0000-000000000043','Bia','s11')$q$), 'fechado: organizador NÃO inscreve');
select pg_temp.ok(pg_temp.falha($q$select public.reg_add_player('c4300000-0000-0000-0000-000000000101','tk43','Caio','222',null,null,null,null,'s11','atleta')$q$), 'fechado: time NÃO inscreve pelo portal');
select pg_temp.ok(not pg_temp.falha($q$update public.players set name = 'Ana Maria' where name = 'Ana'$q$), 'fechado: corrigir nome continua livre');
select pg_temp.ok(pg_temp.falha($q$update public.players set cpf = '999' where name = 'Ana Maria'$q$), 'fechado: trocar CPF é barrado');
select pg_temp.ok((public.team_registration('c4300000-0000-0000-0000-000000000101','tk43') ->> 'registrations_closed')::boolean, 'portal recebe registrations_closed');

insert into public.master_admins (email) values ('master43@teste.com');
set request.jwt.claims = '{"role":"authenticated","email":"master43@teste.com"}';
select pg_temp.ok(not pg_temp.falha($q$insert into public.players (team_id, championship_id, name, category_id) values ('c4300000-0000-0000-0000-000000000101','c4300000-0000-0000-0000-000000000043','Duda','s11')$q$), 'fechado: master inscreve');
set request.jwt.claims = '{"role":"authenticated","email":"org43@teste.com"}';

-- mesário pela página inicial
select public.create_official('c4300000-0000-0000-0000-000000000043','Mesa Um','Mesa@Teste.com','senha1');
select pg_temp.ok(jsonb_array_length(public.mesa_login_email('mesa@teste.com','senha1')) = 1, 'mesário entra por e-mail (caixa diferente)');
select pg_temp.ok(public.mesa_login_email('mesa@teste.com','senha1') -> 0 ->> 'username' = 'Mesa@Teste.com', 'devolve o usuário como gravado');
select pg_temp.ok(jsonb_array_length(public.mesa_login_email('mesa@teste.com','errada')) = 0, 'senha errada não abre');

-- mata-mata por categoria: fase de grupos encerrada no Sub-11, em curso no Sub-15
insert into public.matches (championship_id, category_id, round, phase, stage, home_team_id, away_team_id, status, home_score, away_score) values
 ('c4300000-0000-0000-0000-000000000043', null,  1, 'group', 1, 'c4300000-0000-0000-0000-000000000101','c4300000-0000-0000-0000-000000000102','finished',1,0),
 ('c4300000-0000-0000-0000-000000000043', 's15', 1, 'group', 1, 'c4300000-0000-0000-0000-000000000103','c4300000-0000-0000-0000-000000000104','finished',1,0);
select pg_temp.ok(public.ensure_knockout_stage('c4300000-0000-0000-0000-000000000043',
  '[{"phase":"semi","home_team_id":"c4300000-0000-0000-0000-000000000101","away_team_id":"c4300000-0000-0000-0000-000000000102","bracket_pos":0,"round":103},
    {"phase":"final","bracket_pos":0,"round":104}]'::jsonb, 0, 's11') = 2, 'cria mata-mata do Sub-11');
select pg_temp.ok(public.ensure_knockout_stage('c4300000-0000-0000-0000-000000000043',
  '[{"phase":"semi","home_team_id":"c4300000-0000-0000-0000-000000000103","away_team_id":"c4300000-0000-0000-0000-000000000104","bracket_pos":0,"round":103},
    {"phase":"final","bracket_pos":0,"round":104}]'::jsonb, 0, 's15') = 2, 'mata-mata do Sub-11 não impede o do Sub-15');
select pg_temp.ok(public.ensure_knockout_stage('c4300000-0000-0000-0000-000000000043',
  '[{"phase":"final","bracket_pos":0,"round":104}]'::jsonb, 0, 's15') = 0, 'não cria o do Sub-15 duas vezes');
select pg_temp.ok((select count(*) from public.matches where championship_id='c4300000-0000-0000-0000-000000000043' and phase='group' and category_id is null) = 1, 'partida sem categoria conta como Sub-11 (1ª categoria)');

update public.matches set status='finished', home_score=2, away_score=0
 where championship_id='c4300000-0000-0000-0000-000000000043' and phase='semi' and category_id='s11';
select public.advance_bracket('c4300000-0000-0000-0000-000000000043');
select pg_temp.ok((select home_team_id from public.matches where championship_id='c4300000-0000-0000-0000-000000000043' and phase='final' and category_id='s11') = 'c4300000-0000-0000-0000-000000000101', 'vencedor do Sub-11 vai à final do Sub-11');
select pg_temp.ok((select home_team_id from public.matches where championship_id='c4300000-0000-0000-0000-000000000043' and phase='final' and category_id='s15') is null, 'e NÃO à final do Sub-15');
select pg_temp.ok(public.advance_bracket('c4300000-0000-0000-0000-000000000043', 's15') = 0, 'advance por categoria responde');

-- ---------------------------------------------------------------------------
-- 0045: campeonato novo herda os mesários do organizador
-- ---------------------------------------------------------------------------
\i :raiz/supabase/migrations/0045_cadastros_do_organizador.sql
set request.jwt.claims = '{"role":"authenticated","email":"org43@teste.com"}';
set request.jwt.claim.sub = 'c4300000-0000-0000-0000-000000000099';
insert into public.championships (id, owner_id, name, sport, format, season, categories)
values ('c4300000-0000-0000-0000-000000000045', 'c4300000-0000-0000-0000-000000000099',
        'Copa Nova', 'futebol', 'league', '2027', '[{"id":"x","name":"Livre"}]'::jsonb);
select pg_temp.ok(public.copiar_mesarios_do_organizador('c4300000-0000-0000-0000-000000000045') = 1, 'campeonato novo recebe o mesário do organizador');
select pg_temp.ok(public.copiar_mesarios_do_organizador('c4300000-0000-0000-0000-000000000045') = 0, 'copiar de novo não duplica');
select pg_temp.ok(jsonb_array_length(public.mesa_login_email('mesa@teste.com','senha1')) = 2, 'mesmo e-mail e senha valem no campeonato novo');
set request.jwt.claims = '{"role":"authenticated","email":"outro@teste.com"}';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select pg_temp.ok(pg_temp.falha($q$select public.copiar_mesarios_do_organizador('c4300000-0000-0000-0000-000000000045')$q$), 'quem não é dono não copia');
