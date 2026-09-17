-- ===========================================================================
-- Tabelaço — "jogo remarcado" em qualquer alteração e "partida cancelada"
--
--  1. O aviso de jogo marcado/remarcado passa a disparar quando QUALQUER dado
--     relevante do jogo muda (times, data, hora, local, rodada, grupo, fase,
--     categoria) — não só data/local. Jogo que já tinha data vira "remarcado".
--  2. Nova RPC `wa_cancelar_partida`: enfileira "❌ Partida cancelada" para os
--     dois times. É chamada pelo app ANTES de excluir a partida (a exclusão em
--     si é um DELETE; depois dele não haveria mais dados para a mensagem). Fica
--     como RPC — e não gatilho de DELETE — de propósito: assim regenerar a
--     tabela (que apaga todas as partidas) não dispara dezenas de "cancelada".
--
-- Idempotente. Requer 0039–0042.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Jogo marcado/remarcado — dispara em qualquer alteração relevante
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
  v_addr  text;
  v_local text;
  v_verbo text;
begin
  if new.scheduled_at is null then return new; end if;
  if new.status <> 'scheduled' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  if tg_op = 'UPDATE' then
    -- Nada relevante mudou: sai sem avisar. "Relevante" = qualquer coisa que o
    -- responsável do time precise saber sobre o confronto.
    if new.scheduled_at is not distinct from old.scheduled_at
       and new.venue is not distinct from old.venue
       and new.home_team_id is not distinct from old.home_team_id
       and new.away_team_id is not distinct from old.away_team_id
       and new.round is not distinct from old.round
       and new.category_id is not distinct from old.category_id
       and new."group" is not distinct from old."group"
       and new.phase is not distinct from old.phase then
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
  if v_onde is not null then
    v_addr  := public.wa_endereco_do_local(new.championship_id, v_onde);
    v_local := E'\n📍 ' || v_onde || case when v_addr is null then '' else ' — ' || v_addr end;
  else
    v_local := '';
  end if;

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
      v_local
    )
  );
  return new;
end;
$wa_sched$;

drop trigger if exists wa_on_match_scheduled on public.matches;
create trigger wa_on_match_scheduled
  after insert or update on public.matches
  for each row execute function public.wa_on_match_scheduled();

-- ---------------------------------------------------------------------------
-- 2. Partida cancelada — chamada pelo app antes de excluir a partida
-- ---------------------------------------------------------------------------
create or replace function public.wa_cancelar_partida(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $wa_cancel$
declare
  m       public.matches;
  v_camp  text;
  v_home  text;
  v_away  text;
  v_cat   text;
  v_onde  text;
  v_addr  text;
  v_local text;
  v_quando text;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return; end if;

  -- Só o dono do campeonato (ou o master) pode cancelar e, portanto, avisar.
  if not public.owns_championship(m.championship_id) then
    raise exception 'Sem permissão para esta partida';
  end if;

  -- Tira da fila avisos ainda não entregues deste jogo, para não sair um
  -- "jogo marcado" logo antes do "cancelada".
  delete from public.whatsapp_outbox
   where championship_id = m.championship_id
     and sent_at is null
     and dedupe_key in (format('jogo:%s', m.id), format('insc:%s', m.id));

  if m.home_team_id is null or m.away_team_id is null then return; end if;

  select name into v_camp from public.championships where id = m.championship_id;
  select name into v_home from public.teams where id = m.home_team_id;
  select name into v_away from public.teams where id = m.away_team_id;
  v_cat := public.push_categoria_nome(m.championship_id, m.category_id);

  v_onde := nullif(btrim(coalesce(m.venue, '')), '');
  if v_onde is not null then
    v_addr  := public.wa_endereco_do_local(m.championship_id, v_onde);
    v_local := E'\n📍 ' || v_onde || case when v_addr is null then '' else ' — ' || v_addr end;
  else
    v_local := '';
  end if;

  v_quando := case when m.scheduled_at is null then '' else E'\n🕓 ' || public.push_quando(m.scheduled_at) end;

  perform public.wa_enfileirar(
    m.championship_id,
    m.category_id,
    array[m.home_team_id, m.away_team_id],
    format('cancel:%s', m.id),
    format(
      '🏆 *%s*' || E'\n❌ *Partida cancelada*' || E'\n%s%s × %s%s%s',
      coalesce(v_camp, 'Campeonato'),
      case when v_cat = '' then '' else v_cat || ' · ' end,
      coalesce(v_home, 'Mandante'),
      coalesce(v_away, 'Visitante'),
      v_quando,
      v_local
    )
  );
end;
$wa_cancel$;

grant execute on function public.wa_cancelar_partida(uuid) to authenticated;
