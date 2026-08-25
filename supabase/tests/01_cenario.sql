-- Um organizador, um campeonato, um time e o convite — como no app.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'org@teste.com')
  on conflict do nothing;

insert into public.championships (id, owner_id, name, sport, format, season, categories)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        'Copa Teste', 'futebol', 'league', '2026',
        '[{"id":"cat1","name":"Sub-13","allowFederated":true,"maxFederated":2}]'::jsonb)
on conflict (id) do nothing;

insert into public.teams (id, championship_id, name)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Time A')
on conflict (id) do nothing;

insert into public.team_invites (team_id, championship_id, token)
values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'tok123')
on conflict do nothing;
