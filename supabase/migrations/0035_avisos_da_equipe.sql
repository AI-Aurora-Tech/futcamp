-- ===========================================================================
-- Tabelaço — os avisos que a equipe recebe
--
-- Até aqui o push avisava DUAS coisas: um gol (para todos os times do grupo)
-- e alteração de elenco (para o organizador). Quem tinha um time no
-- campeonato não ficava sabendo que o jogo dele foi marcado, nem o resultado,
-- nem que perdeu um jogador por suspensão.
--
-- Esta migration cobre o que a equipe precisa saber:
--
--   1. o jogo foi marcado (ou remarcado) — com data, hora e local;
--   2. faltam 2 dias para o próximo jogo;
--   3. atleta suspenso por cartão — vermelho ou amarelo acumulado;
--   4. a classificação depois que a rodada fecha;
--   5. o resultado final do jogo que a equipe disputou;
--   6. o gol, com o nome de quem fez;
--   7. o resumo da partida da equipe, ao final do jogo.
--
-- Os itens 5 e 7 saem numa notificação só: o título leva o resultado e o
-- corpo leva o resumo. Duas notificações no mesmo segundo, para a mesma
-- pessoa, sobre o mesmo jogo, é o caminho mais curto para ela desligar tudo.
--
-- TUDO é recortado por CATEGORIA. Desde a 0033 cada categoria é uma
-- competição, e quem cuida do Sub-11 não tem por que receber a classificação
-- do Sub-17.
--
-- O item 2 é o único que não nasce de gatilho: ninguém mexe no banco quando
-- faltam 48 horas para um jogo. Ele nasce de `push_gerar_lembretes()`, que a
-- Edge Function `send-push` chama antes de esvaziar a fila.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. O aviso passa a saber de que categoria ele é.
-- ---------------------------------------------------------------------------
alter table public.push_outbox add column if not exists category_id text;

comment on column public.push_outbox.category_id is
  'Categoria a que este aviso se refere. Serve para o destinatário filtrar.';

-- Um aviso PENDENTE por chave: remarcar o jogo três vezes antes da entrega
-- deixa um aviso só, com o horário mais recente.
--
-- O índice cobre só o que ainda não saiu. Aviso já entregue sai do caminho: se
-- o mesmo assunto voltar a acontecer (o placar foi corrigido e a partida
-- encerrada de novo), é um fato novo e merece uma notificação nova.
create unique index if not exists push_outbox_dedupe_idx
  on public.push_outbox (championship_id, dedupe_key)
  where dedupe_key is not null and sent_at is null;

-- ---------------------------------------------------------------------------
-- 2. Auxiliares
-- ---------------------------------------------------------------------------

/*
 * A categoria de uma partida.
 *
 * Partida sem categoria é dado anterior à 0033 e pertence à primeira — a
 * mesma regra que o app aplica em `partidasDaCategoria`.
 */
create or replace function public.push_categoria(p_champ uuid, p_cat text)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_cat,
    (select c.categories->0->>'id' from public.championships c where c.id = p_champ)
  );
$$;

/** O nome da categoria, para escrever no aviso. Vazio quando só há uma. */
create or replace function public.push_categoria_nome(p_champ uuid, p_cat text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when (select jsonb_array_length(coalesce(c.categories, '[]'::jsonb))
            from public.championships c where c.id = p_champ) <= 1 then ''
    else coalesce((
      select cat->>'name'
        from public.championships c,
             lateral jsonb_array_elements(coalesce(c.categories, '[]'::jsonb)) cat
       where c.id = p_champ and cat->>'id' = public.push_categoria(p_champ, p_cat)
       limit 1), '')
  end;
$$;

/** Quantos amarelos suspendem nesta categoria (o costume amador é 3). */
create or replace function public.push_limite_amarelos(p_champ uuid, p_cat text)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(1, coalesce((
    select nullif(cat->>'yellowsForSuspension', '')::int
      from public.championships c,
           lateral jsonb_array_elements(coalesce(c.categories, '[]'::jsonb)) cat
     where c.id = p_champ and cat->>'id' = public.push_categoria(p_champ, p_cat)
     limit 1), 3));
$$;

/** O amarelo acumula nesta categoria? Sem definição, acumula. */
create or replace function public.push_amarelo_acumula(p_champ uuid, p_cat text)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select (cat->>'yellowAccumulates') <> 'false'
      from public.championships c,
           lateral jsonb_array_elements(coalesce(c.categories, '[]'::jsonb)) cat
     where c.id = p_champ and cat->>'id' = public.push_categoria(p_champ, p_cat)
     limit 1), true);
$$;

/*
 * Data e hora como o brasileiro lê: "sáb 12/09 às 15:00".
 *
 * O horário é o de Brasília, e não o do servidor: quem recebe o aviso está no
 * campo, não no data center.
 */
create or replace function public.push_quando(p_ts timestamptz)
returns text
language sql
stable
as $$
  select case when p_ts is null then 'data a definir' else
    (array['dom','seg','ter','qua','qui','sex','sáb'])[
      extract(dow from p_ts at time zone 'America/Sao_Paulo')::int + 1]
    || ' ' || to_char(p_ts at time zone 'America/Sao_Paulo', 'DD/MM')
    || ' às ' || to_char(p_ts at time zone 'America/Sao_Paulo', 'HH24:MI')
  end;
$$;

/** Os clubes inscritos numa categoria (clube sem inscrição vale para todas). */
create or replace function public.push_times_da_categoria(p_champ uuid, p_cat text)
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(t.id), '{}'::uuid[])
    from public.teams t
   where t.championship_id = p_champ
     and (
       exists (
         select 1 from public.team_categories tc
          where tc.team_id = t.id
            and tc.category_id = public.push_categoria(p_champ, p_cat)
       )
       or not exists (select 1 from public.team_categories tc where tc.team_id = t.id)
     );
$$;

/*
 * Enfileira um aviso.
 *
 * `dedupe_key` é o que impede a repetição: remarcar o jogo três vezes antes da
 * entrega deixa um aviso só, com o horário mais recente.
 */
create or replace function public.push_enfileirar(
  p_champ    uuid,
  p_cat      text,
  p_targets  uuid[],
  p_dedupe   text,
  p_title    text,
  p_body     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_targets is null or array_length(p_targets, 1) is null then return; end if;

  insert into public.push_outbox
    (championship_id, category_id, audience, target_teams, dedupe_key, title, body, url)
  values (
    p_champ, public.push_categoria(p_champ, p_cat), 'team', p_targets, p_dedupe,
    p_title, p_body, format('#/c/%s', p_champ)
  )
  on conflict (championship_id, dedupe_key) where dedupe_key is not null and sent_at is null
  do update set
    title        = excluded.title,
    body         = excluded.body,
    target_teams = excluded.target_teams,
    created_at   = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. AVISO 1 — jogo marcado ou remarcado
--
-- Dispara quando a partida ganha (ou muda) data, hora ou local. Não dispara na
-- geração da tabela, porque ali os jogos nascem sem data: o aviso sairia sem a
-- informação que é o motivo dele existir.
-- ---------------------------------------------------------------------------
create or replace function public.push_on_match_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home  text;
  v_away  text;
  v_cat   text;
  v_onde  text;
  v_verbo text;
begin
  if new.scheduled_at is null then return new; end if;
  if new.status <> 'scheduled' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  if tg_op = 'UPDATE' then
    -- Nada de relevante mudou: sai sem avisar.
    if new.scheduled_at is not distinct from old.scheduled_at
       and new.venue is not distinct from old.venue then
      return new;
    end if;
    v_verbo := case when old.scheduled_at is null then 'marcado' else 'REMARCADO' end;
  else
    v_verbo := 'marcado';
  end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_cat  := public.push_categoria_nome(new.championship_id, new.category_id);
  v_onde := nullif(btrim(coalesce(new.venue, '')), '');

  perform public.push_enfileirar(
    new.championship_id,
    new.category_id,
    array[new.home_team_id, new.away_team_id],
    format('jogo:%s', new.id),
    case when v_verbo = 'marcado' then '📅 Jogo marcado' else '📅 Jogo remarcado' end,
    format(
      '%s%s × %s · %s%s',
      case when v_cat = '' then '' else v_cat || ' · ' end,
      coalesce(v_home, 'Mandante'),
      coalesce(v_away, 'Visitante'),
      public.push_quando(new.scheduled_at),
      case when v_onde is null then '' else ' · ' || v_onde end
    )
  );
  return new;
end;
$$;

drop trigger if exists push_on_match_scheduled on public.matches;
create trigger push_on_match_scheduled
  after insert or update on public.matches
  for each row execute function public.push_on_match_scheduled();

-- ---------------------------------------------------------------------------
-- 4. AVISO 2 — faltam 2 dias
--
-- Este não pode nascer de gatilho: ninguém escreve no banco quando o relógio
-- passa das 48 horas. Quem chama é a Edge Function `send-push`, antes de
-- esvaziar a fila.
--
-- Entra na fila todo jogo agendado que esteja dentro da janela de 48 horas e
-- ainda não tenha lembrete. Jogo marcado em cima da hora recebe o lembrete na
-- hora — atrasado é melhor do que nunca.
-- ---------------------------------------------------------------------------
create or replace function public.push_gerar_lembretes()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_qtd  int := 0;
  v_cat  text;
  v_onde text;
begin
  for r in
    select m.*,
           h.name as home_name,
           a.name as away_name
      from public.matches m
      join public.teams h on h.id = m.home_team_id
      join public.teams a on a.id = m.away_team_id
     where m.status = 'scheduled'
       and m.scheduled_at is not null
       and m.scheduled_at > now()
       and m.scheduled_at <= now() + interval '48 hours'
       and not exists (
         select 1 from public.push_outbox o
          where o.championship_id = m.championship_id
            and o.dedupe_key = format('lembrete:%s', m.id)
       )
  loop
    v_cat  := public.push_categoria_nome(r.championship_id, r.category_id);
    v_onde := nullif(btrim(coalesce(r.venue, '')), '');

    perform public.push_enfileirar(
      r.championship_id,
      r.category_id,
      array[r.home_team_id, r.away_team_id],
      format('lembrete:%s', r.id),
      '⏰ Seu jogo é daqui a 2 dias',
      format(
        '%s%s × %s · %s%s',
        case when v_cat = '' then '' else v_cat || ' · ' end,
        r.home_name, r.away_name,
        public.push_quando(r.scheduled_at),
        case when v_onde is null then '' else ' · ' || v_onde end
      )
    );
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. AVISO 6 — gol, com o nome de quem fez
--
-- Reescreve o gatilho da 0018, que tinha dois problemas:
--
--   • avisava TODOS os times do mesmo grupo e fase. No mata-mata, onde não há
--     grupo, isso virava "todos os times da fase";
--   • lia o placar da tabela `matches`, que só é gravado quando a súmula é
--     salva. O aviso saía com o placar de ANTES do gol.
--
-- Agora vai só para os dois times em campo, e o placar é contado dos próprios
-- eventos — que é o que está correto no instante do gatilho.
-- ---------------------------------------------------------------------------
create or replace function public.push_on_goal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match  public.matches;
  v_scorer text;
  v_autor  text;
  v_home   text;
  v_away   text;
  v_gh     int;
  v_ga     int;
  v_cat    text;
  v_min    text;
begin
  if new.type not in ('goal', 'own_goal') then return new; end if;

  select * into v_match from public.matches where id = new.match_id;
  if v_match.id is null then return new; end if;
  if v_match.home_team_id is null or v_match.away_team_id is null then return new; end if;

  -- Placar contado dos eventos: gol do time conta para ele, gol contra conta
  -- para o adversário.
  select
    count(*) filter (
      where (e.type = 'goal' and e.team_id = v_match.home_team_id)
         or (e.type = 'own_goal' and e.team_id = v_match.away_team_id)),
    count(*) filter (
      where (e.type = 'goal' and e.team_id = v_match.away_team_id)
         or (e.type = 'own_goal' and e.team_id = v_match.home_team_id))
    into v_gh, v_ga
    from public.match_events e
   where e.match_id = v_match.id and e.type in ('goal', 'own_goal');

  select name into v_scorer from public.players where id = new.player_id;
  select name into v_home   from public.teams   where id = v_match.home_team_id;
  select name into v_away   from public.teams   where id = v_match.away_team_id;
  v_cat := public.push_categoria_nome(v_match.championship_id, v_match.category_id);
  v_min := case when new.minute is null then '' else format(' %s''', new.minute) end;

  v_autor := case
    when new.type = 'own_goal' then
      format(' — gol contra%s%s', case when v_scorer is null then '' else ', de ' || v_scorer end, v_min)
    when v_scorer is not null then format(' — gol de %s%s', v_scorer, v_min)
    else ''
  end;

  perform public.push_enfileirar(
    v_match.championship_id,
    v_match.category_id,
    array[v_match.home_team_id, v_match.away_team_id],
    -- Sem dedupe: cada gol é um aviso. O jogo que vira goleada é raro, e o
    -- agrupamento aqui esconderia o gol que a pessoa está esperando.
    null,
    case when v_cat = '' then '⚽ Gol!' else format('⚽ Gol no %s', v_cat) end,
    format('%s %s × %s %s%s',
           coalesce(v_home, 'Mandante'), v_gh, v_ga, coalesce(v_away, 'Visitante'), v_autor)
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. AVISO 3 — atleta suspenso por cartão
--
-- Roda quando a partida encerra, porque é aí que a conta fecha. Dois motivos:
--
--   • vermelho na partida — vale em qualquer fase;
--   • amarelo que completou o limite da categoria (3, por costume), contado só
--     na fase de grupos, como no resto do app.
--
-- O aviso vai só para o time do atleta: é ele quem precisa refazer a escalação.
-- ---------------------------------------------------------------------------
create or replace function public.push_suspensoes(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m        public.matches;
  r        record;
  v_limite int;
  v_acum   boolean;
  v_cat    text;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return; end if;

  v_cat    := public.push_categoria(m.championship_id, m.category_id);
  v_limite := public.push_limite_amarelos(m.championship_id, m.category_id);
  v_acum   := public.push_amarelo_acumula(m.championship_id, m.category_id);

  -- Vermelho nesta partida.
  for r in
    select distinct e.player_id, e.team_id, p.name
      from public.match_events e
      join public.players p on p.id = e.player_id
     where e.match_id = p_match and e.type = 'red_card' and e.player_id is not null
  loop
    perform public.push_enfileirar(
      m.championship_id, m.category_id, array[r.team_id],
      format('susp:%s:%s', p_match, r.player_id),
      '🟥 Suspensão automática',
      format('%s levou cartão vermelho e não joga a próxima partida.', r.name)
    );
  end loop;

  if not v_acum or m.phase <> 'group' then return; end if;

  -- Amarelo acumulado: só quem levou amarelo NESTA partida pode ter fechado a
  -- conta agora. Sem esse recorte, o aviso sairia de novo a cada rodada.
  for r in
    select p.id as player_id, e.team_id, p.name,
           (select count(*)
              from public.match_events x
              join public.matches xm on xm.id = x.match_id
             where x.player_id = p.id
               and x.type = 'yellow_card'
               and xm.championship_id = m.championship_id
               and xm.status = 'finished'
               and xm.phase = 'group'
               and public.push_categoria(xm.championship_id, xm.category_id) = v_cat
           ) as total
      from public.match_events e
      join public.players p on p.id = e.player_id
     where e.match_id = p_match and e.type = 'yellow_card' and e.player_id is not null
     group by p.id, e.team_id, p.name
  loop
    if r.total > 0 and r.total % v_limite = 0 then
      perform public.push_enfileirar(
        m.championship_id, m.category_id, array[r.team_id],
        format('susp:%s:%s', p_match, r.player_id),
        '🟨 Suspensão por cartões',
        format('%s completou %s amarelos e não joga a próxima partida.', r.name, r.total)
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. AVISOS 5 e 7 — resultado final e resumo da partida
--
-- Uma notificação por equipe: o título traz o resultado, o corpo traz o
-- resumo — gols dos seus atletas, cartões e o próximo compromisso.
--
-- Por equipe, e não uma para as duas, porque "vitória" e "derrota" não cabem
-- na mesma frase, e o resumo é sobre os atletas de quem recebe.
-- ---------------------------------------------------------------------------
create or replace function public.push_resumo_da_partida(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m         public.matches;
  v_home    text;
  v_away    text;
  v_cat     text;
  v_gh      int;
  v_ga      int;
  lado      record;
  v_gols    text;
  v_cart    text;
  v_prox    record;
  v_corpo   text;
  v_titulo  text;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return; end if;
  if m.home_team_id is null or m.away_team_id is null then return; end if;

  select name into v_home from public.teams where id = m.home_team_id;
  select name into v_away from public.teams where id = m.away_team_id;
  v_cat := public.push_categoria_nome(m.championship_id, m.category_id);
  v_gh  := coalesce(m.home_score, 0);
  v_ga  := coalesce(m.away_score, 0);

  -- Um aviso para cada lado: o mesmo jogo é vitória de um e derrota do outro.
  for lado in
    select m.home_team_id as eu, m.away_team_id as ele, v_gh as meus, v_ga as dele,
           coalesce(v_home, 'Mandante') as meu_nome, coalesce(v_away, 'Visitante') as nome_dele
    union all
    select m.away_team_id, m.home_team_id, v_ga, v_gh,
           coalesce(v_away, 'Visitante'), coalesce(v_home, 'Mandante')
  loop
    -- Os gols dos MEUS atletas, na ordem em que saíram.
    select string_agg(
             p.name || case when e.minute is null then '' else format(' (%s'')', e.minute) end,
             ', ' order by coalesce(e.minute, 999), e.created_at)
      into v_gols
      from public.match_events e
      left join public.players p on p.id = e.player_id
     where e.match_id = p_match and e.type = 'goal'
       and e.team_id = lado.eu and p.name is not null;

    select nullif(concat_ws(', ',
             nullif(format('%s amarelo(s)', count(*) filter (where e.type = 'yellow_card')), '0 amarelo(s)'),
             nullif(format('%s vermelho(s)', count(*) filter (where e.type = 'red_card')), '0 vermelho(s)')
           ), '')
      into v_cart
      from public.match_events e
     where e.match_id = p_match and e.team_id = lado.eu
       and e.type in ('yellow_card', 'red_card');

    -- O próximo compromisso desta equipe na mesma categoria.
    select x.scheduled_at,
           case when x.home_team_id = lado.eu then ax.name else hx.name end as adversario
      into v_prox
      from public.matches x
      left join public.teams hx on hx.id = x.home_team_id
      left join public.teams ax on ax.id = x.away_team_id
     where x.championship_id = m.championship_id
       and x.status = 'scheduled'
       and x.id <> p_match
       and (x.home_team_id = lado.eu or x.away_team_id = lado.eu)
       and public.push_categoria(x.championship_id, x.category_id)
           = public.push_categoria(m.championship_id, m.category_id)
     order by x.scheduled_at nulls last, x.round
     limit 1;

    v_titulo := format('%s %s %s × %s %s',
      case when lado.meus > lado.dele then '🏆 Vitória —'
           when lado.meus < lado.dele then '🏁 Derrota —'
           else '🤝 Empate —' end,
      lado.meu_nome, lado.meus, lado.dele, lado.nome_dele);

    v_corpo := concat_ws(' · ',
      nullif(v_cat, ''),
      case when v_gols is null then 'Sem gols da sua equipe' else 'Gols: ' || v_gols end,
      v_cart,
      case
        when v_prox.adversario is null then null
        else format('Próximo: %s contra %s',
                    public.push_quando(v_prox.scheduled_at), v_prox.adversario)
      end
    );

    perform public.push_enfileirar(
      m.championship_id, m.category_id, array[lado.eu],
      format('resumo:%s:%s', p_match, lado.eu),
      v_titulo,
      v_corpo
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. AVISO 4 — a classificação depois que a rodada fecha
--
-- Sai uma vez por rodada, quando o último jogo dela encerra, e vai para todos
-- os clubes da categoria. A ordem é a clássica do futebol: pontos, saldo,
-- gols marcados. A tela do campeonato continua sendo a fonte da verdade — o
-- aviso é o convite para abri-la, não a tabela oficial.
-- ---------------------------------------------------------------------------
create or replace function public.push_classificacao(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  v_cat   text;
  v_nome  text;
  v_lista text;
  v_pv    int;
  v_pe    int;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null or m.phase <> 'group' then return; end if;

  v_cat := public.push_categoria(m.championship_id, m.category_id);

  -- A rodada só fecha quando não sobra jogo em aberto nela.
  if exists (
    select 1 from public.matches x
     where x.championship_id = m.championship_id
       and x.phase = 'group'
       and x.round = m.round
       and public.push_categoria(x.championship_id, x.category_id) = v_cat
       and x.status <> 'finished'
  ) then
    return;
  end if;

  select points_win, points_draw into v_pv, v_pe
    from public.championships where id = m.championship_id;

  with jogos as (
    select x.home_team_id as time, x.home_score as pro, x.away_score as contra
      from public.matches x
     where x.championship_id = m.championship_id and x.phase = 'group'
       and x.status = 'finished' and x.home_team_id is not null
       and public.push_categoria(x.championship_id, x.category_id) = v_cat
    union all
    select x.away_team_id, x.away_score, x.home_score
      from public.matches x
     where x.championship_id = m.championship_id and x.phase = 'group'
       and x.status = 'finished' and x.away_team_id is not null
       and public.push_categoria(x.championship_id, x.category_id) = v_cat
  ),
  tabela as (
    select j.time,
           sum(case when coalesce(j.pro,0) > coalesce(j.contra,0) then coalesce(v_pv,3)
                    when coalesce(j.pro,0) = coalesce(j.contra,0) then coalesce(v_pe,1)
                    else 0 end)                                    as pontos,
           sum(coalesce(j.pro,0) - coalesce(j.contra,0))           as saldo,
           sum(coalesce(j.pro,0))                                  as feitos
      from jogos j
     group by j.time
  ),
  topo as (
    select row_number() over (order by t.pontos desc, t.saldo desc, t.feitos desc, e.name) as pos,
           e.name, t.pontos
      from tabela t join public.teams e on e.id = t.time
     order by t.pontos desc, t.saldo desc, t.feitos desc, e.name
     limit 3
  )
  select string_agg(format('%sº %s (%s pts)', pos, name, pontos), ' · ' order by pos)
    into v_lista from topo;

  if v_lista is null then return; end if;

  v_nome := public.push_categoria_nome(m.championship_id, m.category_id);

  perform public.push_enfileirar(
    m.championship_id, m.category_id,
    public.push_times_da_categoria(m.championship_id, m.category_id),
    format('classif:%s:%s:%s', m.championship_id, v_cat, m.round),
    format('📊 Rodada %s encerrada%s', m.round,
           case when v_nome = '' then '' else ' · ' || v_nome end),
    format('Classificação: %s', v_lista)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. O gatilho do apito final
--
-- Encerrar a partida dispara, de uma vez, tudo o que depende do fim do jogo:
-- suspensões, resumo de cada equipe e — se a rodada fechou — a classificação.
-- ---------------------------------------------------------------------------
create or replace function public.push_on_match_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'finished' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;

  perform public.push_resumo_da_partida(new.id);
  perform public.push_suspensoes(new.id);
  perform public.push_classificacao(new.id);
  return new;
end;
$$;

drop trigger if exists push_on_match_finished on public.matches;
create trigger push_on_match_finished
  after insert or update on public.matches
  for each row execute function public.push_on_match_finished();

-- ---------------------------------------------------------------------------
-- Permissões
--
-- `push_gerar_lembretes` só é chamada pela Edge Function `send-push`, que usa
-- a service role. Fica fechada para o navegador de propósito: enfileirar
-- lembrete não é coisa que o app peça, e um botão que gera fila é um botão
-- que alguém aperta mil vezes.
-- ---------------------------------------------------------------------------
revoke all on function public.push_gerar_lembretes() from public, anon, authenticated;
grant execute on function public.push_gerar_lembretes() to service_role;
