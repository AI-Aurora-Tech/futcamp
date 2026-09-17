-- ===========================================================================
-- Tabelaço — a classificação junto com o resultado no WhatsApp
--
-- A migration 0039 manda, ao fim do jogo, só o placar. Aqui o aviso de "fim de
-- jogo" passa a levar TAMBÉM a tabela de classificação da categoria — mas só na
-- FASE DE GRUPOS, onde a tabela existe (no mata-mata não há classificação).
--
-- A tabela é um retrato do momento (todos os jogos encerrados da categoria até
-- agora), na ordem clássica do futebol: pontos, saldo, gols marcados, nome. A
-- tela do campeonato continua sendo a fonte da verdade — o aviso é o resumo.
--
-- Idempotente: pode ser reexecutada com segurança. Requer a 0039.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A classificação da categoria, como texto para o WhatsApp
--
-- Uma linha por time: "1º Leões FC · 9 pts · 3J · SG +5". Devolve NULL quando
-- ainda não há jogo encerrado (nada para classificar).
-- ---------------------------------------------------------------------------
create or replace function public.wa_classificacao_texto(p_champ uuid, p_cat text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $wa_classif$
declare
  v_pv    int;
  v_pe    int;
  v_cat   text;
  v_lista text;
begin
  select points_win, points_draw into v_pv, v_pe
    from public.championships where id = p_champ;
  v_cat := public.push_categoria(p_champ, p_cat);

  -- `is not distinct from` para casar também o caso sem categorias definidas,
  -- em que os dois lados são NULL (com `=` isso daria NULL e escaparia da conta).
  with jogos as (
    select x.home_team_id as time, x.home_score as pro, x.away_score as contra
      from public.matches x
     where x.championship_id = p_champ and x.phase = 'group'
       and x.status = 'finished' and x.home_team_id is not null
       and public.push_categoria(x.championship_id, x.category_id) is not distinct from v_cat
    union all
    select x.away_team_id, x.away_score, x.home_score
      from public.matches x
     where x.championship_id = p_champ and x.phase = 'group'
       and x.status = 'finished' and x.away_team_id is not null
       and public.push_categoria(x.championship_id, x.category_id) is not distinct from v_cat
  ),
  tabela as (
    select j.time,
           count(*)                                                as jogos,
           sum(case when coalesce(j.pro,0) > coalesce(j.contra,0) then coalesce(v_pv,3)
                    when coalesce(j.pro,0) = coalesce(j.contra,0) then coalesce(v_pe,1)
                    else 0 end)                                    as pontos,
           sum(coalesce(j.pro,0) - coalesce(j.contra,0))          as saldo,
           sum(coalesce(j.pro,0))                                 as feitos
      from jogos j
     group by j.time
  ),
  ranked as (
    select row_number() over (order by t.pontos desc, t.saldo desc, t.feitos desc, e.name) as pos,
           e.name, t.pontos, t.jogos, t.saldo
      from tabela t join public.teams e on e.id = t.time
  )
  select string_agg(
           format('%sº %s · %s pts · %sJ · SG %s%s',
                  pos, name, pontos, jogos,
                  case when saldo > 0 then '+' else '' end, saldo),
           E'\n' order by pos)
    into v_lista
    from ranked;

  return v_lista;
end;
$wa_classif$;

-- ---------------------------------------------------------------------------
-- 2. O aviso de fim de jogo passa a anexar a classificação (só fase de grupos)
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $wa_fin$
declare
  v_home    text;
  v_away    text;
  v_cat     text;
  v_msg     text;
  v_classif text;
begin
  if new.status <> 'finished' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_cat := public.push_categoria_nome(new.championship_id, new.category_id);

  v_msg := format(
    '🏁 *Fim de jogo*' || E'\n%s*%s %s × %s %s*',
    case when v_cat = '' then '' else v_cat || E'\n' end,
    coalesce(v_home, 'Mandante'),
    coalesce(new.home_score, 0),
    coalesce(new.away_score, 0),
    coalesce(v_away, 'Visitante')
  );

  -- A classificação só existe na fase de grupos. No mata-mata, fica só o placar.
  if new.phase = 'group' then
    v_classif := public.wa_classificacao_texto(new.championship_id, new.category_id);
    if v_classif is not null then
      v_msg := v_msg
        || E'\n\n📊 *Classificação*'
        || case when v_cat = '' then '' else ' — ' || v_cat end
        || E'\n' || v_classif;
    end if;
  end if;

  perform public.wa_enfileirar(
    new.championship_id,
    new.category_id,
    array[new.home_team_id, new.away_team_id],
    format('fim:%s', new.id),
    v_msg
  );
  return new;
end;
$wa_fin$;

drop trigger if exists wa_on_match_finished on public.matches;
create trigger wa_on_match_finished
  after insert or update on public.matches
  for each row execute function public.wa_on_match_finished();
