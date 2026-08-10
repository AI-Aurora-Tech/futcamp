-- ===========================================================================
-- FutCamp — seed de exemplo (opcional)
--
-- Cria um campeonato de demonstração ("Copa FutCamp") com 4 times e alguns
-- jogadores. Como as tabelas exigem um dono (owner_id → auth.users), defina
-- abaixo o UUID de um usuário já cadastrado no seu projeto Supabase
-- (Authentication → Users → copie o "User UID").
-- ===========================================================================

do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000000000'; -- <-- troque pelo seu UID
  v_champ uuid := gen_random_uuid();
  v_leoes uuid := gen_random_uuid();
  v_aguias uuid := gen_random_uuid();
  v_tigres uuid := gen_random_uuid();
  v_furia uuid := gen_random_uuid();
begin
  if not exists (select 1 from auth.users where id = v_owner) then
    raise notice 'Defina v_owner com um UID válido de auth.users antes de rodar o seed.';
    return;
  end if;

  insert into public.championships
    (id, owner_id, name, sport, format, season, status, description, logo, primary_color, double_round)
  values
    (v_champ, v_owner, 'Copa FutCamp 2026', 'futebol', 'league', '2026', 'active',
     'Campeonato de demonstração gerado pelo seed.', '🏆', '#16a34a', true);

  insert into public.teams (id, championship_id, name, short_name, logo, color, coach) values
    (v_leoes,  v_champ, 'Leões FC',       'LEO', '🦁', '#f59e0b', 'Carlos Menezes'),
    (v_aguias, v_champ, 'Águias United',  'AGU', '🦅', '#2563eb', 'Rita Alcântara'),
    (v_tigres, v_champ, 'Tigres do Vale', 'TIG', '🐯', '#dc2626', 'Paulo Vidal'),
    (v_furia,  v_champ, 'Fúria Azul',     'FUR', '🐺', '#0ea5e9', 'Marina Souza');

  insert into public.players (team_id, championship_id, name, number, position) values
    (v_leoes,  v_champ, 'Gabriel Lima',   10, 'ATA'),
    (v_leoes,  v_champ, 'Diego Rocha',     1, 'GOL'),
    (v_aguias, v_champ, 'Rafael Torres',   9, 'ATA'),
    (v_aguias, v_champ, 'Bruno Aguiar',    5, 'VOL'),
    (v_tigres, v_champ, 'Igor Nunes',      7, 'MEI'),
    (v_furia,  v_champ, 'Léo Prado',      11, 'ATA');
end $$;
