-- ===========================================================================
-- 0060 — Limite de equipes por categoria em TODOS os campeonatos
-- ===========================================================================
-- A 0050 passou o limite do plano (Grátis 8 · Bronze 16 · Prata 32) a valer
-- por categoria, mas só nos campeonatos criados com "equipes previstas". Os
-- outros continuavam somando as categorias: um Prata com Sub10 e Sub12 parava
-- em 32 equipes no campeonato inteiro, quando o plano promete 32 em cada.
--
-- Agora vale por categoria em todo campeonato que tem categorias. Sem
-- categorias, segue a contagem do campeonato inteiro (dá no mesmo).
--
-- Clube sem categoria definida (sem linha em `team_categories`) joga em todas
-- as categorias — é assim que o app o mostra —, então conta em cada uma.
--
-- Rede de segurança: o clube que entra sem categoria não passa pelo gatilho de
-- `team_categories`; para ele, o teto do campeonato é limite × nº de categorias.
--
-- Requer a 0050. Idempotente.
-- ===========================================================================

create or replace function public.limite_por_categoria(p_champ uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.championships c
     where c.id = p_champ
       and jsonb_typeof(c.categories) = 'array'
       and jsonb_array_length(c.categories) > 0
  );
$$;

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
  v_cats int;
begin
  select c.plan,
         case when jsonb_typeof(c.categories) = 'array' then jsonb_array_length(c.categories) else 0 end
    into v_plan, v_cats
    from public.championships c
   where c.id = new.championship_id;

  v_max := public.plan_max_teams(v_plan);
  if v_max is null then
    return new;  -- plano sem limite
  end if;

  select count(*) into v_have
    from public.teams t
   where t.championship_id = new.championship_id;

  -- Com categorias, quem confere cada categoria é o gatilho de team_categories;
  -- aqui só o teto do campeonato inteiro (limite × categorias).
  if v_have >= v_max * greatest(v_cats, 1) then
    raise exception
      'O plano % permite até % equipe(s) %. Troque de plano para inscrever mais.',
      public.plan_tier(v_plan), v_max,
      case when v_cats > 0 then 'por categoria' else 'neste campeonato' end
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

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
    return new;
  end if;

  select c.plan into v_plan
    from public.championships c
   where c.id = new.championship_id;

  v_max := public.plan_max_teams(v_plan);
  if v_max is null then
    return new;
  end if;

  -- Os outros clubes da categoria (o próprio não conta) + os clubes sem
  -- categoria definida, que jogam em todas.
  select
    (select count(*) from public.team_categories tc
      where tc.championship_id = new.championship_id
        and tc.category_id = new.category_id
        and tc.team_id <> new.team_id)
  + (select count(*) from public.teams t
      where t.championship_id = new.championship_id
        and t.id <> new.team_id
        and not exists (select 1 from public.team_categories x where x.team_id = t.id))
  into v_have;

  if v_have >= v_max then
    raise exception
      'O plano % permite até % equipe(s) por categoria. Troque de plano para inscrever mais.',
      public.plan_tier(v_plan), v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
