-- ===========================================================================
-- Tabelaço — um CPF, um time dentro do campeonato
--
--  • Inscrito por uma equipe, o atleta NÃO pode ser inscrito por outra equipe
--    do mesmo campeonato — em nenhuma categoria.
--  • Pela MESMA equipe ele pode ser inscrito em outra categoria (a regra de
--    idade da categoria continua valendo, verificada nas RPCs de inscrição).
--  • O mesmo CPF não se repete na mesma categoria.
--
-- A regra vale para QUALQUER caminho de escrita: painel do administrador,
-- link de inscrição do time (RPCs `reg_add_player` / `reg_update_player`),
-- criação de time por link e importação de planilha.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

/** CPF apenas com dígitos (os cadastros antigos podem ter máscara). */
create or replace function public.cpf_digits(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;

-- ---------------------------------------------------------------------------
-- Higiene dos dados antes de criar o índice: se já existirem duplicados, a
-- criação falha e o operador precisa resolver. Esta consulta mostra os casos.
--
--   select championship_id, public.cpf_digits(cpf) as cpf,
--          array_agg(distinct team_id) as times, count(*)
--     from public.players
--    where public.cpf_digits(cpf) is not null
--    group by 1, 2
--   having count(distinct team_id) > 1;
-- ---------------------------------------------------------------------------

-- Mesmo CPF não se repete na mesma categoria do campeonato.
create unique index if not exists players_cpf_category_unique
  on public.players (
    championship_id,
    public.cpf_digits(cpf),
    coalesce(category_id::text, '')
  )
  where public.cpf_digits(cpf) is not null;

/** Impede que o mesmo CPF seja inscrito por dois times do campeonato. */
create or replace function public.players_one_team_per_cpf()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cpf   text := public.cpf_digits(new.cpf);
  v_team  uuid;
  v_name  text;
begin
  if v_cpf is null then return new; end if;

  select p.team_id into v_team
    from public.players p
   where p.championship_id = new.championship_id
     and public.cpf_digits(p.cpf) = v_cpf
     and p.team_id <> new.team_id
     and p.id <> new.id
   limit 1;

  if v_team is not null then
    select t.name into v_name from public.teams t where t.id = v_team;
    raise exception
      'Este CPF já está inscrito neste campeonato pelo time %. Um atleta só pode defender uma equipe no mesmo campeonato.',
      coalesce(v_name, 'adversário')
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists players_one_team_per_cpf on public.players;
create trigger players_one_team_per_cpf
  before insert or update of cpf, team_id, championship_id on public.players
  for each row execute function public.players_one_team_per_cpf();

grant execute on function public.cpf_digits(text) to anon, authenticated;
