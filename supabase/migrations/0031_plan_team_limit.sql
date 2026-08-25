-- ===========================================================================
-- Tabelaço — o plano contratado passa a limitar o número de equipes
--
-- O limite existia só como promessa no cartão do plano ("até 8 equipes").
-- Nada, em lugar nenhum, o conferia: nem o botão do organizador, nem o link
-- público de criação de time, nem o banco. Um campeonato no plano Grátis
-- cadastrava 40 equipes sem uma palavra.
--
-- A conferência vai num GATILHO da tabela `teams`, não dentro das RPCs. São
-- dois caminhos hoje (o organizador inserindo direto e a
-- `create_team_via_invite`, que é SECURITY DEFINER e roda no navegador de quem
-- recebeu o link) e nada garante que não haverá um terceiro. No gatilho, todo
-- caminho passa pela mesma régua.
--
-- Campeonato que JÁ passou do limite não perde equipe nenhuma: o gatilho é de
-- INSERT. O que estava cadastrado continua; o que não cabe mais é o próximo.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A tabela de planos, do lado do banco.
--
-- Espelha `src/lib/pricing.ts`. Duplicação consciente: o app precisa do número
-- para avisar antes de clicar, e o banco precisa dele para não depender do
-- app. NULL = ilimitado (Ouro e Diamante).
-- ---------------------------------------------------------------------------
create or replace function public.plan_max_teams(p_plan text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p_plan, 'gratis'))
    when 'bronze' then 16
    when 'prata'  then 32
    when 'ouro'   then null
    when 'diamante' then null
    else 8  -- grátis
  end;
$$;

/* Nome do plano como o organizador o vê, para a mensagem de erro. */
create or replace function public.plan_tier(p_plan text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_plan, 'gratis'))
    when 'bronze' then 'Bronze'
    when 'prata'  then 'Prata'
    when 'ouro'   then 'Ouro'
    when 'diamante' then 'Diamante'
    else 'Grátis'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. O gatilho.
--
-- Conta as equipes já cadastradas no campeonato e recusa a que passaria do
-- limite. A mensagem diz o plano, o número e o caminho de saída — quem lê o
-- erro é o organizador (ou o responsável pelo time, no link público), não um
-- programador.
-- ---------------------------------------------------------------------------
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

drop trigger if exists teams_plan_limit on public.teams;
create trigger teams_plan_limit
  before insert on public.teams
  for each row execute function public.assert_team_limit();

-- ---------------------------------------------------------------------------
-- 3. Quantas vagas restam — para a tela do organizador e para a página
--    pública de criação de time, que precisa avisar ANTES de o responsável
--    preencher o formulário inteiro.
--
-- `max` nulo = ilimitado.
-- ---------------------------------------------------------------------------
create or replace function public.champ_team_slots(p_champ uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plan',  c.plan,
    'tier',  public.plan_tier(c.plan),
    'max',   public.plan_max_teams(c.plan),
    'usados', (select count(*) from public.teams t where t.championship_id = c.id),
    'restantes', case
      when public.plan_max_teams(c.plan) is null then null
      else greatest(0, public.plan_max_teams(c.plan)
                        - (select count(*) from public.teams t where t.championship_id = c.id))
    end
  )
  from public.championships c
  where c.id = p_champ;
$$;

grant execute on function public.plan_max_teams(text)    to anon, authenticated;
grant execute on function public.plan_tier(text)         to anon, authenticated;
grant execute on function public.champ_team_slots(uuid)  to anon, authenticated;
