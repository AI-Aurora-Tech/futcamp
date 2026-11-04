-- ===========================================================================
-- Tabelaço — o limite de equipes do plano passa a valer POR CATEGORIA
--
-- Grátis: 8 · Bronze: 16 · Prata: 32 · Ouro/Diamante: sem limite — em CADA
-- categoria. A 0031 contava as equipes do campeonato inteiro; um Bronze com
-- três categorias parava nas 16 primeiras equipes, quando o plano prometia 16
-- por categoria.
--
-- NÃO MEXE NOS CAMPEONATOS EM ANDAMENTO. O limite por categoria só vale para o
-- campeonato criado com "equipes previstas" (campo `expectedTeams` das
-- categorias, preenchido pelo formulário novo). Os demais seguem, sem
-- alteração, com a contagem do campeonato inteiro da 0031. Nenhuma linha de
-- `championships` é alterada por esta migration.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- O campeonato conta equipes por categoria?
create or replace function public.limite_por_categoria(p_champ uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.championships c,
           jsonb_array_elements(
             case when jsonb_typeof(c.categories) = 'array' then c.categories else '[]'::jsonb end
           ) e
     where c.id = p_champ
       and e ? 'expectedTeams'
  );
$$;

-- A contagem do campeonato inteiro (0031) sai de cena nos campeonatos por categoria.
create or replace function public.assert_team_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_max  int;
  v_have int;
begin
  if public.limite_por_categoria(new.championship_id) then
    return new;  -- quem confere é o gatilho de team_categories
  end if;

  select c.plan into v_plan
    from public.championships c
   where c.id = new.championship_id;

  v_max := public.plan_max_teams(v_plan);
  if v_max is null then
    return new;  -- plano sem limite
  end if;

  select count(*) into v_have
    from public.teams t
   where t.championship_id = new.championship_id;

  if v_have >= v_max then
    raise exception
      'O plano % permite até % equipe(s) neste campeonato. Troque de plano para inscrever mais.',
      public.plan_tier(v_plan), v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- A inscrição do clube na categoria: aqui se conta por categoria.
create or replace function public.assert_category_team_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_max  int;
  v_have int;
begin
  if not public.limite_por_categoria(new.championship_id) then
    return new;  -- campeonato antigo: vale a contagem do campeonato inteiro
  end if;

  select c.plan into v_plan
    from public.championships c
   where c.id = new.championship_id;

  v_max := public.plan_max_teams(v_plan);
  if v_max is null then
    return new;
  end if;

  -- Os outros clubes da categoria: o próprio não conta (reinscrever não pesa).
  select count(*) into v_have
    from public.team_categories tc
   where tc.championship_id = new.championship_id
     and tc.category_id = new.category_id
     and tc.team_id <> new.team_id;

  if v_have >= v_max then
    raise exception
      'O plano % permite até % equipe(s) por categoria. Troque de plano para inscrever mais.',
      public.plan_tier(v_plan), v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists team_categories_plan_limit on public.team_categories;
create trigger team_categories_plan_limit
  before insert on public.team_categories
  for each row execute function public.assert_category_team_limit();

grant execute on function public.limite_por_categoria(uuid) to anon, authenticated;
