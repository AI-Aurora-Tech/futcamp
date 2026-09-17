-- ===========================================================================
-- Tabelaço — o nome do campeonato em toda mensagem de WhatsApp
--
-- Quem recebe pode organizar mais de um campeonato (ou um time em vários). Sem
-- o nome, "Jogo marcado" não diz de qual competição. Esta migration coloca o
-- nome do campeonato como PRIMEIRA linha de cada aviso: jogo marcado/remarcado,
-- fim de jogo e lembrete de inscrição.
--
-- Só reescreve os três geradores (com `create or replace`); a fila, os gatilhos
-- e o resto seguem iguais. Idempotente. Requer a 0039 e a 0040.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Jogo marcado / remarcado
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public
as $wa_sched$
declare
  v_camp  text;
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
    if new.scheduled_at is not distinct from old.scheduled_at
       and new.venue is not distinct from old.venue then
      return new;
    end if;
    v_verbo := case when old.scheduled_at is null then 'marcado' else 'remarcado' end;
  else
    v_verbo := 'marcado';
  end if;

  select name into v_camp from public.championships where id = new.championship_id;
  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_cat  := public.push_categoria_nome(new.championship_id, new.category_id);
  v_onde := nullif(btrim(coalesce(new.venue, '')), '');

  perform public.wa_enfileirar(
    new.championship_id,
    new.category_id,
    array[new.home_team_id, new.away_team_id],
    format('jogo:%s', new.id),
    format(
      '🏆 *%s*' || E'\n%s%s × %s%s%s',
      coalesce(v_camp, 'Campeonato'),
      case when v_verbo = 'marcado' then '📅 *Jogo marcado*' || E'\n' else '📅 *Jogo remarcado*' || E'\n' end
        || case when v_cat = '' then '' else v_cat || ' · ' end,
      coalesce(v_home, 'Mandante'),
      coalesce(v_away, 'Visitante'),
      E'\n🕓 ' || public.push_quando(new.scheduled_at),
      case when v_onde is null then '' else E'\n📍 ' || v_onde end
    )
  );
  return new;
end;
$wa_sched$;

-- ---------------------------------------------------------------------------
-- 2. Fim de jogo (com a classificação, na fase de grupos)
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $wa_fin$
declare
  v_camp    text;
  v_home    text;
  v_away    text;
  v_cat     text;
  v_msg     text;
  v_classif text;
begin
  if new.status <> 'finished' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  select name into v_camp from public.championships where id = new.championship_id;
  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_cat := public.push_categoria_nome(new.championship_id, new.category_id);

  v_msg := format(
    '🏆 *%s*' || E'\n🏁 *Fim de jogo*' || E'\n%s*%s %s × %s %s*',
    coalesce(v_camp, 'Campeonato'),
    case when v_cat = '' then '' else v_cat || E'\n' end,
    coalesce(v_home, 'Mandante'),
    coalesce(new.home_score, 0),
    coalesce(new.away_score, 0),
    coalesce(v_away, 'Visitante')
  );

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

-- ---------------------------------------------------------------------------
-- 3. Lembrete de inscrição (6h antes do prazo)
-- ---------------------------------------------------------------------------
create or replace function public.wa_gerar_lembretes_inscricao()
returns int
language plpgsql
security definer
set search_path = public
as $wa_lembr$
declare
  r        record;
  v_qtd    int := 0;
  v_cat    text;
  v_prazo  timestamptz;
begin
  for r in
    select m.*,
           h.name as home_name,
           a.name as away_name,
           c.name as camp_name,
           c.registration_cutoff_hours as cutoff
      from public.matches m
      join public.teams h on h.id = m.home_team_id
      join public.teams a on a.id = m.away_team_id
      join public.championships c on c.id = m.championship_id
     where m.status = 'scheduled'
       and m.scheduled_at is not null
       and coalesce(c.registration_cutoff_hours, 0) > 0
       and not (c.closed_rounds @> to_jsonb(m.round))
       and now() >= m.scheduled_at - make_interval(hours => c.registration_cutoff_hours) - interval '6 hours'
       and now() <  m.scheduled_at - make_interval(hours => c.registration_cutoff_hours)
       and not exists (
         select 1 from public.whatsapp_outbox o
          where o.championship_id = m.championship_id
            and o.dedupe_key = format('insc:%s', m.id)
       )
  loop
    v_cat   := public.push_categoria_nome(r.championship_id, r.category_id);
    v_prazo := r.scheduled_at - make_interval(hours => r.cutoff);

    perform public.wa_enfileirar(
      r.championship_id,
      r.category_id,
      array[r.home_team_id, r.away_team_id],
      format('insc:%s', r.id),
      format(
        '🏆 *%s*' || E'\n⏰ *Faltam 6 horas para o fim das inscrições da rodada*' || E'\n%s%s × %s'
          || E'\n🗓️ Jogo: %s'
          || E'\n⛔ Prazo para inscrever/ajustar atletas: %s'
          || E'\n\nRevise sua escalação antes do prazo.',
        coalesce(r.camp_name, 'Campeonato'),
        case when v_cat = '' then '' else v_cat || ' · ' end,
        r.home_name, r.away_name,
        public.push_quando(r.scheduled_at),
        public.push_quando(v_prazo)
      )
    );
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$wa_lembr$;

revoke all on function public.wa_gerar_lembretes_inscricao() from public, anon, authenticated;
grant  execute on function public.wa_gerar_lembretes_inscricao() to service_role;
