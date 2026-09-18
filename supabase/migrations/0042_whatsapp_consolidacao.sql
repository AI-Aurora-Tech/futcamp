-- ===========================================================================
-- Tabelaço — consolidação do WhatsApp na integração `send-whatsapp`
--
-- CONTEXTO: existiam DUAS integrações de WhatsApp disputando a mesma tabela
-- `whatsapp_outbox`:
--   • `send-whatsapp`  → fila no formato (target_teams uuid[], message text),
--     ambos NOT NULL; a Edge Function resolve o telefone (teams.phone) na hora
--     do envio e troca a 🏆 pela logo do campeonato.
--   • `whatsapp-evolution` (migration 0041) → fila no formato (to_phone, body).
--
-- Como a 0041 rodou por último, ela SOBRESCREVEU `wa_on_match_scheduled` e
-- `wa_on_match_finished` com versões que inserem to_phone/body SEM preencher
-- message/target_teams (NOT NULL) — e é isso que estava quebrando o envio: o
-- INSERT do gatilho falhava.
--
-- Esta migration consolida TUDO no formato `send-whatsapp`:
--   1. `wa_enfileirar(uuid,text,uuid[],text,text)` canônica (update-then-insert,
--      dispensa índice de conflito);
--   2. gatilhos de partida MARCADA / REMARCADA / ENCERRADA reescritos para
--      gravar message + target_teams;
--   3. RPC `wa_cancelar_partida` no mesmo formato (partida CANCELADA);
--   4. `wa_gerar_lembretes_inscricao()` — lembrete 18 h antes do prazo final;
--   5. remove os objetos conflitantes da 0041 (`wa_gerar_prazos`, a `wa_enfileirar`
--      de to_phone/body). As colunas to_phone/body ficam (nulas, inofensivas).
--
-- Todas as mensagens começam por `🏆 *Campeonato*` — a `send-whatsapp` troca a
-- 🏆 pela logo (emoji ou imagem) do campeonato.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove os objetos conflitantes da 0041 (formato to_phone/body).
-- ---------------------------------------------------------------------------
drop function if exists public.wa_gerar_prazos();
drop function if exists public.wa_enfileirar(uuid, text[], text, text);
drop function if exists public.wa_fones_do_jogo(uuid, uuid, uuid);

-- ---------------------------------------------------------------------------
-- 2. Helpers (create or replace: define um comportamento conhecido, não
--    importa qual versão existia antes). push_quando / push_categoria_nome
--    vêm da migration 0035 e são reaproveitados.
-- ---------------------------------------------------------------------------

/** O nome do campeonato com a temporada, para o topo de toda mensagem. */
create or replace function public.wa_champ_nome(p_champ uuid)
returns text language sql stable set search_path = public as $$
  select btrim(c.name || coalesce(' ' || nullif(btrim(c.season), ''), ''))
    from public.championships c where c.id = p_champ;
$$;

/** O campo e o endereço: "Estádio Municipal — Av. Brasil, 1000". */
create or replace function public.wa_local(p_champ uuid, p_venue text)
returns text language sql stable set search_path = public as $$
  select case
    when nullif(btrim(coalesce(p_venue, '')), '') is null then null
    else p_venue || coalesce(
      ' — ' || nullif(btrim((
        select v->>'address'
          from public.championships c,
               lateral jsonb_array_elements(coalesce(c.venues, '[]'::jsonb)) v
         where c.id = p_champ and v->>'name' = p_venue
         limit 1)), ''), '')
  end;
$$;

/** O árbitro escalado, pelo id em `championships.referees`. */
create or replace function public.wa_arbitro(p_champ uuid, p_ref text)
returns text language sql stable set search_path = public as $$
  select nullif(btrim((
    select r->>'name'
      from public.championships c,
           lateral jsonb_array_elements(coalesce(c.referees, '[]'::jsonb)) r
     where c.id = p_champ and r->>'id' = p_ref
     limit 1)), '');
$$;

/** "Sub-15 · Rodada 3" (grupos) ou "Sub-15 · Semifinal" (mata-mata). */
create or replace function public.wa_comp_linha(
  p_champ uuid, p_cat text, p_phase text, p_round int
)
returns text language sql stable set search_path = public as $$
  select concat_ws(' · ',
    nullif(public.push_categoria_nome(p_champ, p_cat), ''),
    case p_phase
      when 'group'       then 'Rodada ' || p_round
      when 'round_of_32' then '32-avos de final'
      when 'round_of_16' then 'Oitavas de final'
      when 'quarter'     then 'Quartas de final'
      when 'semi'        then 'Semifinal'
      when 'final'       then 'Final'
      when 'third_place' then 'Disputa de 3º lugar'
      else 'Rodada ' || p_round
    end);
$$;

/** A classificação atual da categoria (todas as equipes; do grupo, se houver). */
create or replace function public.wa_classificacao(p_match uuid)
returns text language plpgsql stable set search_path = public as $$
declare
  m public.matches; v_cat text; v_grp text; v_pv int; v_pe int; v_lista text;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return null; end if;
  v_cat := public.push_categoria(m.championship_id, m.category_id);
  v_grp := nullif(m."group", '');
  select points_win, points_draw into v_pv, v_pe
    from public.championships where id = m.championship_id;

  with jogos as (
    select x.home_team_id as time, x."group" as grp, x.home_score as pro, x.away_score as contra
      from public.matches x
     where x.championship_id = m.championship_id and x.phase = 'group'
       and x.status = 'finished' and x.home_team_id is not null
       and public.push_categoria(x.championship_id, x.category_id) = v_cat
    union all
    select x.away_team_id, x."group", x.away_score, x.home_score
      from public.matches x
     where x.championship_id = m.championship_id and x.phase = 'group'
       and x.status = 'finished' and x.away_team_id is not null
       and public.push_categoria(x.championship_id, x.category_id) = v_cat
  ),
  filtrado as (select * from jogos j where v_grp is null or coalesce(j.grp,'') = v_grp),
  tabela as (
    select j.time,
           count(*) filter (where coalesce(j.pro,0) >  coalesce(j.contra,0)) as v,
           count(*) filter (where coalesce(j.pro,0) =  coalesce(j.contra,0)) as e,
           count(*) filter (where coalesce(j.pro,0) <  coalesce(j.contra,0)) as d,
           sum(case when coalesce(j.pro,0) > coalesce(j.contra,0) then coalesce(v_pv,3)
                    when coalesce(j.pro,0) = coalesce(j.contra,0) then coalesce(v_pe,1)
                    else 0 end) as pontos,
           sum(coalesce(j.pro,0) - coalesce(j.contra,0)) as saldo,
           sum(coalesce(j.pro,0)) as feitos
      from filtrado j group by j.time
  ),
  ranked as (
    select row_number() over (order by t.pontos desc, t.saldo desc, t.feitos desc, e2.name) as pos,
           e2.name, t.pontos, t.v, t.e, t.d, t.saldo
      from tabela t join public.teams e2 on e2.id = t.time
  )
  select string_agg(
           format('%sº %s — %s pts (%sV %sE %sD, SG %s%s)', pos, name, pontos, v, e, d,
                  case when saldo >= 0 then '+' else '' end, saldo),
           E'\n' order by pos)
    into v_lista from ranked;
  return v_lista;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Enfileirar (formato send-whatsapp). Update-then-insert dispensa índice de
--    conflito e agrupa avisos repetidos do mesmo assunto enquanto pendentes.
--    Mantém a assinatura já existente (uuid,text,uuid[],text,text).
-- ---------------------------------------------------------------------------
create or replace function public.wa_enfileirar(
  p_champ    uuid,
  p_cat      text,
  p_targets  uuid[],
  p_dedupe   text,
  p_message  text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_targets is null or array_length(p_targets, 1) is null then return; end if;

  if p_dedupe is not null then
    update public.whatsapp_outbox
       set message = p_message, target_teams = p_targets,
           category_id = p_cat, created_at = now()
     where championship_id = p_champ and dedupe_key = p_dedupe and sent_at is null;
    if found then return; end if;
  end if;

  insert into public.whatsapp_outbox
    (championship_id, category_id, target_teams, dedupe_key, message)
  values (p_champ, p_cat, p_targets, p_dedupe, p_message);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Partida MARCADA / REMARCADA
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_scheduled()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_home text; v_away text; v_local text; v_ref text; v_novo boolean; v_msg text;
begin
  if new.scheduled_at is null then return new; end if;
  if new.status <> 'scheduled' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  if tg_op = 'UPDATE' then
    if new.scheduled_at is not distinct from old.scheduled_at
       and new.venue is not distinct from old.venue
       and new.referee_id is not distinct from old.referee_id then
      return new;
    end if;
    v_novo := old.scheduled_at is null;
  else
    v_novo := true;
  end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_local := public.wa_local(new.championship_id, new.venue);
  v_ref   := public.wa_arbitro(new.championship_id, new.referee_id);

  v_msg := format(
    E'🏆 *%s*\n%s\n\n⚽ %s x %s\n🏅 %s\n🗓️ %s%s%s%s\n\n%s',
    public.wa_champ_nome(new.championship_id),
    case when v_novo then '📅 *Partida marcada*' else '🔄 *Partida remarcada*' end,
    coalesce(v_home,'Mandante'), coalesce(v_away,'Visitante'),
    public.wa_comp_linha(new.championship_id, new.category_id, new.phase, new.round),
    case when not v_novo and tg_op='UPDATE' and old.scheduled_at is not null
              and old.scheduled_at is distinct from new.scheduled_at
         then 'Antes: ' || public.push_quando(old.scheduled_at) || E'\n🗓️ Agora: '
         else '' end,
    public.push_quando(new.scheduled_at),
    case when v_local is null then '' else E'\n📍 ' || v_local end,
    case when v_ref   is null then '' else E'\n🧑‍⚖️ Árbitro: ' || v_ref end,
    case when v_novo then 'Bom jogo! ⚽' else '⚠️ Anote a mudança!' end
  );

  perform public.wa_enfileirar(
    new.championship_id, new.category_id,
    array[new.home_team_id, new.away_team_id]::uuid[],
    format('jogo:%s', new.id), v_msg
  );
  return new;
end;
$$;

drop trigger if exists wa_on_match_scheduled on public.matches;
create trigger wa_on_match_scheduled
  after insert or update on public.matches
  for each row execute function public.wa_on_match_scheduled();

-- ---------------------------------------------------------------------------
-- 5. Partida ENCERRADA — resultado + classificação (grupos) ou quem avança.
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_finished()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_home text; v_away text; v_gh int; v_ga int; v_pen text;
  v_win uuid; v_wname text; v_class text; v_msg text;
begin
  if new.status <> 'finished' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_gh := coalesce(new.home_score, 0);
  v_ga := coalesce(new.away_score, 0);

  if new.phase = 'group' then
    v_class := public.wa_classificacao(new.id);
    v_msg := format(
      E'🏆 *%s*\n🏁 *Fim de jogo* · %s\n\n⚽ %s %s x %s %s\n\n📊 *Classificação*\n%s',
      public.wa_champ_nome(new.championship_id),
      public.wa_comp_linha(new.championship_id, new.category_id, new.phase, new.round),
      coalesce(v_home,'Mandante'), v_gh, v_ga, coalesce(v_away,'Visitante'),
      coalesce(v_class, 'Classificação indisponível.')
    );
  else
    v_pen := case
      when new.penalty_home is not null and new.penalty_away is not null
      then format(E'\n🥅 Pênaltis: %s x %s', new.penalty_home, new.penalty_away) else '' end;
    v_win := coalesce(
      new.winner_team_id,
      case when new.penalty_home is not null and new.penalty_away is not null
                and new.penalty_home <> new.penalty_away
           then case when new.penalty_home > new.penalty_away then new.home_team_id else new.away_team_id end
           when v_gh <> v_ga
           then case when v_gh > v_ga then new.home_team_id else new.away_team_id end end);
    select name into v_wname from public.teams where id = v_win;
    v_msg := format(
      E'🏆 *%s*\n🏁 *Fim de jogo* · %s\n\n⚽ %s %s x %s %s%s%s',
      public.wa_champ_nome(new.championship_id),
      public.wa_comp_linha(new.championship_id, new.category_id, new.phase, new.round),
      coalesce(v_home,'Mandante'), v_gh, v_ga, coalesce(v_away,'Visitante'),
      v_pen,
      case when v_wname is null then ''
           when new.phase = 'final' then format(E'\n🏆 %s é campeão!', v_wname)
           else format(E'\n✅ %s avança de fase', v_wname) end
    );
  end if;

  perform public.wa_enfileirar(
    new.championship_id, new.category_id,
    array[new.home_team_id, new.away_team_id]::uuid[],
    format('fim:%s', new.id), v_msg
  );
  return new;
end;
$$;

drop trigger if exists wa_on_match_finished on public.matches;
create trigger wa_on_match_finished
  after insert or update on public.matches
  for each row execute function public.wa_on_match_finished();

-- ---------------------------------------------------------------------------
-- 6. Partida CANCELADA — chamada pelo app ANTES de excluir a partida.
-- ---------------------------------------------------------------------------
create or replace function public.wa_cancelar_partida(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches; v_home text; v_away text; v_msg text;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return; end if;
  if not public.owns_championship(m.championship_id) then
    raise exception 'Sem permissão para este campeonato';
  end if;
  if m.home_team_id is null or m.away_team_id is null then return; end if;

  select name into v_home from public.teams where id = m.home_team_id;
  select name into v_away from public.teams where id = m.away_team_id;

  v_msg := format(
    E'🏆 *%s*\n❌ *Partida cancelada*\n\n⚽ %s x %s\n🏅 %s%s\n\nEsta partida foi removida da tabela. Aguarde novas informações do organizador.',
    public.wa_champ_nome(m.championship_id),
    coalesce(v_home,'Mandante'), coalesce(v_away,'Visitante'),
    public.wa_comp_linha(m.championship_id, m.category_id, m.phase, m.round),
    case when m.scheduled_at is null then ''
         else E'\n🗓️ Estava marcada para ' || public.push_quando(m.scheduled_at) end
  );

  perform public.wa_enfileirar(
    m.championship_id, m.category_id,
    array[m.home_team_id, m.away_team_id]::uuid[],
    format('cancel:%s', p_match), v_msg
  );
end;
$$;

grant execute on function public.wa_cancelar_partida(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Lembrete 18 h antes do prazo final de inscrição.
--    A Edge Function `send-whatsapp` chama esta função (nome mantido).
--    Prazo final = scheduled_at - registration_cutoff_hours.
-- ---------------------------------------------------------------------------
create or replace function public.wa_gerar_lembretes_inscricao()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; v_qtd int := 0; v_cutoff int; v_prazo timestamptz; v_local text; v_msg text;
begin
  for r in
    select m.*, h.name as home_name, a.name as away_name,
           coalesce(c.registration_cutoff_hours, 0) as cutoff
      from public.matches m
      join public.teams h on h.id = m.home_team_id
      join public.teams a on a.id = m.away_team_id
      join public.championships c on c.id = m.championship_id
     where m.status = 'scheduled' and m.scheduled_at is not null and m.scheduled_at > now()
  loop
    v_cutoff := r.cutoff;
    v_prazo  := r.scheduled_at - make_interval(hours => v_cutoff);
    if now() < v_prazo - interval '18 hours' then continue; end if;
    if now() >= v_prazo then continue; end if;
    if exists (
      select 1 from public.whatsapp_outbox o
       where o.championship_id = r.championship_id
         and o.dedupe_key = format('prazo:%s', r.id)
    ) then continue; end if;

    v_local := public.wa_local(r.championship_id, r.venue);
    v_msg := format(
      E'🏆 *%s*\n⏰ *Inscrições encerrando*\n\nAs inscrições de atletas para o seu próximo jogo encerram em 18 horas.\n\n⚽ %s x %s\n🏅 %s\n🗓️ Jogo: %s%s\n🔒 Prazo final de inscrição: %s\n\nConfira seu elenco antes que feche.',
      public.wa_champ_nome(r.championship_id),
      r.home_name, r.away_name,
      public.wa_comp_linha(r.championship_id, r.category_id, r.phase, r.round),
      public.push_quando(r.scheduled_at),
      case when v_local is null then '' else E'\n📍 ' || v_local end,
      public.push_quando(v_prazo)
    );

    perform public.wa_enfileirar(
      r.championship_id, r.category_id,
      array[r.home_team_id, r.away_team_id]::uuid[],
      format('prazo:%s', r.id), v_msg
    );
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

revoke all on function public.wa_gerar_lembretes_inscricao() from public, anon, authenticated;
grant execute on function public.wa_gerar_lembretes_inscricao() to service_role;
