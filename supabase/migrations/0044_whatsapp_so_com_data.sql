-- ===========================================================================
-- Tabelaço — WhatsApp só quando a data e a hora do jogo são definidas
--
-- Gerar a tabela (pontos corridos, grupos, mata-mata, fases seguintes, jogos
-- criados pela eliminação de um time) não pode disparar mensagens: o aviso ao
-- responsável do time sai quando o organizador informa a DATA E HORA do jogo.
--
--   • `wa_on_match_scheduled`: dispara só quando `scheduled_at` é definida
--     (partida marcada) ou alterada (partida remarcada). Mudar apenas o local
--     ou o árbitro deixa de gerar mensagem. Jogo inserido já com data (criado
--     à mão com data e hora) continua avisando.
--   • `wa_on_match_finished`: jogo inserido já encerrado (W.O. automático da
--     eliminação) não gera "fim de jogo". Encerrar uma partida continua
--     avisando normalmente.
--
-- Mesmo formato da 0042 (message + target_teams). Idempotente.
-- ===========================================================================

-- 1. Partida MARCADA / REMARCADA — só pela data e hora.
create or replace function public.wa_on_match_scheduled()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_home text; v_away text; v_local text; v_ref text; v_novo boolean; v_msg text;
begin
  if new.scheduled_at is null then return new; end if;
  if new.status <> 'scheduled' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  -- Só a DATA E HORA disparam o aviso: marcar (sem data -> com data) ou
  -- remarcar (a data mudou). Trocar só o local/árbitro, ou o time de uma vaga
  -- do mata-mata ser preenchido, não gera mensagem.
  if tg_op = 'UPDATE' then
    if new.scheduled_at is not distinct from old.scheduled_at then
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

-- 2. Partida ENCERRADA — não para jogos que já nascem encerrados.
create or replace function public.wa_on_match_finished()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_home text; v_away text; v_gh int; v_ga int; v_pen text;
  v_win uuid; v_wname text; v_class text; v_msg text;
begin
  if new.status <> 'finished' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;
  -- Jogo que já NASCE encerrado foi gerado automaticamente (W.O. da
  -- eliminação de um time): não avisa.
  if tg_op = 'INSERT' then return new; end if;
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
